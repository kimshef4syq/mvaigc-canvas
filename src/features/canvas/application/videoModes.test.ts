import { describe, expect, it } from 'vitest';

import { VIDEO_NODE_MODES, videoModeInputSchema, videoModeImageMode } from './videoModes';

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
