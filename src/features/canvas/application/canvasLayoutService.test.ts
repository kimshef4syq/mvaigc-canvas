import { describe, it, expect } from 'vitest';
import { CANVAS_NODE_TYPES, type CanvasNode, type CanvasEdge } from '@/features/canvas/domain/canvasNodes';
import {
  organizeByConnection,
  organizeByMaterial,
  organizeByDirection,
} from './canvasLayoutService';

function makeNode(id: string, type: any, x: number, y: number): CanvasNode {
  return {
    id,
    type,
    position: { x, y },
    data: {} as any,
  };
}

describe('canvasLayoutService', () => {
  it('organizes linear pipeline left to right by connection', () => {
    const nodes: CanvasNode[] = [
      makeNode('node-1', CANVAS_NODE_TYPES.aiText, 500, 300),
      makeNode('node-2', CANVAS_NODE_TYPES.exportImage, 100, 100),
      makeNode('node-3', CANVAS_NODE_TYPES.aiVideo, 800, 600),
    ];
    const edges: CanvasEdge[] = [
      { id: 'e1', source: 'node-1', target: 'node-2' } as CanvasEdge,
      { id: 'e2', source: 'node-2', target: 'node-3' } as CanvasEdge,
    ];

    const result = organizeByConnection(nodes, edges, { origin: { x: 0, y: 0 } });
    const pos1 = result.find((r) => r.nodeId === 'node-1')!.position;
    const pos2 = result.find((r) => r.nodeId === 'node-2')!.position;
    const pos3 = result.find((r) => r.nodeId === 'node-3')!.position;

    // node-1 (source) should have smaller X than node-2, which is smaller than node-3
    expect(pos1.x).toBeLessThan(pos2.x);
    expect(pos2.x).toBeLessThan(pos3.x);
  });

  it('organizes branching and multiple components safely', () => {
    const nodes: CanvasNode[] = [
      makeNode('root1', CANVAS_NODE_TYPES.aiText, 0, 0),
      makeNode('childA', CANVAS_NODE_TYPES.exportImage, 100, 50),
      makeNode('childB', CANVAS_NODE_TYPES.exportImage, 100, 200),
      makeNode('isolated', CANVAS_NODE_TYPES.blueprint, 400, 400),
    ];
    const edges: CanvasEdge[] = [
      { id: 'e1', source: 'root1', target: 'childA' } as CanvasEdge,
      { id: 'e2', source: 'root1', target: 'childB' } as CanvasEdge,
    ];

    const result = organizeByConnection(nodes, edges, { origin: { x: 50, y: 50 } });
    expect(result).toHaveLength(4);

    const rootPos = result.find((r) => r.nodeId === 'root1')!.position;
    const childAPos = result.find((r) => r.nodeId === 'childA')!.position;
    const childBPos = result.find((r) => r.nodeId === 'childB')!.position;

    expect(rootPos.x).toBeLessThan(childAPos.x);
    expect(childAPos.x).toBe(childBPos.x); // Same layer
    expect(childAPos.y).not.toBe(childBPos.y); // Stacked vertically
  });

  it('organizes by material grouping types into columns', () => {
    const nodes: CanvasNode[] = [
      makeNode('t1', CANVAS_NODE_TYPES.aiText, 10, 10),
      makeNode('v1', CANVAS_NODE_TYPES.aiVideo, 20, 20),
      makeNode('img1', CANVAS_NODE_TYPES.imageEdit, 30, 30),
      makeNode('bp1', CANVAS_NODE_TYPES.blueprint, 40, 40),
    ];

    const result = organizeByMaterial(nodes, { origin: { x: 0, y: 0 } });
    expect(result).toHaveLength(4);

    const textPos = result.find((r) => r.nodeId === 't1')!.position;
    const imgPos = result.find((r) => r.nodeId === 'img1')!.position;
    const videoPos = result.find((r) => r.nodeId === 'v1')!.position;
    const bpPos = result.find((r) => r.nodeId === 'bp1')!.position;

    // Order: Text -> Image -> Video -> Director
    expect(textPos.x).toBeLessThan(imgPos.x);
    expect(imgPos.x).toBeLessThan(videoPos.x);
    expect(videoPos.x).toBeLessThan(bpPos.x);
  });

  it('organizes horizontally, vertically, and grid', () => {
    const nodes: CanvasNode[] = [
      makeNode('n1', 'aiText', 300, 100),
      makeNode('n2', 'aiText', 100, 200),
      makeNode('n3', 'aiText', 500, 300),
    ];

    const horiz = organizeByDirection(nodes, 'horizontal', { origin: { x: 0, y: 0 } });
    expect(horiz[0].position.y).toBe(horiz[1].position.y);
    expect(horiz[0].position.x).toBeLessThan(horiz[1].position.x);

    const vert = organizeByDirection(nodes, 'vertical', { origin: { x: 0, y: 0 } });
    expect(vert[0].position.x).toBe(vert[1].position.x);
    expect(vert[0].position.y).toBeLessThan(vert[1].position.y);

    const grid = organizeByDirection(nodes, 'grid', { origin: { x: 0, y: 0 } });
    expect(grid).toHaveLength(3);
  });
});
