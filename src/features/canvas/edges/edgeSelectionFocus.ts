import type { CanvasNode } from '@/features/canvas/domain/canvasNodes';

type SelectableNode = Pick<CanvasNode, 'id' | 'selected' | 'hidden'>;
export type EdgeSelectionFocus = 'default' | 'upstream' | 'dimmed';

// Every edge shares one selection scan per immutable node-array update.
const selectedIdsByNodes = new WeakMap<readonly SelectableNode[], ReadonlySet<string>>();

export function getEdgeSelectionFocus(
  nodes: readonly SelectableNode[],
  targetId: string,
): EdgeSelectionFocus {
  let selectedIds = selectedIdsByNodes.get(nodes);
  if (!selectedIds) {
    selectedIds = new Set(nodes.filter((node) => node.selected && !node.hidden).map((node) => node.id));
    selectedIdsByNodes.set(nodes, selectedIds);
  }
  if (selectedIds.size === 0) return 'default';
  return selectedIds.has(targetId) ? 'upstream' : 'dimmed';
}
