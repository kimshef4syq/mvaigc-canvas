import type { CanvasCommandOutput, CanvasGraphSnapshot, CanvasQueryCommand } from '../domain/canvasCommands';
import type { CanvasNode } from '../domain/canvasNodes';
import { projectCanvasNodeForRead, projectCanvasReadValue } from './canvasReadProjection';

const PAGE_BYTES = 40 * 1024;
const encoder = new TextEncoder();

function summary(node: CanvasNode) {
  const data = node.data as Record<string, unknown>;
  const selected: Record<string, unknown> = {};
  for (const key of ['displayName', 'title', 'label', 'prompt', 'sourcePrompt', 'content', 'modelId',
    'aspectRatio', 'duration', 'enabled', 'generationStatus', 'generationError']) {
    const value = data[key];
    if (typeof value === 'string') selected[key] = projectCanvasReadValue(value.slice(0, 240), key);
    else if (typeof value === 'number' || typeof value === 'boolean') selected[key] = value;
  }
  return { id: node.id, type: node.type, position: node.position, parentId: node.parentId ?? null,
    selected: Boolean(node.selected), data: selected,
    availableDataFields: Object.keys(data).slice(0, 60).map((key) => key.slice(0, 80)) };
}

/** Bounded, independently paginated nodes and edges. Existing value shapes remain compatible. */
export function readCanvasQueryPage(
  snapshot: CanvasGraphSnapshot,
  input: CanvasQueryCommand['input'],
): CanvasCommandOutput {
  const limit = Math.min(input.limit ?? 100, 100);
  const offset = input.offset ?? 0;
  const filter = input.nodeIds ? new Set(input.nodeIds) : null;
  const allNodes = snapshot.nodes.filter((node) => !filter || filter.has(node.id));
  const allEdges = snapshot.edges.filter((edge) => !filter || filter.has(edge.source) || filter.has(edge.target));
  const nodes: unknown[] = [];
  const edges: { id: string; source: string; target: string }[] = [];
  const nodeIds: string[] = [];
  const omitted: string[] = [];
  let bytes = 0;
  const fits = (value: unknown) => {
    const size = encoder.encode(JSON.stringify(value)).length;
    if (bytes + size > PAGE_BYTES) return false;
    bytes += size;
    return true;
  };
  const wantsNodes = input.scope === 'graph' || input.scope === 'nodes';
  const wantsEdges = input.scope === 'graph' || input.scope === 'edges';
  if (wantsNodes) {
    for (const node of allNodes.slice(offset, offset + limit)) {
      let value = input.detail === 'summary' ? summary(node) : input.fields
        ? { id: node.id, type: node.type, position: node.position, parentId: node.parentId ?? null,
          selected: Boolean(node.selected), data: Object.fromEntries(input.fields
            .filter((key) => Object.prototype.hasOwnProperty.call(node.data, key))
            .map((key) => [key, projectCanvasReadValue((node.data as Record<string, unknown>)[key], key)])) }
        : projectCanvasNodeForRead(node);
      if (!fits(value)) {
        if (nodes.length > 0) break;
        value = { ...summary(node), detailsOmitted: true };
        if (!fits(value)) throw new Error('A node summary exceeds the canvas query page limit.');
        omitted.push(node.id);
      }
      nodes.push(value);
      nodeIds.push(node.id);
    }
  }
  const edgeOffset = input.scope === 'graph' ? input.edgeOffset ?? offset : offset;
  if (wantsEdges) {
    for (const edge of allEdges.slice(edgeOffset, edgeOffset + limit)) {
      const value = { id: edge.id, source: edge.source, target: edge.target };
      if (!fits(value)) {
        if (nodes.length === 0 && edges.length === 0) throw new Error('An edge exceeds the canvas query page limit. Narrow nodeIds.');
        break;
      }
      edges.push(value);
    }
  }
  const selected = snapshot.nodes.filter((node) => node.selected);
  const selection = selected.slice(offset, offset + limit).map((node) => node.id);
  const nodeTotal = input.scope === 'selection' ? selected.length : allNodes.length;
  const nodeCount = input.scope === 'selection' ? selection.length : nodes.length;
  const nextNodeOffset = offset + nodeCount < nodeTotal ? offset + nodeCount : null;
  const nextEdgeOffset = edgeOffset + edges.length < allEdges.length ? edgeOffset + edges.length : null;
  const hasMore = ((wantsNodes || input.scope === 'selection') && nextNodeOffset !== null)
    || (wantsEdges && nextEdgeOffset !== null);
  const nextInput = hasMore ? { ...input, limit,
    offset: input.scope === 'edges' ? nextEdgeOffset! : nextNodeOffset ?? nodeTotal,
    ...(input.scope === 'graph' ? { edgeOffset: nextEdgeOffset ?? allEdges.length } : {}) } : null;
  const value = input.scope === 'nodes' ? nodes : input.scope === 'edges' ? edges
    : input.scope === 'selection' ? { selectedNodeIds: selection }
      : { revision: snapshot.revision, nodes, edges };
  return { references: { nodeIds: input.scope === 'selection' ? selection : nodeIds,
    edgeIds: edges.map((edge) => edge.id) }, value,
    page: { revision: snapshot.revision, detail: input.detail ?? 'full', limit,
      totalNodes: nodeTotal, totalEdges: allEdges.length, returnedNodes: nodeCount, returnedEdges: edges.length,
      hasMore, nextInput, ...(omitted.length ? { detailsOmittedNodeIds: omitted,
        warning: 'Some node details exceeded the page budget. Request detail:"full", nodeIds:[id], fields:[specific data field names].' } : {}) } };
}
