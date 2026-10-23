import { exportCanvasAsset } from './externalAgentAssetExport';
import { assertExternalConnectionActive, externalAgentPermissionDecision } from './externalAgentPermissionPolicy';
import { inspectExternalAgentConnection, resolveExternalAgentToolCall, type ExternalAgentToolResolution } from '@/commands/externalAgent';
import { canvasCommandRegistry } from '@/features/canvas/application/canvasCommandService';
import { CANVAS_COMMAND_VERSION, type CanvasCommand } from '@/features/canvas/domain/canvasCommands';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';
import {
  applyAgentGenerationNetworkPatch,
  applyAgentProviderPatch,
  getAgentGenerationNetworkRevision,
  getAgentProviderRevision,
  previewAgentGenerationNetworkPatch,
  previewAgentProviderPatch,
  rollbackAgentProviderPatch,
  type AgentProviderPatchV1,
} from './agentConfigPatch';
import {
  buildDiagnosticBundlePreview,
  classifyAgentError,
  inspectCanvasHealth,
  inspectDiagnosticConfigSnapshot,
  inspectPersistedGenerationJobs,
  preflightGeneration,
} from './agentDiagnostics';
import {
  canvasAgentApprovalExecution,
  canvasAgentApprovalStore,
  createAgentRequestFingerprint,
  createApprovalId,
  type AgentApprovalRecord,
} from './agentApproval';
import { canvasAgentBudgetLedger } from './agentBudget';
import { canvasAgentRollbackStore } from './agentCanvasRollback';
import { prepareCanvasAgentToolApproval, type AgentApprovalView } from './canvasAgentController';
import { redactSensitiveValue } from './agentRedaction';
import type { ExternalAgentToolRequest } from '../domain/agentModel';
import { loadDiagnosticEvents } from '@/features/canvas/application/diagnosticEvents';
import { searchProfiles, readProfile } from '../infrastructure/profileRepository';
import { sourceRepository, computeSha256 } from '../infrastructure/sourceRepository';
import { productionPlanService } from './productionPlanService';
import { assertWorkflowGenerationAllowed, assertWorkflowReviewReady } from './workflowGenerationGuard';
import { buildCanvasAssetCatalog } from '@/features/canvas/application/canvasAssetCatalog';
import { inspectImportMediaPaths } from '@/commands/image';
import { prepareNodeImage } from '@/features/canvas/application/imageData';
import { prepareVideoNodeDataFromSource } from '@/features/canvas/application/videoUpload';
import { prepareAudioNodeDataFromSource } from '@/features/canvas/application/audioUpload';
import { CANVAS_NODE_TYPES, type CanvasNodeType } from '@/features/canvas/domain/canvasNodes';
import { mediaPostprocessService } from './mediaPostprocessService';

export interface ExternalAgentToolExecutionResult {
  approvalId: string;
  receiptId?: string;
  output?: unknown;
  error?: string;
  status: 'approved' | 'denied' | 'error';
}

class ExternalAgentResolutionDeliveryError extends Error {
  constructor(readonly original: unknown) {
    super(original instanceof Error ? original.message : String(original));
    this.name = 'ExternalAgentResolutionDeliveryError';
  }
}

async function deliverExternalToolResolution(
  request: ExternalAgentToolRequest,
  resolution: ExternalAgentToolResolution,
): Promise<void> {
  try {
    await resolveExternalAgentToolCall({
      sessionId: request.sessionId,
      callId: request.callId,
      resolution,
    });
  } catch (error) {
    throw new ExternalAgentResolutionDeliveryError(error);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function commandFromArguments(value: unknown): CanvasCommand {
  if (!isRecord(value) || typeof value.type !== 'string' || !isRecord(value.input)) {
    throw new Error('External Agent canvas_command arguments are invalid.');
  }
  return {
    type: value.type,
    version: CANVAS_COMMAND_VERSION,
    input: value.input,
  } as CanvasCommand;
}

function toolSuccess(output: unknown): boolean {
  return !isRecord(output) || output.ok !== false;
}

async function persistCanvas(projectId: string): Promise<void> {
  const project = useProjectStore.getState();
  if (project.currentProjectId !== projectId) throw new Error('The active project changed before persistence.');
  const canvas = useCanvasStore.getState();
  project.saveCurrentProject(canvas.nodes, canvas.edges, canvas.currentViewport, canvas.history);
  await project.waitForProjectPersistence(projectId);
}

const IMPORTABLE_KINDS = ['image', 'video', 'audio'] as const;
const IMPORT_MAX_BYTES = { image: 64 * 1024 * 1024, video: 512 * 1024 * 1024, audio: 512 * 1024 * 1024 } as const;
type ImportKind = (typeof IMPORTABLE_KINDS)[number];
interface ImportRequestFile { path: string; kind: ImportKind; title?: string }

const IMPORT_KIND_EXTENSIONS: Record<string, ImportKind> = {
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image', bmp: 'image', avif: 'image',
  mp4: 'video', mov: 'video', webm: 'video', m4v: 'video', mkv: 'video', avi: 'video',
  mp3: 'audio', wav: 'audio', m4a: 'audio', aac: 'audio', ogg: 'audio', opus: 'audio', flac: 'audio',
};

function inferKindFromPath(path: string): ImportKind | null {
  const extension = path.split('?')[0].split('#')[0].match(/\.([A-Za-z0-9]{1,5})$/)?.[1];
  return extension ? IMPORT_KIND_EXTENSIONS[extension.toLowerCase()] ?? null : null;
}

function parseImportFiles(argumentsValue: unknown): ImportRequestFile[] {
  if (!isRecord(argumentsValue) || !Array.isArray(argumentsValue.files)) {
    throw new Error('An assets import requires a files array.');
  }
  const entries = argumentsValue.files;
  if (entries.length === 0 || entries.length > 16) {
    throw new Error('An assets import requires between 1 and 16 files.');
  }
  return entries.map((entry) => {
    if (!isRecord(entry) || typeof entry.path !== 'string' || !entry.path.trim()) {
      throw new Error('Every imported file needs an absolute path.');
    }
    const path = entry.path.trim();
    if (!path.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(path)) {
      throw new Error(`Cannot import ${path}: the path must be absolute.`);
    }
    const declaredKind = typeof entry.kind === 'string' ? entry.kind : null;
    if (declaredKind !== null && !(IMPORTABLE_KINDS as readonly string[]).includes(declaredKind)) {
      throw new Error(`Cannot import ${path}: ${declaredKind} is not a supported media kind.`);
    }
    const kind = (declaredKind as ImportKind | null) ?? inferKindFromPath(path);
    if (!kind) throw new Error(`Cannot import ${path}: its media kind could not be determined.`);
    const title = typeof entry.title === 'string' && entry.title.trim() ? entry.title.trim() : undefined;
    return { path, kind, title };
  });
}

/** 校验通过则返回，否则抛出首个失败项。先于任何文件与节点产生。 */
export async function validateImportFilesForTest(files: ImportRequestFile[]): Promise<void> {
  const checks = await inspectImportMediaPaths(files.map((file) => file.path));
  for (const [index, check] of checks.entries()) {
    const kind = files[index].kind;
    // 扩展名与 kind 必须相符，否则会把 PNG 当成视频交给视频 prepare 流程。
    const inferredKind = inferKindFromPath(check.path);
    if (inferredKind && inferredKind !== kind) {
      throw new Error(`Cannot import ${check.path}: the ${kind} kind does not match its file extension.`);
    }
    if (!check.exists) throw new Error(`Cannot import ${check.path}: it does not exist.`);
    if (!check.isFile) throw new Error(`Cannot import ${check.path}: directories, symlinks and special files are refused.`);
    if (check.bytes === 0) throw new Error(`Cannot import ${check.path}: it is empty.`);
    if (check.bytes > IMPORT_MAX_BYTES[kind]) {
      throw new Error(`Cannot import ${check.path}: it exceeds the ${kind} size limit.`);
    }
  }
}

function resolveImportPosition(anchorId: string | null, index: number): { x: number; y: number } {
  const nodes = useCanvasStore.getState().nodes;
  if (anchorId) {
    const anchor = nodes.find((node) => node.id === anchorId);
    if (!anchor) throw new Error(`Anchor node ${anchorId} does not exist.`);
    return { x: anchor.position.x + 48, y: anchor.position.y + 48 + index * 96 };
  }
  if (nodes.length === 0) return { x: 0, y: 0 };
  const rightEdge = Math.max(...nodes.map((node) => node.position.x + (node.measured?.width ?? node.width ?? 220)));
  const top = Math.min(...nodes.map((node) => node.position.y));
  return { x: rightEdge + 160, y: top + index * 96 };
}

async function executeAssetsImport(
  request: ExternalAgentToolRequest,
  approval: AgentApprovalRecord,
): Promise<unknown> {
  const files = parseImportFiles(request.arguments);
  const anchorId = isRecord(request.arguments) && isRecord(request.arguments.anchor)
    && typeof request.arguments.anchor.nodeId === 'string'
    ? request.arguments.anchor.nodeId
    : null;
  await validateImportFilesForTest(files);

  // Media preparation is asynchronous (video posters are captured in the
  // browser), so re-check the project before committing nodes.
  const projectId = approval.projectId;
  const prepared: Array<{ nodeType: CanvasNodeType; data: Record<string, unknown> }> = [];
  for (const file of files) {
    const data = file.kind === 'image'
      ? { ...await prepareNodeImage(file.path), sourceFileName: file.title ?? null }
      : file.kind === 'video'
        ? await prepareVideoNodeDataFromSource(file.path, file.title ?? null)
        : await prepareAudioNodeDataFromSource(file.path, file.title ?? null);
    const nodeType = file.kind === 'image'
      ? CANVAS_NODE_TYPES.upload
      : file.kind === 'video' ? CANVAS_NODE_TYPES.video : CANVAS_NODE_TYPES.audio;
    prepared.push({ nodeType, data: data as Record<string, unknown> });
  }
  if (useProjectStore.getState().currentProjectId !== projectId) {
    throw new Error('The active project changed before imported media could be added.');
  }

  const nodes = prepared.map((entry, index) => ({
    nodeType: entry.nodeType,
    position: resolveImportPosition(anchorId, index),
    data: entry.data,
  }));
  const command: CanvasCommand = { type: 'asset.import', version: CANVAS_COMMAND_VERSION, input: { nodes } };
  return executeCanvasCommand({ ...request, arguments: command }, approval);
}

async function executeCanvasCommand(
  request: ExternalAgentToolRequest,
  approval: AgentApprovalRecord,
): Promise<unknown> {
  const command = commandFromArguments(request.arguments);
  const definition = canvasCommandRegistry.getDefinition(command.type);
  const graphWrite = approval.impact.effect === 'canvas-write'
    && (definition.effect === 'graph' || command.type === 'node.tool.run');
  const canvas = useCanvasStore.getState();
  if (command.type === 'generation.submit') {
    assertWorkflowGenerationAllowed({ projectId: approval.projectId, nodeIds: command.input.nodeIds,
      nodes: canvas.nodes, edges: canvas.edges, references: buildCanvasAssetCatalog(canvas.nodes) });
  }
  const rollbackToken = graphWrite
    ? canvasAgentRollbackStore.begin(
        approval.projectId,
        approval.runId,
        canvas.revision,
        canvas.history.past.length,
      )
    : undefined;
  try {
    const result = await canvasCommandRegistry.executeApproved(command, approval.baseRevision, 'agent');
    if (!result.ok) {
      if (rollbackToken) canvasAgentRollbackStore.discard(rollbackToken);
      return result;
    }
    if (rollbackToken) canvasAgentRollbackStore.complete(rollbackToken, result.revisionAfter);
    if (approval.impact.effect === 'canvas-write' || command.type === 'director.record') {
      await persistCanvas(approval.projectId);
    }
    return rollbackToken ? { ...result, rollbackToken } : result;
  } catch (error) {
    if (rollbackToken) canvasAgentRollbackStore.discard(rollbackToken);
    throw error;
  }
}

async function executeDiagnostics(argumentsValue: unknown): Promise<unknown> {
  if (!isRecord(argumentsValue) || typeof argumentsValue.operation !== 'string') {
    throw new Error('External Agent diagnostics arguments are invalid.');
  }
  const input = argumentsValue as any;
  switch (input.operation) {
    case 'health': {
      const connection = await inspectExternalAgentConnection();
      return { ...inspectCanvasHealth(input),
        checkScope: { canvasMetadata: true, thisMcpCallReachedCanvas: true,
          localMediaFiles: false, providerAuthentication: false, fullGraphQuery: false },
        externalConnection: { status: connection.status, projectId: connection.project?.id,
          permissionMode: connection.permissionMode, expiresAt: connection.expiresAt },
        note: 'This checks canvas metadata and confirms this MCP call reached the application. It does not verify every local media file, provider credentials, or a separate graph query. Missing media and provider 401 errors are separate from MCP connectivity.',
      };
    }
    case 'provider-config': return inspectDiagnosticConfigSnapshot();
    case 'generation-jobs': return inspectPersistedGenerationJobs({ jobId: input.jobId, limit: input.limit });
    case 'application-logs': return loadDiagnosticEvents({
      severity: input.severity,
      source: input.source,
      query: input.query,
      limit: input.limit,
    });
    case 'classify-error': return classifyAgentError(input.error);
    case 'bundle-preview': return buildDiagnosticBundlePreview({
      error: input.error,
      reproductionSteps: input.reproductionSteps,
      now: input.now,
    });
    case 'preflight': return preflightGeneration(input);
    default: throw new Error(`Unsupported external Agent diagnostic operation ${input.operation}.`);
  }
}

function executeConfigPatch(argumentsValue: unknown): unknown {
  if (!isRecord(argumentsValue) || !['preview', 'apply', 'rollback'].includes(String(argumentsValue.action))) {
    throw new Error('External Agent config_patch arguments are invalid.');
  }
  const input = argumentsValue as any;
  if (input.action === 'rollback') {
    return input.rollbackToken
      ? rollbackAgentProviderPatch(input.rollbackToken)
      : { ok: false, error: 'rollbackToken is required.' };
  }
  if (input.settingsTarget === 'generation-network') {
    if (!input.networkRoute) return { ok: false, issues: ['networkRoute is required.'] };
    const patch = {
      baseRevision: input.baseRevision
        ?? (input.action === 'preview' ? getAgentGenerationNetworkRevision() : ''),
      route: input.networkRoute,
    };
    return input.action === 'preview'
      ? previewAgentGenerationNetworkPatch(patch)
      : applyAgentGenerationNetworkPatch(patch);
  }
  if (!input.providerId) return { ok: false, issues: ['providerId is required.'] };
  const metadata = input.modelId ? {
    supportsTools: input.supportsTools,
    supportsMultimodal: input.supportsMultimodal,
    supportsStreaming: input.supportsStreaming,
    supportsReasoningSummary: input.supportsReasoningSummary,
    supportsToolSearch: input.supportsToolSearch,
    agentProtocol: input.agentProtocol,
  } : undefined;
  const patch: AgentProviderPatchV1 = {
    version: 1,
    providerId: input.providerId,
    baseRevision: input.baseRevision
      ?? (input.action === 'preview' ? getAgentProviderRevision(input.providerId) ?? '' : ''),
    changes: {
      baseUrl: input.baseUrl,
      endpointPath: input.endpointPath,
      apiStyle: input.apiStyle,
      modelId: input.modelId,
      modelMetadata: metadata,
    },
  };
  return input.action === 'preview'
    ? previewAgentProviderPatch(patch)
    : applyAgentProviderPatch(patch);
}

function currentConfigRevision(argumentsValue: unknown): string | null | undefined {
  if (!isRecord(argumentsValue)) return undefined;
  if (argumentsValue.settingsTarget === 'generation-network') {
    return getAgentGenerationNetworkRevision();
  }
  return typeof argumentsValue.providerId === 'string'
    ? getAgentProviderRevision(argumentsValue.providerId)
    : undefined;
}

async function executeApprovedTool(
  request: ExternalAgentToolRequest,
  approval: AgentApprovalRecord,
): Promise<unknown> {
  switch (request.toolName) {
    case 'canvas_command': return executeCanvasCommand(request, approval);
    case 'assets_import': return executeAssetsImport(request, approval);
    case 'diagnostics': return executeDiagnostics(request.arguments);
    case 'config_patch': return executeConfigPatch(request.arguments);
    case 'asset_read': {
      if (!isRecord(request.arguments) || typeof request.arguments.assetId !== 'string') {
        throw new Error('A canvas asset read requires an assetId.');
      }
      const connection = await inspectExternalAgentConnection();
      return exportCanvasAsset(request.arguments.assetId, connection.hypitProjectDir);
    }
    case 'profile_search':
      return searchProfiles((request.arguments ?? {}) as any);
    case 'profile_read':
      return await readProfile(request.arguments as any);
    case 'source_read':
    case 'source_inspect': {
      if (!isRecord(request.arguments) || typeof request.arguments.sourceId !== 'string'
        || sourceRepository.getSource(request.arguments.sourceId)?.projectId !== approval.projectId) {
        throw new Error('The source document does not belong to this project.');
      }
      return request.toolName === 'source_read'
        ? sourceRepository.readSource(request.arguments as any)
        : sourceRepository.inspectSource(request.arguments.sourceId);
    }
    case 'production_plan': {
      const rawArgs = request.arguments as any;
      if (!isRecord(rawArgs) || typeof rawArgs.action !== 'string') {
        throw new Error('External Agent production_plan arguments are invalid.');
      }
      const args = rawArgs as any;
      switch (args.action) {
        case 'create':
          return productionPlanService.createPlan({ projectId: approval.projectId, ...args.createInput });
        case 'get':
          return productionPlanService.getPlan(approval.projectId, args.planId);
        case 'list':
          return productionPlanService.listPlans(approval.projectId);
        case 'author_stage':
          return productionPlanService.authorStage({
            projectId: approval.projectId,
            planId: args.planId,
            expectedRevision: args.expectedRevision,
            ...args.authorStageInput,
          });
        case 'replan':
          return productionPlanService.replan({
            projectId: approval.projectId,
            planId: args.planId,
            expectedRevision: args.expectedRevision,
            ...args.replanInput,
          });
        case 'record_review': {
          const reviewPlan = productionPlanService.getPlan(approval.projectId, args.planId);
          const reviewStage = reviewPlan?.stages.find((item) => item.id === args.recordReviewInput?.stageId);
          if (args.recordReviewInput?.status === 'passed') {
            const plan = productionPlanService.getPlan(approval.projectId, args.planId);
            const stage = plan?.stages.find((item) => item.id === args.recordReviewInput.stageId);
            if (!plan || !stage) throw new Error('未找到待确认阶段');
            const nodes = useCanvasStore.getState().nodes;
            assertWorkflowReviewReady(plan, stage, args.recordReviewInput.reviewId, new Set([
              ...nodes.map((node) => node.id), ...buildCanvasAssetCatalog(nodes).map((asset) => asset.id),
              ...sourceRepository.listSources(approval.projectId).map((source) => source.id),
            ]));
          }
          return productionPlanService.recordReview({
            projectId: approval.projectId,
            planId: args.planId,
            expectedRevision: args.expectedRevision,
            ...args.recordReviewInput,
            userConfirmed: true,
            contentHash: reviewStage ? await computeSha256(JSON.stringify({ stageId: reviewStage.id,
              goal: reviewStage.goal, locks: reviewStage.executionLocks, items: reviewStage.workItems, outputs: reviewStage.currentOutputs })) : undefined,
          });
        }
        case 'retry_items':
          return productionPlanService.retryItems({
            projectId: approval.projectId,
            planId: args.planId,
            expectedRevision: args.expectedRevision,
            ...args.retryItemsInput,
          });
        case 'set_status':
          return productionPlanService.setPlanStatus({
            projectId: approval.projectId,
            planId: args.planId,
            expectedRevision: args.expectedRevision,
            status: args.setStatusInput?.status,
          });
        default:
          throw new Error(`Unsupported external Agent production_plan action ${args.action}.`);
      }
    }
    case 'media_postprocess': {
      const args = request.arguments as any;
      if (!isRecord(args) || !args.operation) {
        throw new Error('External Agent media_postprocess arguments are invalid.');
      }
      return await mediaPostprocessService.executeOperation(args.operation as any);
    }
  }
}

export async function prepareExternalAgentToolRequest(input: {
  projectId: string;
  request: ExternalAgentToolRequest;
}): Promise<AgentApprovalView> {
  if (useProjectStore.getState().currentProjectId !== input.projectId) {
    throw new Error('The active project changed before external Agent approval.');
  }
  const prepared = await prepareCanvasAgentToolApproval({
    runId: input.request.turnId,
    projectId: input.projectId,
    callId: input.request.callId,
    toolName: input.request.toolName,
    arguments: input.request.arguments,
  });
  return prepared.view;
}

export async function resolveExternalAgentToolApproval(input: {
  projectId: string;
  request: ExternalAgentToolRequest;
  approve: boolean;
  automatic?: boolean;
  enforceConnection?: boolean;
  denialMessage?: string;
}): Promise<ExternalAgentToolExecutionResult> {
  const approvalId = createApprovalId(input.request.turnId, input.request.toolName, input.request.callId);
  let approval: AgentApprovalRecord | undefined;
  try {
    approval = canvasAgentApprovalStore.get(approvalId);
    if (!approval || approval.projectId !== input.projectId) {
      throw new Error('The external Agent approval no longer exists.');
    }
    const fingerprint = await createAgentRequestFingerprint(input.request.toolName, input.request.arguments);
    if (fingerprint !== approval.requestFingerprint) {
      canvasAgentApprovalStore.update(approval.id, { status: 'conflicted' });
      throw new Error('External Agent tool arguments changed after approval preview.');
    }
    if (useProjectStore.getState().currentProjectId !== input.projectId) {
      canvasAgentApprovalStore.update(approval.id, { status: 'conflicted' });
      throw new Error('The active project changed before external Agent tool resolution.');
    }
    const approvedRequest = approval;

    if (!input.approve) {
      canvasAgentApprovalExecution.decide(approval.id, false);
      canvasAgentBudgetLedger.release(input.projectId, approval.id);
      const resolution: ExternalAgentToolResolution = {
        outcome: 'denied',
        errorCode: 'user_denied',
        message: input.denialMessage ?? 'The user denied this Canvas operation.',
        revision: canvasCommandRegistry.getRevision(),
      };
      await deliverExternalToolResolution(input.request, resolution);
      return { approvalId, status: 'denied' };
    }

    // User-managed connections must be checked again immediately before execution.
    // App-managed runtimes keep their existing approval path.
    const checkPermission = async () => {
      if (!input.enforceConnection && !input.automatic) return;
      const connection = await inspectExternalAgentConnection();
      assertExternalConnectionActive(connection, input.projectId, input.request.sessionId);
      const decision = externalAgentPermissionDecision(connection.permissionMode, input.request);
      if (decision === 'deny' || (input.automatic && decision !== 'automatic')) {
        throw new Error('Connection permissions changed. This operation requires a new permission decision.');
      }
      if (useProjectStore.getState().currentProjectId !== input.projectId) {
        throw new Error('The active project changed before external Agent execution.');
      }
    };
    await checkPermission();
    const budget = canvasAgentBudgetLedger.reserve(approval);
    if (!budget.allowed) {
      throw new Error(`Agent budget is insufficient; ${budget.remaining ?? 0} credits remain.`);
    }
    canvasAgentApprovalExecution.decide(approval.id, true);
    const execution = await canvasAgentApprovalExecution.executeOnce({
      approvalId: approval.id,
      runId: approval.runId,
      projectId: approval.projectId,
      toolName: input.request.toolName,
      callId: input.request.callId,
      requestFingerprint: fingerprint,
      activeProjectId: useProjectStore.getState().currentProjectId,
      currentRevision: canvasCommandRegistry.getRevision(),
      currentConfigRevision: input.request.toolName === 'config_patch'
        ? currentConfigRevision(input.request.arguments)
        : undefined,
      safeRecovery: input.request.toolName === 'canvas_command'
        && commandFromArguments(input.request.arguments).type === 'generation.submit'
        ? {
            kind: 'generation-status',
            nodeIds: (commandFromArguments(input.request.arguments) as Extract<CanvasCommand, { type: 'generation.submit' }>).input.nodeIds,
            jobIds: [],
          }
        : undefined,
      execute: async () => {
        await checkPermission();
        return await executeApprovedTool(input.request, approvedRequest);
      },
      isSuccess: toolSuccess,
      isAccepted: (output) => input.request.toolName === 'canvas_command'
        && commandFromArguments(input.request.arguments).type === 'generation.submit'
        && toolSuccess(output),
      isUnknownOutcome: (output) => input.request.toolName === 'canvas_command'
        && commandFromArguments(input.request.arguments).type === 'generation.submit'
        && isRecord(output)
        && output.ok === false
        && isRecord(output.error)
        && output.error.code === 'execution_failed',
    });
    const output = redactSensitiveValue(execution.output);
    const succeeded = execution.receipt.status !== 'failed';
    const resolution: ExternalAgentToolResolution = {
      outcome: succeeded ? 'approved' : 'error',
      result: output,
      errorCode: succeeded ? undefined : execution.receipt.errorCode ?? 'canvas_tool_failed',
      message: succeeded ? undefined : 'The approved Canvas operation failed.',
      revision: canvasCommandRegistry.getRevision(),
      receiptId: execution.receipt.id,
    };
    await deliverExternalToolResolution(input.request, resolution);
    if (execution.receipt.status === 'succeeded' || execution.receipt.status === 'accepted' || execution.receipt.status === 'unknown') {
      canvasAgentBudgetLedger.commit(input.projectId, approval.id);
    } else {
      canvasAgentBudgetLedger.release(input.projectId, approval.id);
    }
    return {
      approvalId,
      receiptId: execution.receipt.id,
      output,
      error: succeeded ? undefined : 'The approved Canvas operation failed.',
      status: succeeded ? 'approved' : 'error',
    };
  } catch (error) {
    if (error instanceof ExternalAgentResolutionDeliveryError) {
      if (error.original instanceof Error) throw error.original;
      throw new Error(String(error.original));
    }
    if (approval) canvasAgentBudgetLedger.release(input.projectId, approval.id);
    const rawMessage = error instanceof Error ? error.message : String(error);
    const redactedMessage = redactSensitiveValue(rawMessage);
    const message = typeof redactedMessage === 'string'
      ? redactedMessage
      : 'The Canvas operation failed.';
    await resolveExternalAgentToolCall({
      sessionId: input.request.sessionId,
      callId: input.request.callId,
      resolution: {
        outcome: 'error',
        errorCode: 'canvas_tool_failed',
        message,
        revision: canvasCommandRegistry.getRevision(),
      },
    });
    return { approvalId, status: 'error', error: message };
  }
}
