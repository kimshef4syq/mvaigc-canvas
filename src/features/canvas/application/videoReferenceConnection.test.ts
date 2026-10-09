import { describe, expect, it } from 'vitest';

import { CANVAS_NODE_TYPES, type CanvasNode } from '@/features/canvas/domain/canvasNodes';

import { validateCanvasConnection } from './canvasConnectionRules';

function node(id: string, type: CanvasNode['type']): CanvasNode {
  return { id, type, position: { x: 0, y: 0 }, data: {} } as CanvasNode;
}

/**
 * A video (or an upload node holding a video) must be connectable INTO the
 * generate-video (aiVideo) node as a reference source, the same way images are.
 */
describe('video → aiVideo connection', () => {
  it('is allowed by the connection rules', () => {
    const nodes = [
      node('v1', CANVAS_NODE_TYPES.video),
      node('a1', CANVAS_NODE_TYPES.aiVideo),
    ];
    const result = validateCanvasConnection('v1', 'a1', nodes, []);
    expect(result.valid).toBe(true);
  });

  it('is allowed for an upload node holding a video', () => {
    const nodes = [
      node('u1', CANVAS_NODE_TYPES.upload),
      node('a1', CANVAS_NODE_TYPES.aiVideo),
    ];
    expect(validateCanvasConnection('u1', 'a1', nodes, []).valid).toBe(true);
  });
});
