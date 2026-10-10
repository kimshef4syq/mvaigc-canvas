import { describe, expect, it } from 'vitest';

import { CANVAS_NODE_TYPES, type CanvasNode } from '@/features/canvas/domain/canvasNodes';

import { collectInputReferences } from './graphReferenceResolver';

function node(
  id: string,
  type: CanvasNode['type'],
  data: Record<string, unknown>
): CanvasNode {
  return { id, type, position: { x: 0, y: 0 }, data } as CanvasNode;
}

function edge(source: string, target: string) {
  return { id: `e-${source}-${target}`, source, target, sourceHandle: 'source', targetHandle: 'target' };
}

describe('generated-video → aiVideo reference', () => {
  it('exposes an aiVideo node output as a video reference', () => {
    const nodes = [
      node('a1', CANVAS_NODE_TYPES.aiVideo, { videoUrl: 'local-media://clip.mp4', thumbnailUrl: 'local-media://poster.jpg' }),
      node('a2', CANVAS_NODE_TYPES.aiVideo, { prompt: '' }),
    ];
    const references = collectInputReferences('a2', nodes, [edge('a1', 'a2')]);
    expect(references).toHaveLength(1);
    expect(references[0]).toMatchObject({
      kind: 'video',
      sourceNodeId: 'a1',
      videoUrl: 'local-media://clip.mp4',
      thumbnailUrl: 'local-media://poster.jpg',
    });
  });

  it('falls back to the main history entry when the mirror fields are absent', () => {
    const nodes = [
      node('a1', CANVAS_NODE_TYPES.aiVideo, {
        videos: [
          { id: 'v1', videoUrl: 'local-media://old.mp4', thumbnailUrl: null, aspectRatio: '16:9', createdAt: 1 },
          { id: 'v2', videoUrl: 'local-media://new.mp4', thumbnailUrl: 'local-media://new.jpg', aspectRatio: '16:9', createdAt: 2 },
        ],
        mainVideoIndex: 1,
      }),
      node('a2', CANVAS_NODE_TYPES.aiVideo, { prompt: '' }),
    ];
    const references = collectInputReferences('a2', nodes, [edge('a1', 'a2')]);
    expect(references[0]).toMatchObject({ kind: 'video', videoUrl: 'local-media://new.mp4' });
  });

  it('yields no reference for an aiVideo node with no video yet', () => {
    const nodes = [
      node('a1', CANVAS_NODE_TYPES.aiVideo, { prompt: 'x', isGenerating: true }),
      node('a2', CANVAS_NODE_TYPES.aiVideo, { prompt: '' }),
    ];
    expect(collectInputReferences('a2', nodes, [edge('a1', 'a2')])).toEqual([]);
  });
});

describe('导演台（blueprint）→ 生成图片 / 生成视频 参考', () => {
  it('把导演台截图的截图暴露为生成图片节点的图片参考', () => {
    const nodes = [
      node('d1', CANVAS_NODE_TYPES.blueprint, { snapshotUrl: 'local-media://shot.png' }),
      node('i1', CANVAS_NODE_TYPES.imageEdit, { prompt: '' }),
    ];
    const references = collectInputReferences('i1', nodes, [edge('d1', 'i1')]);
    expect(references).toHaveLength(1);
    expect(references[0]).toMatchObject({
      kind: 'image',
      sourceNodeId: 'd1',
      imageUrl: 'local-media://shot.png',
    });
  });

  it('把导演台截图暴露为生成视频节点的图片参考', () => {
    const nodes = [
      node('d1', CANVAS_NODE_TYPES.blueprint, { snapshotUrl: 'local-media://shot.png' }),
      node('v1', CANVAS_NODE_TYPES.aiVideo, { prompt: '' }),
    ];
    const references = collectInputReferences('v1', nodes, [edge('d1', 'v1')]);
    expect(references).toHaveLength(1);
    expect(references[0]).toMatchObject({ kind: 'image', sourceNodeId: 'd1', imageUrl: 'local-media://shot.png' });
  });

  it('当前截图缺失时回退到截图历史，尚未截图才返回空', () => {
    const withHistory = [
      node('d1', CANVAS_NODE_TYPES.blueprint, { snapshotUrl: null, snapshotHistory: ['local-media://old.png', 'local-media://new.png'] }),
      node('i1', CANVAS_NODE_TYPES.imageEdit, { prompt: '' }),
    ];
    expect(collectInputReferences('i1', withHistory, [edge('d1', 'i1')])[0]).toMatchObject({ imageUrl: 'local-media://new.png' });

    const empty = [
      node('d1', CANVAS_NODE_TYPES.blueprint, { snapshotUrl: null, snapshotHistory: [] }),
      node('i1', CANVAS_NODE_TYPES.imageEdit, { prompt: '' }),
    ];
    expect(collectInputReferences('i1', empty, [edge('d1', 'i1')])).toEqual([]);
  });
});
