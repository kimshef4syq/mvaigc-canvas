import { normalizeVideoInputSchema, type VideoInputSchema } from './videoInputSchema';

/**
 * The four generation modes every video node offers, independent of the
 * selected model or provider. The mode decides how connected media is used and
 * which image mode is sent downstream; it is not a model capability.
 */
export type VideoNodeModeKind = 'text' | 'image' | 'frames' | 'reference';

export interface VideoNodeMode {
  kind: VideoNodeModeKind;
  /** i18n key under `videoModeTabs.*`. */
  labelKey: string;
}

export const VIDEO_NODE_MODES: readonly VideoNodeMode[] = [
  { kind: 'text', labelKey: 'videoModeTabs.text-video' },
  { kind: 'image', labelKey: 'videoModeTabs.image-video' },
  { kind: 'frames', labelKey: 'videoModeTabs.frames-video' },
  { kind: 'reference', labelKey: 'videoModeTabs.all-reference-video' },
];

export function isVideoNodeModeKind(value: unknown): value is VideoNodeModeKind {
  return typeof value === 'string' && VIDEO_NODE_MODES.some((mode) => mode.kind === value);
}

export function videoModeInputSchema(kind: VideoNodeModeKind): VideoInputSchema {
  if (kind === 'text') {
    return normalizeVideoInputSchema({
      images: { enabled: false, min: 0, max: 0, roles: ['reference'], requireImageHost: false },
      video: { enabled: false, min: 0, max: 0, field: '' },
      audio: { enabled: false, min: 0, max: 0, field: '' },
    });
  }
  if (kind === 'image') {
    return normalizeVideoInputSchema({
      images: { enabled: true, min: 1, max: 1, roles: ['firstFrame'], requireImageHost: false },
      video: { enabled: false, min: 0, max: 0, field: '' },
      audio: { enabled: false, min: 0, max: 0, field: '' },
    });
  }
  if (kind === 'frames') {
    return normalizeVideoInputSchema({
      images: { enabled: true, min: 2, max: 2, roles: ['firstFrame', 'lastFrame'], requireImageHost: false },
      video: { enabled: false, min: 0, max: 0, field: '' },
      audio: { enabled: false, min: 0, max: 0, field: '' },
    });
  }
  return normalizeVideoInputSchema({
    images: { enabled: true, min: 0, max: 9, roles: ['reference'], requireImageHost: false },
    video: { enabled: true, min: 0, max: 3, field: 'videos' },
    audio: { enabled: true, min: 0, max: 3, field: 'audios' },
  });
}

/** The image mode value OSC carries downstream in `extraParams.imageMode`. */
export function videoModeImageMode(kind: VideoNodeModeKind): 'text' | 'firstFrame' | 'frames' | 'reference' {
  if (kind === 'image') return 'firstFrame';
  if (kind === 'frames') return 'frames';
  if (kind === 'reference') return 'reference';
  return 'text';
}

export interface ModelSlotCapability {
  images?: number;
  videos?: number;
  audios?: number;
}

/**
 * Combine the mode's semantic skeleton (which kinds are enabled, image roles)
 * with the selected model's declared numeric limits. A declared positive limit
 * overrides the mode default; an omitted or invalid limit keeps the mode
 * default. A kind the mode disabled stays disabled.
 */
export function mergeModeWithModelCapability(
  mode: VideoInputSchema,
  capability: ModelSlotCapability,
): VideoInputSchema {
  const overrideMax = (enabled: boolean, modeMax: number, declared?: number): number =>
    enabled && typeof declared === 'number' && Number.isFinite(declared) && declared > 0
      ? Math.trunc(declared)
      : modeMax;
  return {
    ...mode,
    images: { ...mode.images, max: overrideMax(mode.images.enabled, mode.images.max, capability.images) },
    video: { ...mode.video, max: overrideMax(mode.video.enabled, mode.video.max, capability.videos) },
    audio: { ...mode.audio, max: overrideMax(mode.audio.enabled, mode.audio.max, capability.audios) },
  };
}
