import { describe, expect, it } from 'vitest';

import { VIDEO_NODE_MODES, videoModeInputSchema, videoModeImageMode, mergeModeWithModelCapability, videoSlotLabelKeys } from './videoModes';

describe('VIDEO_NODE_MODES', () => {
  it('lists the four modes in display order', () => {
    expect(VIDEO_NODE_MODES.map((mode) => mode.kind)).toEqual([
      'text',
      'image',
      'frames',
      'reference',
    ]);
  });
});

describe('videoModeInputSchema', () => {
  it('text mode takes no media', () => {
    const schema = videoModeInputSchema('text');
    expect(schema.images.enabled).toBe(false);
    expect(schema.video.enabled).toBe(false);
    expect(schema.audio.enabled).toBe(false);
  });

  it('image mode takes exactly one first frame', () => {
    const schema = videoModeInputSchema('image');
    expect(schema.images).toMatchObject({ enabled: true, min: 1, max: 1, roles: ['firstFrame'] });
  });

  it('frames mode takes a first and a last frame', () => {
    const schema = videoModeInputSchema('frames');
    expect(schema.images).toMatchObject({
      enabled: true,
      min: 2,
      max: 2,
      roles: ['firstFrame', 'lastFrame'],
    });
  });

  it('reference mode takes images, video and audio', () => {
    const schema = videoModeInputSchema('reference');
    expect(schema.images).toMatchObject({ enabled: true, min: 0, max: 9 });
    expect(schema.video).toMatchObject({ enabled: true, min: 0, max: 3 });
    expect(schema.audio).toMatchObject({ enabled: true, min: 0, max: 3 });
  });
});

describe('videoModeImageMode', () => {
  it('maps each mode to the imageMode OSC sends downstream', () => {
    expect(videoModeImageMode('text')).toBe('text');
    expect(videoModeImageMode('image')).toBe('firstFrame');
    expect(videoModeImageMode('frames')).toBe('frames');
    expect(videoModeImageMode('reference')).toBe('reference');
  });
});

describe('mergeModeWithModelCapability', () => {
  it('model count overrides mode default when declared', () => {
    const reference = videoModeInputSchema('reference'); // 默认 images.max=9
    const merged = mergeModeWithModelCapability(reference, { images: 30, videos: 3, audios: 3 });
    expect(merged.images.max).toBe(30);
    expect(merged.video.max).toBe(3);
    expect(merged.audio.max).toBe(3);
  });
  it('falls back to mode default when capability omits a kind', () => {
    const reference = videoModeInputSchema('reference');
    const merged = mergeModeWithModelCapability(reference, { images: 30 });
    expect(merged.images.max).toBe(30);
    expect(merged.video.max).toBe(reference.video.max);
  });
  it('does not enable a kind the mode disabled', () => {
    const text = videoModeInputSchema('text');
    const merged = mergeModeWithModelCapability(text, { images: 30 });
    expect(merged.images.enabled).toBe(false);
    expect(merged.images.max).toBe(0);
  });
});

describe('videoSlotLabelKeys', () => {
  it('frames mode → first+last frame', () => {
    expect(videoSlotLabelKeys(videoModeInputSchema('frames'))).toEqual(['slotFirstFrame', 'slotLastFrame']);
  });
  it('image mode → first frame only', () => {
    expect(videoSlotLabelKeys(videoModeInputSchema('image'))).toEqual(['slotFirstFrame']);
  });
  it('reference mode → image/video/audio groups', () => {
    expect(videoSlotLabelKeys(videoModeInputSchema('reference'))).toEqual([
      'slotReferenceImage', 'slotReferenceVideo', 'slotReferenceAudio',
    ]);
  });
  it('text mode → empty', () => {
    expect(videoSlotLabelKeys(videoModeInputSchema('text'))).toEqual([]);
  });
});

describe('mergeModeWithModelCapability — 图槽只对参考模式生效 (I1 回归)', () => {
  it('image mode keeps 1 slot even when model declares 30', () => {
    const merged = mergeModeWithModelCapability(videoModeInputSchema('image'), { images: 30 });
    expect(merged.images.max).toBe(1);
  });
  it('frames mode keeps 2 slots even when model declares 30', () => {
    const merged = mergeModeWithModelCapability(videoModeInputSchema('frames'), { images: 30 });
    expect(merged.images.max).toBe(2);
  });
  it('reference mode still takes the model number', () => {
    const merged = mergeModeWithModelCapability(videoModeInputSchema('reference'), { images: 30 });
    expect(merged.images.max).toBe(30);
  });
});
