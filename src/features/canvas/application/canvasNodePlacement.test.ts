import { describe, expect, it } from 'vitest';

import { CANVAS_NODE_TYPES, type CanvasNode } from '../domain/canvasNodes';
import { findRelatedCanvasNodePositions, getCanvasNodeSize } from './canvasNodePlacement';

function node(id: string, x: number, y: number, width = 300, height = 240): CanvasNode {
  return {
    id,
    type: CANVAS_NODE_TYPES.imageEdit,
    position: { x, y },
    measured: { width, height },
    data: {} as CanvasNode['data'],
  };
}

function overlaps(
  position: { x: number; y: number },
  size: { width: number; height: number },
  obstacle: CanvasNode,
): boolean {
  const width = obstacle.measured?.width ?? 300;
  const height = obstacle.measured?.height ?? 240;
  return position.x < obstacle.position.x + width + 18
    && position.x + size.width + 18 > obstacle.position.x
    && position.y < obstacle.position.y + height + 18
    && position.y + size.height + 18 > obstacle.position.y;
}

describe('findRelatedCanvasNodePositions', () => {
  it('chooses a roomy nearby gap instead of walking down a long first-fit column', () => {
    const nodes = [
      node('source', 0, 0, 460, 520),
      node('right-1', 500, 0, 420, 300),
      node('right-2', 500, 330, 420, 300),
      node('below', 0, 560, 360, 300),
    ];
    const [position] = findRelatedCanvasNodePositions({
      nodes,
      relatedNodeId: 'source',
      desired: { x: 488, y: 0 },
      size: { width: 384, height: 288 },
    });
    expect(Math.hypot(position.x - 488, position.y)).toBeLessThan(1_500);
    expect(position.y).toBeLessThan(1_800);
    expect(position).not.toEqual({ x: 488, y: 660 });
    expect(nodes.every((obstacle) => !overlaps(position, { width: 384, height: 288 }, obstacle))).toBe(true);
  });

  it('reserves separate collision-free slots for a batch', () => {
    const positions = findRelatedCanvasNodePositions({
      nodes: [node('source', 0, 0)],
      relatedNodeId: 'source',
      desired: { x: 332, y: 0 },
      size: { width: 220, height: 180 },
      count: 3,
    });
    expect(new Set(positions.map(({ x, y }) => `${x}:${y}`))).toHaveLength(3);
    positions.forEach((position, index) => {
      expect(overlaps(position, { width: 220, height: 180 }, node('source', 0, 0))).toBe(false);
      positions.slice(index + 1).forEach((other) => {
        expect(overlaps(position, { width: 220, height: 180 }, node('reserved', other.x, other.y, 220, 180))).toBe(false);
      });
    });
  });
  it('reserves the real size of generation cards before measurement', () => {
    expect(getCanvasNodeSize({ type: CANVAS_NODE_TYPES.imageEdit })).toEqual({ width: 680, height: 380 });
    expect(getCanvasNodeSize({ type: CANVAS_NODE_TYPES.aiVideo })).toEqual({ width: 680, height: 360 });
    // 生成图片结果节点（exportImage）无 defaultSize，未测量时不能回退到过窄的 220，
    // 否则自动分组的列距会小于卡片实际宽度 → 重叠。
    const exportImage = getCanvasNodeSize({ type: CANVAS_NODE_TYPES.exportImage });
    expect(exportImage.width).toBeGreaterThanOrEqual(384);
    expect(exportImage.height).toBeGreaterThanOrEqual(288);
    const source = { id: 'fresh', type: CANVAS_NODE_TYPES.aiVideo, position: { x: 0, y: 0 }, data: {} } as CanvasNode;
    const [position] = findRelatedCanvasNodePositions({ nodes: [source], desired: { x: 250, y: 0 }, size: { width: 384, height: 288 } });
    expect(overlaps(position, { width: 384, height: 288 }, node('real-size', 0, 0, 680, 360))).toBe(false);
  });

  it('escapes a dense canvas without returning an unchecked overlapping fallback', () => {
    const obstacle = node('large-board', -10000, -10000, 20000, 20000);
    const [position] = findRelatedCanvasNodePositions({ nodes: [obstacle], desired: { x: 0, y: 0 }, size: { width: 384, height: 288 } });
    expect(overlaps(position, { width: 384, height: 288 }, obstacle)).toBe(false);
  });

  it('uses absolute coordinates for nodes inside groups', () => {
    const child = { ...node('child', 0, 0), parentId: 'group' };
    const parent = node('group', 2000, 1000, 20, 20);
    const [position] = findRelatedCanvasNodePositions({ nodes: [parent, child], desired: { x: 2000, y: 1100 }, size: { width: 220, height: 180 } });
    expect(overlaps(position, { width: 220, height: 180 }, node('absolute-child', 2000, 1000))).toBe(false);
  });

});
