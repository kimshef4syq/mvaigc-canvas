import type { VideoCatalogEntry } from './videoModelCatalog';

/**
 * The 即梦 CLI provider exposes one model as several entries, one per command
 * (`dreamina:<kind>:<model>`). The video node shows those as a mode tab row so
 * the user picks a model once and then switches 文生视频 / 图生视频 / 首尾帧 /
 * 参考生视频 without leaving the node.
 */
export type DreaminaVideoModeKind =
  | 'text-video'
  | 'image-video'
  | 'frames-video'
  | 'all-reference-video';

/** Display order for the mode tabs. */
const DREAMINA_VIDEO_MODE_ORDER: readonly DreaminaVideoModeKind[] = [
  'text-video',
  'image-video',
  'frames-video',
  'all-reference-video',
];

export interface VideoModeTab {
  kind: DreaminaVideoModeKind;
  entryId: string;
  /** True when this tab is the currently selected entry. */
  active: boolean;
}

export function parseDreaminaVideoEntryId(
  entryId: string | null | undefined
): { kind: DreaminaVideoModeKind; model: string } | null {
  if (typeof entryId !== 'string' || !entryId.startsWith('dreamina:')) {
    return null;
  }
  const rest = entryId.slice('dreamina:'.length);
  const separator = rest.indexOf(':');
  if (separator <= 0) {
    return null;
  }
  const kind = rest.slice(0, separator);
  if (!DREAMINA_VIDEO_MODE_ORDER.includes(kind as DreaminaVideoModeKind)) {
    return null;
  }
  return { kind: kind as DreaminaVideoModeKind, model: rest.slice(separator + 1) };
}

/**
 * Mode tabs for the model behind `selectedEntryId`: every command that model
 * exposes, in display order, skipping entries that are not usable. Returns an
 * empty array for any non-即梦 entry, so non-即梦 providers keep the plain
 * model list untouched.
 */
export function buildVideoModeTabs(
  catalog: readonly VideoCatalogEntry[],
  selectedEntryId: string | null | undefined
): VideoModeTab[] {
  const selected = parseDreaminaVideoEntryId(selectedEntryId);
  if (!selected) {
    return [];
  }
  const byKind = new Map<string, VideoCatalogEntry>();
  for (const entry of catalog) {
    const parsed = parseDreaminaVideoEntryId(entry.id);
    if (!parsed || parsed.model !== selected.model || !entry.usable) {
      continue;
    }
    byKind.set(parsed.kind, entry);
  }
  return DREAMINA_VIDEO_MODE_ORDER.flatMap((kind) => {
    const entry = byKind.get(kind);
    return entry
      ? [{ kind, entryId: entry.id, active: entry.id === selectedEntryId }]
      : [];
  });
}
