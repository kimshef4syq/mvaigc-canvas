export interface DropGridItemSize {
  width: number;
  height: number;
}

export interface DropGridPoint {
  x: number;
  y: number;
}

export const DROP_GRID_GAP = 24;

/**
 * Lays dropped media nodes out in a tidy grid. Column width is the widest
 * node in that column and row height the tallest node in that row, so mixed
 * image/video/audio sizes still line up without overlapping.
 */
export function arrangeDropGrid(
  sizes: readonly DropGridItemSize[],
  gap = DROP_GRID_GAP,
  columns?: number,
): DropGridPoint[] {
  if (sizes.length === 0) {
    return [];
  }
  const columnCount = Math.max(
    1,
    Math.min(sizes.length, columns ?? Math.ceil(Math.sqrt(sizes.length))),
  );
  const rowCount = Math.ceil(sizes.length / columnCount);
  const columnWidths = new Array<number>(columnCount).fill(0);
  const rowHeights = new Array<number>(rowCount).fill(0);

  sizes.forEach((size, index) => {
    const column = index % columnCount;
    const row = Math.floor(index / columnCount);
    columnWidths[column] = Math.max(columnWidths[column], size.width);
    rowHeights[row] = Math.max(rowHeights[row], size.height);
  });

  const columnOffsets: number[] = [];
  let offsetX = 0;
  for (let column = 0; column < columnCount; column += 1) {
    columnOffsets[column] = offsetX;
    offsetX += columnWidths[column] + gap;
  }

  const rowOffsets: number[] = [];
  let offsetY = 0;
  for (let row = 0; row < rowCount; row += 1) {
    rowOffsets[row] = offsetY;
    offsetY += rowHeights[row] + gap;
  }

  return sizes.map((_, index) => ({
    x: columnOffsets[index % columnCount],
    y: rowOffsets[Math.floor(index / columnCount)],
  }));
}
