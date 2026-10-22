import { canvasCommandRegistry } from '@/features/canvas/application/canvasCommandService';
import { CANVAS_COMMAND_VERSION } from '@/features/canvas/domain/canvasCommands';
import { CANVAS_NODE_TYPES, type CanvasNodeType } from '@/features/canvas/domain/canvasNodes';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';

interface RunOutputs {
  projectId: string;
  nodeIds: Set<string>;
  explicitGrouping: boolean;
  createdNodeIds: Set<string>;
  resultSources: Map<string, string>;
}

const outputsByRun = new Map<string, RunOutputs>();

function runOutputs(runId: string, projectId: string): RunOutputs {
  const existing = outputsByRun.get(runId);
  if (existing && existing.projectId === projectId) return existing;
  const created: RunOutputs = {
    projectId,
    nodeIds: new Set(),
    explicitGrouping: false,
    createdNodeIds: new Set(),
    resultSources: new Map(),
  };
  outputsByRun.set(runId, created);
  return created;
}

const SOURCE_TYPES = new Set<CanvasNodeType>([CANVAS_NODE_TYPES.aiVideo, CANVAS_NODE_TYPES.imageEdit, CANVAS_NODE_TYPES.aiAudio]);
const RESULT_TYPES = new Set<CanvasNodeType>([CANVAS_NODE_TYPES.video, CANVAS_NODE_TYPES.aiVideo, CANVAS_NODE_TYPES.exportImage, CANVAS_NODE_TYPES.audio]);

/** Track only nodes created by this run, so arranging a task never moves old inputs. */
export function recordAgentCreatedNode(runId: string, projectId: string, nodeId: string): void {
  runOutputs(runId, projectId).createdNodeIds.add(nodeId);
}

export function recordGeneratedOutputs(
  runId: string,
  projectId: string,
  inputNodeIds: string[],
  resultNodeIds: string[],
): void {
  if (resultNodeIds.length === 0) return;
  const nodes = useCanvasStore.getState().nodes;
  if (!nodes.some((node) => inputNodeIds.includes(node.id) && SOURCE_TYPES.has(node.type))) return;
  const results = new Set(resultNodeIds);
  const run = runOutputs(runId, projectId);
  for (const node of nodes) {
    if (!results.has(node.id) || node.parentId) continue;
    if (RESULT_TYPES.has(node.type)) {
      run.nodeIds.add(node.id);
      const sourceId = useCanvasStore.getState().edges.find((edge) => edge.target === node.id && inputNodeIds.includes(edge.source))?.source
        ?? (inputNodeIds.length === 1 ? inputNodeIds[0] : undefined);
      if (sourceId) run.resultSources.set(node.id, sourceId);
    }
  }
}

export function recordExplicitGrouping(runId: string, projectId: string): void {
  runOutputs(runId, projectId).explicitGrouping = true;
}

/**
 * P201: Outputs returned by ComfyUI workflows are laid out atomically by the gateway
 * and must be exempted from auto-grouping.
 */
export function recordComfyUiOutputs(runId: string, projectId: string): void {
  runOutputs(runId, projectId).explicitGrouping = true;
}

export function isEligibleForAutoGroup(runId: string, projectId: string): boolean {
  const run = outputsByRun.get(runId);
  if (!run || run.projectId !== projectId || run.explicitGrouping) return false;
  const nodeIds = Array.from(run.nodeIds);
  const present = new Set(useCanvasStore.getState().nodes
    .filter((node) => !node.parentId && RESULT_TYPES.has(node.type))
    .map((node) => node.id));
  const eligible = nodeIds.filter((id) => present.has(id));
  const created = useCanvasStore.getState().nodes.filter((node) => run.createdNodeIds.has(node.id)
    && !node.parentId && node.type !== CANVAS_NODE_TYPES.group).map((node) => node.id);
  return eligible.length > 0 && new Set([...eligible, ...created]).size >= 2;
}

export function clearRecentOutputGrouping(runId: string): void {
  outputsByRun.delete(runId);
}

/** Apply grid layout and grouping in one canvas transaction, once per Agent run. */
export async function groupRecentGeneratedOutputs(runId: string, projectId: string): Promise<boolean> {
  const run = outputsByRun.get(runId);
  outputsByRun.delete(runId);
  if (!run || run.projectId !== projectId || run.explicitGrouping
    || useProjectStore.getState().currentProjectId !== projectId) return false;
  const nodeIds = Array.from(run.nodeIds);
  const present = new Set(useCanvasStore.getState().nodes
    .filter((node) => !node.parentId && RESULT_TYPES.has(node.type))
    .map((node) => node.id));
  const eligible = nodeIds.filter((id) => present.has(id));
  if (!eligible.length) return false;
  const canvasNodes = useCanvasStore.getState().nodes;
  const createdNodes = canvasNodes.filter((node) => run.createdNodeIds.has(node.id) && !node.parentId
    && node.type !== CANVAS_NODE_TYPES.group);
  if (eligible.length < 2 && createdNodes.length === 0) return false;
  createdNodes.sort((a, b) => Number(a.data.shotNumber ?? 0) - Number(b.data.shotNumber ?? 0));
  const layoutIds = new Set<string>();
  for (const node of createdNodes) {
    layoutIds.add(node.id);
    for (const id of eligible) if (run.resultSources.get(id) === node.id) layoutIds.add(id);
  }
  for (const id of eligible) layoutIds.add(id);
  const members = Array.from(layoutIds);
  if (members.length < 2) return false;
  const anchor = createdNodes[0]?.position;
  const result = canvasCommandRegistry.executeTransaction({
    id: `generation-auto-group:${runId}`,
    origin: 'agent',
    expectedRevision: canvasCommandRegistry.getRevision(),
    commands: [
      { type: 'node.layout', version: CANVAS_COMMAND_VERSION, input: { nodeIds: members, direction: 'grid', ...(createdNodes.length ? { columns: 2, origin: anchor } : {}) } },
      { type: 'group.create', version: CANVAS_COMMAND_VERSION, input: { nodeIds: members, displayName: createdNodes.length ? '本轮创作' : '本轮生成结果' } },
    ],
  });
  if (!result.ok) return false;
  const projectStore = useProjectStore.getState();
  const canvas = useCanvasStore.getState();
  projectStore.saveCurrentProject(canvas.nodes, canvas.edges, canvas.currentViewport, canvas.history);
  await projectStore.waitForProjectPersistence(projectId);
  return true;
}
