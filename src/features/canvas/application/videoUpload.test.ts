import { describe, expect, it } from 'vitest';

import { buildCapturedFrameNodeData, resolveFrameCaptureTime } from './videoUpload';

describe('buildCapturedFrameNodeData', () => {
  it('builds upload-node data from a captured frame', () => {
    const data = buildCapturedFrameNodeData('/frame.jpg', '9:16');
    expect(data.imageUrl).toBe('/frame.jpg');
    expect(data.previewImageUrl).toBe('/frame.jpg');
    expect(data.aspectRatio).toBe('9:16');
  });

  it('falls back to the default aspect ratio when empty', () => {
    expect(buildCapturedFrameNodeData('/frame.jpg', '').aspectRatio).toBe('1:1');
  });
});

describe('resolveFrameCaptureTime', () => {
  it('first is 0', () => {
    expect(resolveFrameCaptureTime('first', 10, 4)).toBe(0);
  });

  it('current is the playhead', () => {
    expect(resolveFrameCaptureTime('current', 10, 4)).toBe(4);
  });

  it('last is just before the end', () => {
    expect(resolveFrameCaptureTime('last', 10, 4)).toBeCloseTo(9.95, 2);
  });

  it('last degrades to 0 when duration is unknown', () => {
    expect(resolveFrameCaptureTime('last', 0, 4)).toBe(0);
    expect(resolveFrameCaptureTime('last', Number.NaN, 4)).toBe(0);
  });
});
