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
