import { describe, expect, it } from 'vitest';

import { CANVAS_NODE_TYPES } from './canvasNodes';
import { nodeHasSourceHandle, nodeHasTargetHandle } from './nodeRegistry';

/**
 * Guard for the reference-connection direction used by the 生成视频 node's
 * frame capture (and the 生成图片 panel's + button): a captured frame becomes an
 * `upload` node that feeds the prompt node. `upload` has no target handle, so
 * the edge must be `upload → promptNode`, never the reverse.
 */
describe('reference connection direction', () => {
  it('allows upload as a source and as the target of aiVideo/exportImage', () => {
    expect(nodeHasSourceHandle(CANVAS_NODE_TYPES.upload)).toBe(true);
    expect(nodeHasTargetHandle(CANVAS_NODE_TYPES.upload)).toBe(false);

    expect(nodeHasTargetHandle(CANVAS_NODE_TYPES.aiVideo)).toBe(true);
    expect(nodeHasTargetHandle(CANVAS_NODE_TYPES.exportImage)).toBe(true);
  });

  it('rejects the reversed edge (aiVideo → upload) that dropped the frame node', () => {
    // upload → aiVideo is valid; aiVideo → upload is not (upload can't be a target).
    const forwardValid = nodeHasSourceHandle(CANVAS_NODE_TYPES.upload)
      && nodeHasTargetHandle(CANVAS_NODE_TYPES.aiVideo);
    const reversedValid = nodeHasSourceHandle(CANVAS_NODE_TYPES.aiVideo)
      && nodeHasTargetHandle(CANVAS_NODE_TYPES.upload);

    expect(forwardValid).toBe(true);
    expect(reversedValid).toBe(false);
  });
});
