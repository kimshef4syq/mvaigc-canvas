import { describe, expect, it } from 'vitest';

import { resolveFrameCaptureTime } from './videoUpload';

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
