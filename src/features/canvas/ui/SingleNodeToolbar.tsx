import type { ComponentProps } from 'react';
import { NodeToolbar } from '@xyflow/react';
import { useCanvasStore } from '@/stores/canvasStore';
import type { CanvasNode } from '../domain/canvasNodes';

export function hasMultipleSelectedNodes(state: { nodes: CanvasNode[] }): boolean {
  let count = 0;
  for (const node of state.nodes) {
    if (node.selected && ++count > 1) return true;
  }
  return false;
}

export function useIsMultiNodeSelection(): boolean {
  return useCanvasStore(hasMultipleSelectedNodes);
}

/** Explicit isVisible must never expose per-node portals during multi-selection. */
export function SingleNodeToolbar(props: ComponentProps<typeof NodeToolbar>) {
  const multiSelected = useIsMultiNodeSelection();
  return multiSelected ? null : <NodeToolbar {...props} />;
}
