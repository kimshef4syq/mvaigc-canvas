import { canvasCommandRegistry } from '@/features/canvas/application/canvasCommandService';
import { CANVAS_COMMAND_VERSION } from '@/features/canvas/domain/canvasCommands';
import { CANVAS_NODE_TYPES, isAiVideoNode } from '@/features/canvas/domain/canvasNodes';
import { isMiniMaxDesignVideoModel } from '@/features/promptCompiler/PromptLinter';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';

interface RunOutputs {
  projectId: string;
  nodeIds: Set<string>;
  explicitGrouping: boolean;
}

const outputsByRun = new Map<string, RunOutputs>();

function runOutputs(runId: string, projectId: string): RunOutputs {
  const existing = outputsByRun.get(runId);
  if (existing && existing.projectId === projectId) return existing;
  const created = { projectId, nodeIds: new Set<string>(), explicitGrouping: false };
  outputsByRun.set(runId, created);
  return created;
}

export function recordMiniMaxGeneratedOutputs(
  runId: string,
  projectId: string,
  inputNodeIds: string[],
  resultNodeIds: string[],
): void {
  if (resultNodeIds.length === 0) return;
  const nodes = useCanvasStore.getState().nodes;
  const sourceIsMiniMax = nodes.some((node) => inputNodeIds.includes(node.id)
    && isAiVideoNode(node)
    && isMiniMaxDesignVideoModel(node.data.modelConfig?.entryId ?? ''));
  if (!sourceIsMiniMax) return;
  const results = new Set(resultNodeIds);
  const run = runOutputs(runId, projectId);
  for (const node of nodes) {
    if (!results.has(node.id) || node.parentId) continue;
    if (node.type === CANVAS_NODE_TYPES.video || node.type === CANVAS_NODE_TYPES.aiVideo) {
      run.nodeIds.add(node.id);
    }
  }
}

export function recordExplicitGrouping(runId: string, projectId: string): void {
  runOutputs(runId, projectId).explicitGrouping = true;
}

export function clearRecentOutputGrouping(runId: string): void {
  outputsByRun.delete(runId);
}

/** Apply grid layout and grouping in one canvas transaction, once per Agent run. */
export async function groupRecentMiniMaxOutputs(runId: string, projectId: string): Promise<boolean> {
  const run = outputsByRun.get(runId);
  outputsByRun.delete(runId);
  if (!run || run.projectId !== projectId || run.explicitGrouping
    || useProjectStore.getState().currentProjectId !== projectId) return false;
  const nodeIds = Array.from(run.nodeIds);
  const present = new Set(useCanvasStore.getState().nodes
    .filter((node) => !node.parentId && (node.type === CANVAS_NODE_TYPES.video || node.type === CANVAS_NODE_TYPES.aiVideo))
    .map((node) => node.id));
  const eligible = nodeIds.filter((id) => present.has(id));
  if (eligible.length < 2) return false;
  const result = canvasCommandRegistry.executeTransaction({
    id: `minimax-auto-group:${runId}`,
    origin: 'agent',
    expectedRevision: canvasCommandRegistry.getRevision(),
    commands: [
      { type: 'node.layout', version: CANVAS_COMMAND_VERSION, input: { nodeIds: eligible, direction: 'grid' } },
      { type: 'group.create', version: CANVAS_COMMAND_VERSION, input: { nodeIds: eligible, displayName: '本轮生成结果' } },
    ],
  });
  if (!result.ok) return false;
  const projectStore = useProjectStore.getState();
  const canvas = useCanvasStore.getState();
  projectStore.saveCurrentProject(canvas.nodes, canvas.edges, canvas.currentViewport, canvas.history);
  await projectStore.waitForProjectPersistence(projectId);
  return true;
}
