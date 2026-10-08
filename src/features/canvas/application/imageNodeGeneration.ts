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
 * Reference images to send from a 生成图片 panel. Connected images are only
 * attached when the prompt actually references them with an `@图N` token —
 * otherwise mvaigc's proxy would prefix `@图N` for every connected image and
 * silently bind them (a bare prompt must stay pure text-to-image).
 */
export function resolvePanelReferenceImages(prompt: string, connectedImages: string[]): string[] {
  return /(?<![\p{L}\p{N}_])@图\d+/u.test(prompt) ? connectedImages : [];
}

/** Resolve the requested image count: custom wins, clamped to 1..10; else the preset. */
export function normalizeGenerateCount(customCount: string | null, presetCount: number): number {
  const trimmed = typeof customCount === 'string' ? customCount.trim() : '';
  if (trimmed) {
    const parsed = parseInt(trimmed, 10);
    if (Number.isFinite(parsed)) {
      return Math.min(10, Math.max(1, parsed));
    }
  }
  return Math.min(10, Math.max(1, Math.floor(presetCount) || 1));
}

/**
 * Called after a completed image. If this node has queued requests, submit the
 * next one and keep it generating; returns false when nothing is queued (the
 * caller then leaves `isGenerating` false).
 */
export async function drainQueuedGeneration(
  nodeId: string,
  deps: { submitJob: (payload: ImageGenerationPayload) => Promise<string>; updateNodeData: (nodeId: string, patch: Record<string, unknown>) => void }
): Promise<boolean> {
  const next = takeNextQueuedGeneration(nodeId);
  if (!next) {
    return false;
  }
  deps.updateNodeData(nodeId, { isGenerating: true });
  const jobId = await deps.submitJob(next);
  deps.updateNodeData(nodeId, { generationJobId: jobId });
  return true;
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
