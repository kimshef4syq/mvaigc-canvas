import { resolveExternalAgentToolCall, type ExternalAgentToolResolution } from '@/commands/externalAgent';
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
    case 'health': return inspectCanvasHealth(input);
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
    case 'diagnostics': return executeDiagnostics(request.arguments);
    case 'config_patch': return executeConfigPatch(request.arguments);
    case 'asset_read':
      throw new Error('External image reads must use an explicitly attached, per-turn temporary resource.');
    case 'profile_search':
      return searchProfiles((request.arguments ?? {}) as any);
    case 'profile_read':
      return await readProfile(request.arguments as any);
    case 'source_read':
      return await sourceRepository.readSource(request.arguments as any);
    case 'source_inspect':
      return await sourceRepository.inspectSource(request.arguments as any);
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
        message: 'The user denied this Canvas operation.',
        revision: canvasCommandRegistry.getRevision(),
      };
      await deliverExternalToolResolution(input.request, resolution);
      return { approvalId, status: 'denied' };
    }

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
      execute: () => executeApprovedTool(input.request, approvedRequest),
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
