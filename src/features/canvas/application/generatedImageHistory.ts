import {
  DEFAULT_ASPECT_RATIO,
  type GeneratedImageEntry,
} from '@/features/canvas/domain/canvasNodes';

export type { GeneratedImageEntry };

let entrySequence = 0;

function nextEntryId(): string {
  entrySequence += 1;
  return `gen-${Date.now().toString(36)}-${entrySequence.toString(36)}`;
}

export function createGeneratedImageEntry(input: {
  imageUrl: string | null;
  previewImageUrl: string | null;
  aspectRatio: string;
  generatedFileName?: string | null;
  sourcePrompt?: string | null;
  now?: number;
}): GeneratedImageEntry {
  return {
    id: nextEntryId(),
    imageUrl: input.imageUrl,
    previewImageUrl: input.previewImageUrl,
    aspectRatio: input.aspectRatio,
    generatedFileName: input.generatedFileName ?? null,
    sourcePrompt: input.sourcePrompt ?? null,
    createdAt: input.now ?? Date.now(),
  };
}

export function appendGeneratedImageEntry(
  entries: GeneratedImageEntry[] | undefined,
  entry: GeneratedImageEntry
): GeneratedImageEntry[] {
  return [...(entries ?? []), entry];
}

/**
 * The entry the node shows on the canvas. Falls back to the last entry that
 * actually has an imageUrl whenever the index is missing or out of range, so
 * corrupt or partially-written history never renders blank.
 */
export function resolveMainImageEntry(
  entries: GeneratedImageEntry[] | undefined,
  mainImageIndex: number | undefined
): GeneratedImageEntry | null {
  if (!entries || entries.length === 0) {
    return null;
  }

  const index = typeof mainImageIndex === 'number' ? mainImageIndex : -1;
  if (index >= 0 && index < entries.length && entries[index].imageUrl) {
    return entries[index];
  }

  for (let cursor = entries.length - 1; cursor >= 0; cursor -= 1) {
    if (entries[cursor].imageUrl) {
      return entries[cursor];
    }
  }

  return null;
}

/**
 * Normalize a persisted export-image node into the history shape. Nodes saved
 * before history existed carry a single `imageUrl`; they become a one-entry
 * history. Nodes that already have `images` are returned as-is.
 */
export function migrateLegacyExportImageData(data: {
  imageUrl?: string | null;
  previewImageUrl?: string | null;
  aspectRatio?: string;
  generatedFileName?: string | null;
  sourcePrompt?: string;
  images?: GeneratedImageEntry[];
  mainImageIndex?: number;
}): { images: GeneratedImageEntry[]; mainImageIndex: number } {
  if (Array.isArray(data.images)) {
    return {
      images: data.images,
      mainImageIndex: typeof data.mainImageIndex === 'number'
        ? data.mainImageIndex
        : (data.images.length > 0 ? 0 : -1),
    };
  }

  if (typeof data.imageUrl === 'string' && data.imageUrl) {
    return {
      images: [{
        id: 'legacy-0',
        imageUrl: data.imageUrl,
        previewImageUrl: data.previewImageUrl ?? data.imageUrl,
        aspectRatio: data.aspectRatio || DEFAULT_ASPECT_RATIO,
        generatedFileName: data.generatedFileName ?? null,
        sourcePrompt: data.sourcePrompt ?? null,
        createdAt: 0,
      }],
      mainImageIndex: 0,
    };
  }

  return { images: [], mainImageIndex: -1 };
}
