import { CANVAS_NODE_TYPES } from '@/features/canvas/domain/canvasNodes';

export type ImageGenerationMode = 'overwrite' | 'newNode';

export interface ImageGenerationPayload {
  prompt: string;
  model: string;
  size: string;
  aspectRatio: string;
  referenceImages: string[];
  extraParams: Record<string, unknown>;
}

export interface ImageGenerationDeps {
  addNode: (
    type: typeof CANVAS_NODE_TYPES.exportImage,
    position: { x: number; y: number },
    data?: Record<string, unknown>
  ) => string;
  updateNodeData: (nodeId: string, patch: Record<string, unknown>) => void;
  submitJob: (payload: ImageGenerationPayload) => Promise<string>;
}

// Requests beyond the first of a multi-image batch wait here per node id. The
// poll loop drains one when the previous image completes, which keeps the
// node's "one node, one in-flight job" invariant intact.
const pendingGenerations = new Map<string, ImageGenerationPayload[]>();

export function takeNextQueuedGeneration(nodeId: string): ImageGenerationPayload | null {
  const queue = pendingGenerations.get(nodeId);
  if (!queue || queue.length === 0) {
    return null;
  }
  const next = queue.shift() ?? null;
  if (queue.length === 0) {
    pendingGenerations.delete(nodeId);
  }
  return next;
}

export function queuedGenerationCount(nodeId: string): number {
  return pendingGenerations.get(nodeId)?.length ?? 0;
}

/**
 * Submit a generation into a node. 'overwrite' reuses the given node;
 * 'newNode' first creates one exportImage node. Only the first image is
 * submitted now — the rest queue up and are submitted as each completes.
 */
export async function submitImageNodeGeneration(params: {
  nodeId: string;
  mode: ImageGenerationMode;
  payload: ImageGenerationPayload;
  count: number;
  deps: ImageGenerationDeps;
  position?: { x: number; y: number };
}): Promise<void> {
  const { nodeId, mode, payload, count, deps, position } = params;
  const total = Math.max(1, Math.floor(count));

  const targetNodeId = mode === 'newNode'
    ? deps.addNode(CANVAS_NODE_TYPES.exportImage, position ?? { x: 0, y: 0 }, { isGenerating: true })
    : nodeId;

  deps.updateNodeData(targetNodeId, {
    isGenerating: true,
    generationStartedAt: Date.now(),
    generationError: null,
    generationErrorDetails: null,
  });

  const jobId = await deps.submitJob(payload);
  deps.updateNodeData(targetNodeId, { generationJobId: jobId });

  if (total > 1) {
    pendingGenerations.set(targetNodeId, Array.from({ length: total - 1 }, () => payload));
  }
}
