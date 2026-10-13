import { describe, expect, it } from 'vitest';

import { CANVAS_NODE_TYPES } from './canvasNodes';
import { getConnectMenuNodeTypes, getMenuNodeDefinitions, orderMenuDefinitions, getNodeDefinition } from './nodeRegistry';

describe('canvas node menu order', () => {
  it('leads with 生成图片 then 生成视频', () => {
    const types = getMenuNodeDefinitions().map((definition) => definition.type);
    expect(types[0]).toBe(CANVAS_NODE_TYPES.exportImage);
    expect(types[1]).toBe(CANVAS_NODE_TYPES.aiVideo);
  });

  it('keeps every visible definition in the menu', () => {
    const types = getMenuNodeDefinitions().map((definition) => definition.type);
    expect(new Set(types).size).toBe(types.length);
    expect(types).toContain(CANVAS_NODE_TYPES.jsonCard);
    expect(types).toContain(CANVAS_NODE_TYPES.upload);
  });

  it('leads the connect menu with 生成图片 then 生成视频 too', () => {
    const connectDefinitions = getConnectMenuNodeTypes('source').map((type) => getNodeDefinition(type));
    const types = orderMenuDefinitions(connectDefinitions).map((definition) => definition.type);
    expect(types[0]).toBe(CANVAS_NODE_TYPES.exportImage);
    expect(types[1]).toBe(CANVAS_NODE_TYPES.aiVideo);
  });
});
