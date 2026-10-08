import { describe, expect, it } from 'vitest';

import { CANVAS_NODE_TYPES, type GeneratedVideoEntry } from '@/features/canvas/domain/canvasNodes';

import {
  appendGeneratedVideoEntry,
  buildCompletedVideoPatch,
  buildVideoResultPatch,
  createGeneratedVideoEntry,
  normalizeVideoHistory,
  resolveMainVideoEntry,
} from './generatedVideoHistory';

describe('generatedVideoHistory', () => {
  it('createGeneratedVideoEntry assigns id and createdAt', () => {
    const e = createGeneratedVideoEntry({ videoUrl: '/a.mp4', thumbnailUrl: '/a.jpg', aspectRatio: '16:9', now: 1000 });
    expect(e.id).toBeTruthy();
    expect(e.createdAt).toBe(1000);
    expect(e.videoUrl).toBe('/a.mp4');
  });

  it('appendGeneratedVideoEntry appends without mutating', () => {
    const a = createGeneratedVideoEntry({ videoUrl: '/a.mp4', thumbnailUrl: null, aspectRatio: '16:9', now: 1 });
    const b = createGeneratedVideoEntry({ videoUrl: '/b.mp4', thumbnailUrl: null, aspectRatio: '16:9', now: 2 });
    const out = appendGeneratedVideoEntry([a], b);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(a);
    expect(out[1]).toBe(b);
  });

  it('buildCompletedVideoPatch appends and points main at the new entry', () => {
    const patch = buildCompletedVideoPatch({
      currentVideos: undefined,
      videoUrl: '/new.mp4',
      thumbnailUrl: '/new.jpg',
      aspectRatio: '16:9',
      now: 5,
    });
    expect(patch.videos).toHaveLength(1);
    expect(patch.mainVideoIndex).toBe(0);
    expect(patch.videoUrl).toBe('/new.mp4');
    expect(patch.thumbnailUrl).toBe('/new.jpg');
  });

  it('normalizeVideoHistory migrates a legacy single-videoUrl node', () => {
    const out = normalizeVideoHistory({ videoUrl: '/old.mp4', thumbnailUrl: '/old.jpg', aspectRatio: '9:16' });
    expect(out?.videos).toHaveLength(1);
    expect(out?.mainVideoIndex).toBe(0);
    expect(out?.videos[0].videoUrl).toBe('/old.mp4');
  });

  it('normalizeVideoHistory returns null when there is nothing to migrate', () => {
    expect(normalizeVideoHistory({})).toBeNull();
    expect(normalizeVideoHistory({ videoUrl: null })).toBeNull();
  });

  it('resolveMainVideoEntry follows the index and falls back safely', () => {
    const a = createGeneratedVideoEntry({ videoUrl: '/a.mp4', thumbnailUrl: null, aspectRatio: '16:9', now: 1 });
    const b = createGeneratedVideoEntry({ videoUrl: '/b.mp4', thumbnailUrl: null, aspectRatio: '16:9', now: 2 });
    expect(resolveMainVideoEntry([a, b], 1)).toBe(b);
    // Out of range falls back to the last entry with a videoUrl (mirrors the
    // image-history resolver), so a stale index never renders blank.
    expect(resolveMainVideoEntry([a, b], 99)).toBe(b);
    expect(resolveMainVideoEntry(undefined, 0)).toBeNull();
  });
});

describe('buildVideoResultPatch', () => {
  it('writes history for aiVideo nodes', () => {
    const patch = buildVideoResultPatch(CANVAS_NODE_TYPES.aiVideo, { videos: undefined }, {
      videoUrl: '/a.mp4', thumbnailUrl: '/a.jpg', aspectRatio: '16:9', now: 1,
    });
    expect(patch.videos).toHaveLength(1);
    expect(patch.mainVideoIndex).toBe(0);
  });

  it('keeps single fields for legacy video nodes', () => {
    const patch = buildVideoResultPatch(CANVAS_NODE_TYPES.video, {}, {
      videoUrl: '/a.mp4', thumbnailUrl: '/a.jpg', aspectRatio: '16:9', now: 1,
    });
    expect(patch.videos).toBeUndefined();
    expect(patch.videoUrl).toBe('/a.mp4');
    expect(patch.thumbnailUrl).toBe('/a.jpg');
  });

  it('two sequential completions land as two entries in order', () => {
    const first = buildVideoResultPatch(CANVAS_NODE_TYPES.aiVideo, {}, { videoUrl: '/1.mp4', thumbnailUrl: null, aspectRatio: '16:9', now: 1 });
    const second = buildVideoResultPatch(CANVAS_NODE_TYPES.aiVideo, { videos: first.videos }, { videoUrl: '/2.mp4', thumbnailUrl: null, aspectRatio: '16:9', now: 2 });
    const videos = second.videos as GeneratedVideoEntry[];
    expect(videos.map((v) => v.videoUrl)).toEqual(['/1.mp4', '/2.mp4']);
    expect(second.mainVideoIndex).toBe(1);
  });
});
