import { describe, expect, it } from 'vitest';
import { validateCanvasConnection } from './canvasConnectionRules';
import type { CanvasNode, CanvasEdge } from '../domain/canvasNodes';
const nodes = [
  { id: 'g', type: 'gaussianNode' }, { id: 'a', type: 'uploadNode' },
  { id: 'b', type: 'exportImageNode' }, { id: 'v', type: 'videoNode' },
].map(n => ({ ...n, position: { x: 0, y: 0 }, data: {} })) as CanvasNode[];
describe('Gaussian image input connections', () => {
  it('accepts uploaded and generated images and rejects video', () => {
    expect(validateCanvasConnection('a', 'g', nodes, []).valid).toBe(true);
    expect(validateCanvasConnection('b', 'g', nodes, []).valid).toBe(true);
    expect(validateCanvasConnection('v', 'g', nodes, []).valid).toBe(false);
  });
  it('rejects a second image while allowing an existing connection', () => {
    const edges = [{ id: 'e', source: 'a', target: 'g' }] as CanvasEdge[];
    expect(validateCanvasConnection('b', 'g', nodes, edges).valid).toBe(false);
    expect(validateCanvasConnection('a', 'g', nodes, edges).code).toBe('duplicate');
  });
});
