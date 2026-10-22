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

  it('aligns a generation result column to its parent node instead of centering the column', () => {
    // 单个连通分量：源节点连出 2 张结果图，同层还有几张关键帧把该层撑高。
    // 修复前：结果列被"垂直居中"到远离生成节点的地方；修复后应贴近其父节点。
    const nodes: CanvasNode[] = [
      makeNode('p', CANVAS_NODE_TYPES.aiText, 0, 0),
      makeNode('kf4', CANVAS_NODE_TYPES.exportImage, 500, 0),
      makeNode('kf5', CANVAS_NODE_TYPES.exportImage, 500, 300),
      makeNode('gen', CANVAS_NODE_TYPES.imageEdit, 500, 600),
      makeNode('res-1', CANVAS_NODE_TYPES.exportImage, 900, 0),
      makeNode('res-2', CANVAS_NODE_TYPES.exportImage, 900, 300),
    ];
    const edges: CanvasEdge[] = [
      { id: 'e1', source: 'p', target: 'kf4' } as CanvasEdge,
      { id: 'e2', source: 'p', target: 'kf5' } as CanvasEdge,
      { id: 'e3', source: 'p', target: 'gen' } as CanvasEdge,
      { id: 'e4', source: 'gen', target: 'res-1' } as CanvasEdge,
      { id: 'e5', source: 'gen', target: 'res-2' } as CanvasEdge,
    ];

    const result = organizeByConnection(nodes, edges, { origin: { x: 0, y: 0 } });
    const posOf = (id: string) => result.find((r) => r.nodeId === id)!.position;

    // 结果列应与父节点 gen 处于同一纵向邻域（不相差远超一个节点高度）
    const genY = posOf('gen').y;
    const resMidY = (posOf('res-1').y + posOf('res-2').y) / 2;
    expect(Math.abs(resMidY - genY)).toBeLessThan(240);
  });

  it('keeps grouped children out of the flat layout (they stay relative to their group)', () => {
    const group = makeNode('g1', CANVAS_NODE_TYPES.group, 100, 100);
    (group as any).style = { width: 400, height: 300 };
    const child1 = { ...makeNode('c1', CANVAS_NODE_TYPES.imageEdit, 20, 40), parentId: 'g1' } as CanvasNode;
    const child2 = { ...makeNode('c2', CANVAS_NODE_TYPES.aiText, 20, 180), parentId: 'g1' } as CanvasNode;
    const other = makeNode('t1', CANVAS_NODE_TYPES.aiText, 700, 100);

    const result = organizeByConnection([group, child1, child2, other], [
      { id: 'e1', source: 't1', target: 'g1' } as CanvasEdge,
    ], { origin: { x: 0, y: 0 } });

    const ids = result.map((r) => r.nodeId);
    // 组内子节点（有 parentId）不参与扁平排布，保持其相对坐标不动。
    expect(ids).not.toContain('c1');
    expect(ids).not.toContain('c2');
    // 组节点本身与其它顶层节点照常排布。
    expect(ids).toContain('g1');
    expect(ids).toContain('t1');
  });
});
