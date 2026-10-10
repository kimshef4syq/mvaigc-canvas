import { describe, expect, it } from 'vitest';

import { CANVAS_NODE_TYPES } from './canvasNodes';
import {
  nodeCanStartManualConnection,
  nodeHasSourceHandle,
  nodeHasTargetHandle,
} from './nodeRegistry';

/**
 * Guard for the connection directions used by the video node's frame capture
 * and the 生成图片 panel's + button.
 *
 * - 生成图片 panel `+`: upload → promptNode. `upload` has no target handle, so
 *   the edge must be `upload → promptNode`, never the reverse.
 * - 生成视频 frame capture: video → frame. The frame node is a 生成图片
 *   (exportImage) node, which accepts an incoming edge, so the edge is
 *   `video → frame` (downstream of the video).
 */
describe('reference connection direction', () => {
  it('upload can be a source but never a target', () => {
    expect(nodeHasSourceHandle(CANVAS_NODE_TYPES.upload)).toBe(true);
    expect(nodeHasTargetHandle(CANVAS_NODE_TYPES.upload)).toBe(false);
  });

  it('aiVideo and exportImage both accept incoming edges', () => {
    expect(nodeHasTargetHandle(CANVAS_NODE_TYPES.aiVideo)).toBe(true);
    expect(nodeHasTargetHandle(CANVAS_NODE_TYPES.exportImage)).toBe(true);
  });

  it('frame capture edge is video → frame (exportImage)', () => {
    // The frame node is an exportImage node, which accepts a target handle, so
    // `video → frame` is a valid connection.
    expect(
      nodeHasSourceHandle(CANVAS_NODE_TYPES.aiVideo)
      && nodeHasTargetHandle(CANVAS_NODE_TYPES.exportImage),
    ).toBe(true);
  });

  it('aiVideo can be dragged out as a source (生成视频 → 生成视频)', () => {
    // Without manualSource the output handle is not draggable at all, so a
    // generated video can never feed another generation.
    expect(nodeCanStartManualConnection(CANVAS_NODE_TYPES.aiVideo)).toBe(true);
  });

  it('导演台可作为手动连线起点，喂给生成图片 / 生成视频', () => {
    // The director studio exposes a source handle; without manualSource the
    // handle renders but dragging is rejected, so its screenshot can never be
    // used as a reference input.
    expect(nodeCanStartManualConnection(CANVAS_NODE_TYPES.blueprint)).toBe(true);
    expect(nodeHasSourceHandle(CANVAS_NODE_TYPES.blueprint)).toBe(true);
    expect(nodeHasTargetHandle(CANVAS_NODE_TYPES.imageEdit)).toBe(true);
    expect(nodeHasTargetHandle(CANVAS_NODE_TYPES.aiVideo)).toBe(true);
  });
});
