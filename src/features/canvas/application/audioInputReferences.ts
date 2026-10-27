import { shallow } from 'zustand/shallow';
import type { CanvasEdge, CanvasNode } from '@/features/canvas/domain/canvasNodes';
import { collectInputReferences, type GraphReferenceItem } from './graphReferenceResolver';

type ReferenceState = { nodes: CanvasNode[]; edges: CanvasEdge[] };

/** Reference content depends on node data and graph topology, never layout or selection.
 * Keep the selector result stable so dragging cannot rehash an inline audio file. */
export function createAudioInputReferencesSelector(nodeId: string) {
  let previousNodes: CanvasNode[] | undefined;
  let previousEdges: CanvasEdge[] | undefined;
  let references: GraphReferenceItem[] = [];
  return ({ nodes, edges }: ReferenceState): GraphReferenceItem[] => {
    const sameNodes = previousNodes === nodes || (previousNodes?.length === nodes.length
      && nodes.every((node, index) => {
        const previous = previousNodes![index];
        return node.id === previous.id && node.type === previous.type && node.data === previous.data;
      }));
    const sameEdges = previousEdges === edges || (previousEdges?.length === edges.length
      && edges.every((edge, index) => {
        const previous = previousEdges![index];
        return edge.id === previous.id && edge.source === previous.source && edge.target === previous.target;
      }));
    previousNodes = nodes;
    previousEdges = edges;
    if (sameNodes && sameEdges) return references;
    const next = collectInputReferences(nodeId, nodes, edges)
      .filter((reference) => reference.kind === 'audio' || reference.kind === 'text');
    if (next.length !== references.length || next.some((item, index) => !shallow(item, references[index]))) {
      references = next;
    }
    return references;
  };
}
