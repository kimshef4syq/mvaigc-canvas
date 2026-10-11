import { describe, expect, it } from 'vitest';

import {
  canAddReferenceKind,
  listReferenceCandidates,
  referenceMediaKind,
} from './videoReferenceCandidates';
import { CANVAS_NODE_TYPES, type CanvasEdge, type CanvasNode } from '@/features/canvas/domain/canvasNodes';

function node(id: string, type: string, data: Record<string, unknown> = {}): CanvasNode {
  return { id, type, position: { x: 0, y: 0 }, data } as unknown as CanvasNode;
}
function edge(source: string, target: string): CanvasEdge {
  return { id: `${source}-${target}`, source, target } as unknown as CanvasEdge;
}

describe('referenceMediaKind', () => {
  it('classifies upload/image-edit/export-image as image', () => {
    expect(referenceMediaKind(node('a', CANVAS_NODE_TYPES.upload))).toBe('image');
    expect(referenceMediaKind(node('b', CANVAS_NODE_TYPES.imageEdit))).toBe('image');
    expect(referenceMediaKind(node('c', CANVAS_NODE_TYPES.exportImage))).toBe('image');
  });
  it('classifies video and audio nodes', () => {
    expect(referenceMediaKind(node('v', CANVAS_NODE_TYPES.video))).toBe('video');
    expect(referenceMediaKind(node('a', CANVAS_NODE_TYPES.audio))).toBe('audio');
  });
  it('returns null for non-media nodes', () => {
    expect(referenceMediaKind(node('t', CANVAS_NODE_TYPES.aiText))).toBeNull();
  });
});

describe('listReferenceCandidates', () => {
  const nodes = [
    node('up1', CANVAS_NODE_TYPES.upload, { sourceFileName: 'a.png' }),
    node('vid1', CANVAS_NODE_TYPES.video, { displayName: 'clip' }),
    node('aud1', CANVAS_NODE_TYPES.audio, {}),
    node('txt1', CANVAS_NODE_TYPES.aiText, {}),
    node('target', CANVAS_NODE_TYPES.aiVideo, {}),
  ];

  it('groups by kind and excludes the target and non-media nodes', () => {
    const out = listReferenceCandidates(nodes, [], 'target');
    expect(out.image.map((c) => c.nodeId)).toEqual(['up1']);
    expect(out.video.map((c) => c.nodeId)).toEqual(['vid1']);
    expect(out.audio.map((c) => c.nodeId)).toEqual(['aud1']);
  });

  it('excludes nodes already connected to the target', () => {
    const out = listReferenceCandidates(nodes, [edge('up1', 'target')], 'target');
    expect(out.image).toEqual([]);
  });

  it('uses displayName then sourceFileName as label', () => {
    const out = listReferenceCandidates(nodes, [], 'target');
    expect(out.image[0].label).toBe('a.png');
    expect(out.video[0].label).toBe('clip');
  });
});

describe('canAddReferenceKind', () => {
  it('allows when enabled and under cap', () => {
    expect(canAddReferenceKind({ enabled: true, count: 0, max: 1 })).toBe(true);
  });
  it('blocks when disabled or at cap', () => {
    expect(canAddReferenceKind({ enabled: false, count: 0, max: 1 })).toBe(false);
    expect(canAddReferenceKind({ enabled: true, count: 2, max: 2 })).toBe(false);
  });
});
