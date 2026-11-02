import { describe, expect, it } from 'vitest';

import { CANVAS_NODE_TYPES, type CanvasNode } from '../domain/canvasNodes';
import { resolveFrameConnectAcceptedKinds, resolveFrameConnectSourceIds } from './selectionConnectRules';

function node(id: string, type: CanvasNode['type'], data: Record<string, unknown> = {}): CanvasNode {
  return { id, type, position: { x: 0, y: 0 }, data } as CanvasNode;
}

const image = (id: string) => node(id, CANVAS_NODE_TYPES.upload, { imageUrl: 'a.png' });
const video = (id: string) => node(id, CANVAS_NODE_TYPES.video, { videoUrl: 'a.mp4' });
const audio = (id: string) => node(id, CANVAS_NODE_TYPES.audio, { audioUrl: 'a.mp3' });
const director = (id: string) => node(id, CANVAS_NODE_TYPES.blueprint, {});
const generateImage = (id: string) => node(id, CANVAS_NODE_TYPES.exportImage, {});
const generateVideo = (id: string) => node(id, CANVAS_NODE_TYPES.aiVideo, {});

describe('resolveFrameConnectAcceptedKinds', () => {
  it('lets generate-image take images only', () => {
    expect(resolveFrameConnectAcceptedKinds(generateImage('img'))).toEqual(new Set(['image']));
    expect(resolveFrameConnectAcceptedKinds(node('edit', CANVAS_NODE_TYPES.imageEdit)))
      .toEqual(new Set(['image']));
  });

  it('lets generate-video take every media kind', () => {
    expect(resolveFrameConnectAcceptedKinds(generateVideo('vid')))
      .toEqual(new Set(['image', 'video', 'audio']));
  });

  it('leaves other targets unfiltered', () => {
    expect(resolveFrameConnectAcceptedKinds(node('text', CANVAS_NODE_TYPES.textAnnotation))).toBeNull();
  });
});

describe('resolveFrameConnectSourceIds', () => {
  it('connects media nodes and skips the director studio', () => {
    const nodes = [image('i1'), video('v1'), audio('a1'), director('d1'), generateVideo('target')];
    expect(resolveFrameConnectSourceIds(['i1', 'v1', 'a1', 'd1'], 'target', nodes, []))
      .toEqual(['i1', 'v1', 'a1']);
  });

  it('sends image nodes only to a generate-image target', () => {
    const nodes = [image('i1'), video('v1'), audio('a1'), generateImage('target')];
    expect(resolveFrameConnectSourceIds(['i1', 'v1', 'a1'], 'target', nodes, []))
      .toEqual(['i1']);
  });

  it('skips the target itself', () => {
    const nodes = [image('i1'), generateImage('target')];
    expect(resolveFrameConnectSourceIds(['i1', 'target'], 'target', nodes, []))
      .toEqual(['i1']);
  });
});
