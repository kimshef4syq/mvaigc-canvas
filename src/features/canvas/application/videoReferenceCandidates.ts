import {
  CANVAS_NODE_TYPES,
  isAudioNode,
  isExportImageNode,
  isImageEditNode,
  isStoryboardGenNode,
  isStoryboardSplitNode,
  isUploadNode,
  isVideoNode,
  type CanvasEdge,
  type CanvasNode,
} from '@/features/canvas/domain/canvasNodes';

export type ReferenceMediaKind = 'image' | 'video' | 'audio';

export interface ReferenceCandidate {
  nodeId: string;
  kind: ReferenceMediaKind;
  /** Display name for the picker row. */
  label: string;
}

/**
 * Classify a canvas node as a reference media source, or null when it is not
 * usable as a video-node reference (text/group/tag/etc).
 */
export function referenceMediaKind(node: CanvasNode): ReferenceMediaKind | null {
  if (isUploadNode(node) || isImageEditNode(node) || isExportImageNode(node)) return 'image';
  if (isStoryboardSplitNode(node) || isStoryboardGenNode(node)) return 'image';
  if (isVideoNode(node)) return 'video';
  if (isAudioNode(node)) return 'audio';
  return null;
}

function nodeLabel(node: CanvasNode): string {
  const data = node.data as { displayName?: unknown; sourceFileName?: unknown };
  if (typeof data?.displayName === 'string' && data.displayName.trim()) return data.displayName;
  if (typeof data?.sourceFileName === 'string' && data.sourceFileName.trim()) return data.sourceFileName;
  return node.id;
}

/**
 * Media nodes on the canvas that can be added as references to `targetNodeId`,
 * grouped by kind and excluding ones already connected to the target.
 * Order follows canvas node order for stability.
 */
export function listReferenceCandidates(
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[],
  targetNodeId: string,
): Record<ReferenceMediaKind, ReferenceCandidate[]> {
  const connected = new Set(
    edges
      .filter((edge) => edge.target === targetNodeId)
      .map((edge) => edge.source),
  );
  const result: Record<ReferenceMediaKind, ReferenceCandidate[]> = { image: [], video: [], audio: [] };
  for (const node of nodes) {
    if (node.id === targetNodeId || connected.has(node.id)) continue;
    const kind = referenceMediaKind(node);
    if (!kind) continue;
    result[kind].push({ nodeId: node.id, kind, label: nodeLabel(node) });
  }
  return result;
}

export interface ReferenceSlotState {
  enabled: boolean;
  /** Current connected count for that kind. */
  count: number;
  /** Slot cap from the merged schema. */
  max: number;
}

/**
 * Whether a kind's "add" entry should be offered/enabled given the current
 * mode's schema and how many are already connected. Disabled when the mode
 * does not take that kind, or the cap is reached.
 */
export function canAddReferenceKind(slot: ReferenceSlotState): boolean {
  return slot.enabled && slot.count < slot.max;
}

export { CANVAS_NODE_TYPES };
