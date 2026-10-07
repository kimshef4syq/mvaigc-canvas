import { describe, expect, it } from 'vitest';

import {
  appendGeneratedImageEntry,
  createGeneratedImageEntry,
  migrateLegacyExportImageData,
  resolveMainImageEntry,
  type GeneratedImageEntry,
} from './generatedImageHistory';

function entry(overrides: Partial<GeneratedImageEntry> = {}): GeneratedImageEntry {
  return {
    id: 'e1',
    imageUrl: 'a.png',
    previewImageUrl: 'a.preview.png',
    aspectRatio: '1:1',
    createdAt: 1,
    ...overrides,
  };
}

describe('createGeneratedImageEntry', () => {
  it('fills id and createdAt from now when omitted', () => {
    const created = createGeneratedImageEntry({
      imageUrl: 'x.png',
      previewImageUrl: 'x.p.png',
      aspectRatio: '3:4',
      now: 111,
    });
    expect(created.imageUrl).toBe('x.png');
    expect(created.previewImageUrl).toBe('x.p.png');
    expect(created.aspectRatio).toBe('3:4');
    expect(created.createdAt).toBe(111);
    expect(created.id).toBeTruthy();
  });
});

describe('appendGeneratedImageEntry', () => {
  it('appends preserving order', () => {
    const list = appendGeneratedImageEntry([entry({ id: 'a' })], entry({ id: 'b' }));
    expect(list.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('starts a new list when entries is undefined', () => {
    const list = appendGeneratedImageEntry(undefined, entry({ id: 'z' }));
    expect(list.map((item) => item.id)).toEqual(['z']);
  });
});

describe('resolveMainImageEntry', () => {
  it('returns the entry at the index', () => {
    const list = [entry({ id: 'a' }), entry({ id: 'b' })];
    expect(resolveMainImageEntry(list, 1)?.id).toBe('b');
  });

  it('falls back to the last entry with a non-null imageUrl when index is out of range', () => {
    const list = [
      entry({ id: 'a', imageUrl: 'a.png' }),
      entry({ id: 'b', imageUrl: 'b.png' }),
      entry({ id: 'c', imageUrl: null }),
    ];
    expect(resolveMainImageEntry(list, 99)?.id).toBe('b');
  });

  it('falls back when the index is negative', () => {
    const list = [entry({ id: 'a', imageUrl: 'a.png' })];
    expect(resolveMainImageEntry(list, -1)?.id).toBe('a');
  });

  it('returns null for empty or undefined history', () => {
    expect(resolveMainImageEntry([], 0)).toBeNull();
    expect(resolveMainImageEntry(undefined, 0)).toBeNull();
  });

  it('returns null when no entry has an imageUrl', () => {
    expect(resolveMainImageEntry([entry({ imageUrl: null })], 0)).toBeNull();
  });
});

describe('migrateLegacyExportImageData', () => {
  it('converts a legacy single-image node into a one-entry history at index 0', () => {
    const result = migrateLegacyExportImageData({
      imageUrl: 'legacy.png',
      previewImageUrl: 'legacy.p.png',
      aspectRatio: '16:9',
    });
    expect(result.images).toHaveLength(1);
    expect(result.images[0].imageUrl).toBe('legacy.png');
    expect(result.images[0].aspectRatio).toBe('16:9');
    expect(result.mainImageIndex).toBe(0);
  });

  it('leaves an existing images array untouched', () => {
    const existing = [entry({ id: 'a' }), entry({ id: 'b' })];
    const result = migrateLegacyExportImageData({ images: existing, mainImageIndex: 1 });
    expect(result.images).toBe(existing);
    expect(result.mainImageIndex).toBe(1);
  });

  it('returns empty history with index -1 when there is no image', () => {
    const result = migrateLegacyExportImageData({ imageUrl: null });
    expect(result.images).toEqual([]);
    expect(result.mainImageIndex).toBe(-1);
  });

  it('treats an empty images array as no history and migrates the legacy imageUrl', () => {
    // Merged node data always carries `images: []` from defaults, so an empty
    // array must still fall through to the legacy imageUrl branch.
    const result = migrateLegacyExportImageData({ images: [], imageUrl: 'legacy.png' });
    expect(result.images).toHaveLength(1);
    expect(result.images[0].imageUrl).toBe('legacy.png');
    expect(result.mainImageIndex).toBe(0);
  });
});
