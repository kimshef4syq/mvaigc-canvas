import { CANVAS_NODE_TYPES } from '@/features/canvas/domain/canvasNodes';

export type VideoGenerationMode = 'overwrite' | 'newNode';

export interface VideoGenerationPayload {
  prompt: string;
  model: string;
  size: string;
  aspectRatio: string;
  seconds?: number;
  referenceImages: string[];
  referenceVideos?: string[];
  referenceAudios?: string[];
  extraParams: Record<string, unknown>;
}

export interface VideoGenerationDeps {
  addNode: (
    type: typeof CANVAS_NODE_TYPES.video,
    position: { x: number; y: number },
    data?: Record<string, unknown>
  ) => string;
  updateNodeData: (nodeId: string, patch: Record<string, unknown>) => void;
  submitJob: (payload: VideoGenerationPayload) => Promise<string>;
}

/**
 * Submit a video generation into a node. 'overwrite' writes the result back
 * into the given node; 'newNode' first creates one `video` node. Returns the
 * node the job was submitted into so the caller can route the backfill.
 */
export async function submitVideoNodeGeneration(params: {
  nodeId: string;
  mode: VideoGenerationMode;
  payload: VideoGenerationPayload;
  deps: VideoGenerationDeps;
  position?: { x: number; y: number };
  resultNodeData?: Record<string, unknown>;
}): Promise<{ targetNodeId: string }> {
  const { nodeId, mode, payload, deps, position, resultNodeData } = params;

  const targetNodeId = mode === 'newNode'
    ? deps.addNode(CANVAS_NODE_TYPES.video, position ?? { x: 0, y: 0 }, {
      isGenerating: true,
      ...(resultNodeData ?? {}),
    })
    : nodeId;

  deps.updateNodeData(targetNodeId, {
    isGenerating: true,
    generationStartedAt: Date.now(),
    generationError: null,
    generationErrorDetails: null,
  });

  const jobId = await deps.submitJob(payload);
  deps.updateNodeData(targetNodeId, { generationJobId: jobId });

  return { targetNodeId };
}
