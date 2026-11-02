import { describe, expect, it } from 'vitest';

import { arrangeDropGrid } from './canvasDropArrangement';

describe('arrangeDropGrid', () => {
  it('returns nothing for an empty drop', () => {
    expect(arrangeDropGrid([])).toEqual([]);
  });

  it('places a single node at the origin', () => {
    expect(arrangeDropGrid([{ width: 200, height: 100 }])).toEqual([{ x: 0, y: 0 }]);
  });

  it('wraps into a square-ish grid without overlapping', () => {
    const size = { width: 100, height: 80 };
    const points = arrangeDropGrid([size, size, size, size, size], 20);
    expect(points).toEqual([
      { x: 0, y: 0 },
      { x: 120, y: 0 },
      { x: 240, y: 0 },
      { x: 0, y: 100 },
      { x: 120, y: 100 },
    ]);
  });

  it('uses the widest column and tallest row for mixed sizes', () => {
    const points = arrangeDropGrid([
      { width: 300, height: 100 },
      { width: 100, height: 220 },
      { width: 120, height: 90 },
      { width: 120, height: 90 },
    ], 30);
    expect(points).toEqual([
      { x: 0, y: 0 },
      { x: 330, y: 0 },
      { x: 0, y: 250 },
      { x: 330, y: 250 },
    ]);
  });
});
