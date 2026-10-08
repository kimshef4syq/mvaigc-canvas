import {
  DEFAULT_ASPECT_RATIO,
  type GeneratedVideoEntry,
} from '@/features/canvas/domain/canvasNodes';

export type { GeneratedVideoEntry };

let entrySequence = 0;

function nextEntryId(): string {
  entrySequence += 1;
  return `genv-${Date.now().toString(36)}-${entrySequence.toString(36)}`;
}

export function createGeneratedVideoEntry(input: {
  videoUrl: string | null;
  thumbnailUrl: string | null;
  aspectRatio: string;
  localVideoUrl?: string | null;
  durationSeconds?: number | null;
  generatedFileName?: string | null;
  sourcePrompt?: string | null;
  now?: number;
}): GeneratedVideoEntry {
  return {
    id: nextEntryId(),
    videoUrl: input.videoUrl,
    thumbnailUrl: input.thumbnailUrl,
    aspectRatio: input.aspectRatio,
    localVideoUrl: input.localVideoUrl ?? null,
    durationSeconds: input.durationSeconds ?? null,
    generatedFileName: input.generatedFileName ?? null,
    sourcePrompt: input.sourcePrompt ?? null,
    createdAt: input.now ?? Date.now(),
  };
}

export function appendGeneratedVideoEntry(
  entries: GeneratedVideoEntry[] | undefined,
  entry: GeneratedVideoEntry
): GeneratedVideoEntry[] {
  return [...(entries ?? []), entry];
}

/**
 * The entry the node shows on the canvas. Falls back to the last entry that
 * actually has a videoUrl whenever the index is missing or out of range, so
 * corrupt or partially-written history never renders blank.
 */
export function resolveMainVideoEntry(
  entries: GeneratedVideoEntry[] | undefined,
  mainVideoIndex: number | undefined
): GeneratedVideoEntry | null {
  if (!entries || entries.length === 0) {
    return null;
  }

  const index = typeof mainVideoIndex === 'number' ? mainVideoIndex : -1;
  if (index >= 0 && index < entries.length) {
    return entries[index];
  }

  for (let cursor = entries.length - 1; cursor >= 0; cursor -= 1) {
    if (entries[cursor].videoUrl) {
      return entries[cursor];
    }
  }

  return null;
}

/**
 * Patch a completed generation writes onto a node: append the new video to the
 * history and make it the main video. `videoUrl`/`thumbnailUrl` mirror the main
 * entry so downstream consumers keep reading the main without knowing about
 * history.
 */
export function buildCompletedVideoPatch(input: {
  currentVideos: GeneratedVideoEntry[] | undefined;
  videoUrl: string;
  thumbnailUrl: string | null;
  aspectRatio: string;
  localVideoUrl?: string | null;
  durationSeconds?: number | null;
  generatedFileName?: string | null;
  sourcePrompt?: string | null;
  now?: number;
}): { videos: GeneratedVideoEntry[]; mainVideoIndex: number; videoUrl: string; thumbnailUrl: string | null } {
  const entry = createGeneratedVideoEntry({
    videoUrl: input.videoUrl,
    thumbnailUrl: input.thumbnailUrl,
    aspectRatio: input.aspectRatio,
    localVideoUrl: input.localVideoUrl,
    durationSeconds: input.durationSeconds,
    generatedFileName: input.generatedFileName,
    sourcePrompt: input.sourcePrompt,
    now: input.now,
  });
  const videos = appendGeneratedVideoEntry(input.currentVideos, entry);
  return {
    videos,
    mainVideoIndex: videos.length - 1,
    videoUrl: entry.videoUrl ?? input.videoUrl,
    thumbnailUrl: entry.thumbnailUrl,
  };
}

/**
 * Normalize a persisted aiVideo node into the history shape. Nodes saved before
 * history existed carry a single `videoUrl`; they become a one-entry history.
 * Nodes that already have a non-empty `videos` are returned as-is. Returns null
 * when there is nothing to migrate (no history and no videoUrl).
 */
export function normalizeVideoHistory(data: {
  videoUrl?: string | null;
  thumbnailUrl?: string | null;
  localVideoUrl?: string | null;
  aspectRatio?: string;
  durationSeconds?: number | null;
  generatedFileName?: string | null;
  sourcePrompt?: string;
  videos?: GeneratedVideoEntry[];
  mainVideoIndex?: number;
}): { videos: GeneratedVideoEntry[]; mainVideoIndex: number } | null {
  if (Array.isArray(data.videos) && data.videos.length > 0) {
    return {
      videos: data.videos,
      mainVideoIndex: typeof data.mainVideoIndex === 'number' ? data.mainVideoIndex : 0,
    };
  }

  if (typeof data.videoUrl === 'string' && data.videoUrl) {
    return {
      videos: [{
        id: 'legacy-0',
        videoUrl: data.videoUrl,
        thumbnailUrl: data.thumbnailUrl ?? null,
        localVideoUrl: data.localVideoUrl ?? null,
        aspectRatio: data.aspectRatio || DEFAULT_ASPECT_RATIO,
        durationSeconds: data.durationSeconds ?? null,
        generatedFileName: data.generatedFileName ?? null,
        sourcePrompt: data.sourcePrompt ?? null,
        createdAt: 0,
      }],
      mainVideoIndex: 0,
    };
  }

  return null;
}
