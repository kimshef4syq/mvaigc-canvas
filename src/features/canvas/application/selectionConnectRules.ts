import { CANVAS_NODE_TYPES, type CanvasEdge, type CanvasNode, type CanvasNodeType } from '../domain/canvasNodes';
import { nodeHasSourceHandle, nodeHasTargetHandle } from '../domain/nodeRegistry';
import { validateCanvasConnection } from './canvasConnectionRules';
import { referenceMediaKind, type ReferenceMediaKind } from './videoReferenceCandidates';

const IMAGE_ONLY_TARGET_TYPES = new Set<CanvasNodeType>([
  CANVAS_NODE_TYPES.exportImage,
  CANVAS_NODE_TYPES.imageEdit,
]);

const MEDIA_TARGET_TYPES = new Set<CanvasNodeType>([
  CANVAS_NODE_TYPES.aiVideo,
]);

/**
 * Media kinds the target node accepts from a frame selection.
 * `null` means no kind filter — the normal connection rules decide.
 */
export function resolveFrameConnectAcceptedKinds(
  target: CanvasNode,
): ReadonlySet<ReferenceMediaKind> | null {
  if (IMAGE_ONLY_TARGET_TYPES.has(target.type)) {
    return new Set<ReferenceMediaKind>(['image']);
  }
  if (MEDIA_TARGET_TYPES.has(target.type)) {
    return new Set<ReferenceMediaKind>(['image', 'video', 'audio']);
  }
  return null;
}

/**
 * Expands a frame selection into the source node ids that can actually be
 * connected to `targetNodeId`. Nodes without a media kind (director studio,
 * groups, tags, text) opt out and keep their own behaviour.
 */
export function resolveFrameConnectSourceIds(
  selectedNodeIds: readonly string[],
  targetNodeId: string,
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[],
): string[] {
  const target = nodes.find((node) => node.id === targetNodeId);
  if (!target || !nodeHasTargetHandle(target.type)) {
    return [];
  }
  const acceptedKinds = resolveFrameConnectAcceptedKinds(target);
  const selectedIds = new Set(selectedNodeIds);
  const result: string[] = [];
  for (const node of nodes) {
    if (!selectedIds.has(node.id) || node.id === targetNodeId) {
      continue;
    }
    if (!nodeHasSourceHandle(node.type)) {
      continue;
    }
    const kind = referenceMediaKind(node);
    if (!kind) {
      continue;
    }
    if (acceptedKinds && !acceptedKinds.has(kind)) {
      continue;
    }
    const validation = validateCanvasConnection(node.id, targetNodeId, [...nodes], [...edges]);
    if (!validation.valid) {
      continue;
    }
    result.push(node.id);
  }
  return result;
}
