import { describe, expect, it } from 'vitest';

import { resolveDefaultImageNodeSize } from './imageNodeSizing';

describe('resolveDefaultImageNodeSize', () => {
  // The 生成图片 node's default footprint: fit the ratio inside 384×288, then
  // never shrink below the 260×168 min-edge box. Video and audio nodes reuse
  // this so a fresh node of any kind lands on the same footprint.
  it('fits 16:9 inside the 384x288 box', () => {
    expect(resolveDefaultImageNodeSize('16:9')).toEqual({ width: 384, height: 216 });
  });

  it('fits 9:16 by growing the height to the min-edge box', () => {
    expect(resolveDefaultImageNodeSize('9:16')).toEqual({ width: 260, height: 462 });
  });

  it('renders 1:1 as a 288 square', () => {
    expect(resolveDefaultImageNodeSize('1:1')).toEqual({ width: 288, height: 288 });
  });

  it('falls back to a square for an unusable ratio', () => {
    expect(resolveDefaultImageNodeSize('auto')).toEqual({ width: 288, height: 288 });
  });
});
