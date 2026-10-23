/**
 * Translation from Hypit's Model ports onto the Canvas mvaigc reverse proxy.
 *
 * The proxy speaks an OpenAI-ish shape on loopback (`/v1/images/generations`,
 * `/v1/videos`, `/v1/tasks/{id}`); Hypit speaks port tables. This module owns
 * only the translation. It imports nothing from the Hypit SDK at runtime, so
 * it is unit-testable under plain Node; the SDK-facing wiring lives in
 * `./endpoint.ts` and `./lifecycle.ts`.
 */
import type { GenerationWireMapping } from '@hypit/generation';

export const providerModule = { name: 'mvaigc-provider', version: '1' } as const;

export const videoCapability = {
  module: { name: '@hypit/minimax-h3', version: '1' },
  name: 'minimax-h3',
} as const;

export const imageCapability = {
  module: { name: '@hypit/nano-banana', version: '1' },
  name: 'nano-banana-pro',
} as const;

export interface MvaigcImagePorts {
  prompt: string;
  aspectRatio?: string;
  referenceImages: string[];
  /** Accepted so the request validates, then overwritten — see below. */
  resolution?: string;
  outputFormat?: string;
}

/** mvaigc's image model id for the Nano Banana Pro tier. */
const IMAGE_MODEL = 'Nano-Banana-Pro';

/**
 * The canvas never told mvaigc which image tier to use — it sends a pixel size,
 * and the proxy resolves that to 2K itself — so 2K is the only tier this
 * endpoint can honestly claim (user ruling, spec §4).
 */
export function buildImagePayload(ports: MvaigcImagePorts): {
  model: string;
  body: Record<string, unknown>;
} {
  if (ports.outputFormat !== undefined) {
    throw new Error('mvaigc has no outputFormat field, so it cannot be honoured');
  }
  // The authored tier is discarded: mvaigc resolves the tier from the pixel
  // size the canvas sends, so 2K is the only one this endpoint can honour.
  const body: Record<string, unknown> = {
    prompt: ports.prompt,
    resolution: '2K',
    reference_images: ports.referenceImages,
  };
  if (ports.aspectRatio !== undefined) body.aspect_ratio = ports.aspectRatio;
  return { model: IMAGE_MODEL, body };
}

export interface MvaigcVideoPorts {
  prompt: string;
  durationSeconds: number;
  resolution?: string;
  aspectRatio?: string;
  referenceImages: string[];
  referenceVideos: string[];
  referenceAudioUrls: string[];
  firstFrameUrl?: string;
  lastFrameUrl?: string;
}

/**
 * mvaigc distinguishes the tier by model id, not by a resolution field: the
 * 768p tier is its own model. Hypit's `768P` and the canvas's 720p both mean
 * the 768p tier (user ruling, spec §5.4).
 */
export function mvaigcVideoModelForTier(tier: string | undefined): string {
  if (tier === undefined || tier === '768P') return 'minimax_h3_768p';
  if (tier === '2K') return 'minimax_h3';
  throw new Error(`mvaigc cannot serve resolution ${tier}; minimax-h3 offers 768P or 2K`);
}

export function buildVideoPayload(ports: MvaigcVideoPorts): {
  model: string;
  body: Record<string, unknown>;
} {
  const model = mvaigcVideoModelForTier(ports.resolution);
  // Hypit declares first/last frame as two ports; mvaigc takes one switch plus
  // one image array (first at [0], last at [1]). Hypit's own port constraints
  // keep frames and reference images mutually exclusive, so the mode is clear.
  const frames = ports.firstFrameUrl !== undefined || ports.lastFrameUrl !== undefined;
  const frameUrls = [ports.firstFrameUrl, ports.lastFrameUrl].filter(
    (url): url is string => url !== undefined,
  );
  const body: Record<string, unknown> = {
    prompt: ports.prompt,
    seconds: ports.durationSeconds,
    frames,
    reference_images: frames ? frameUrls : ports.referenceImages,
    reference_videos: ports.referenceVideos,
    reference_audios: ports.referenceAudioUrls,
    // minimax-h3 declares no generate-audio port, so this is a mapping
    // constant: mvaigc expects the field, the Model has no opinion on it.
    audio: VIDEO_MAPPING_CONSTANTS.audio,
  };
  if (ports.aspectRatio !== undefined) body.aspect_ratio = ports.aspectRatio;
  return { model, body };
}

/**
 * Refuse shapes mvaigc cannot honour, rather than sending a request that would
 * drop part of the author's intent. Hypit's rule: a service that cannot carry a
 * field must refuse it, never discard it silently.
 */
export function assertSupportedVideoPorts(ports: MvaigcVideoPorts): void {
  const frames = ports.firstFrameUrl !== undefined || ports.lastFrameUrl !== undefined;
  if (frames && ports.referenceAudioUrls.length > 0) {
    throw new Error(
      'mvaigc cannot carry reference audio together with a first/last frame; '
      + 'whether its frames mode accepts audio is unverified',
    );
  }
}

/**
 * The ports Hypit's Model tables declare, kept here as data so a missing or
 * invented port is caught by a test rather than by Hypit refusing the whole
 * mapping at load ("mapping does not cover port X" / "mapping names undeclared
 * port X"). Source: @hypit/nano-banana and @hypit/minimax-h3 port tables.
 */
export const IMAGE_PORTS = ['prompt', 'images', 'aspectRatio', 'resolution', 'outputFormat'] as const;
export const VIDEO_PORTS = [
  'prompt', 'duration', 'resolution', 'aspectRatio',
  'referenceImage', 'referenceVideo', 'referenceAudio', 'firstFrame', 'lastFrame',
] as const;

/**
 * Port → wire field. Every declared port must appear, including ones mvaigc
 * cannot honour: those are mapped so the request is accepted, then refused in
 * `buildImagePayload` / `assertSupportedVideoPorts` rather than dropped.
 */
export const imageMappingFields = {
  prompt: { as: 'value', field: 'prompt' },
  images: { as: 'urlArray', field: 'reference_images' },
  aspectRatio: { as: 'value', field: 'aspect_ratio' },
  // mvaigc takes a pixel size and resolves the tier itself, so the authored
  // tier is overwritten to 2K in buildImagePayload; the port must still exist.
  resolution: { as: 'value', field: 'resolution' },
  outputFormat: { as: 'value', field: 'output_format' },
} as const;

export const videoMappingFields = {
  prompt: { as: 'value', field: 'prompt' },
  duration: { as: 'value', field: 'seconds' },
  resolution: { as: 'value', field: 'resolution' },
  aspectRatio: { as: 'value', field: 'aspect_ratio' },
  referenceImage: { as: 'urlArray', field: 'reference_images' },
  referenceVideo: { as: 'urlArray', field: 'reference_videos' },
  referenceAudio: { as: 'urlArray', field: 'reference_audios' },
  // frames mode rewrites reference_images from these two in buildVideoPayload.
  firstFrame: { as: 'url', field: 'first_frame' },
  lastFrame: { as: 'url', field: 'last_frame' },
} as const;

/**
 * minimax-h3 declares no port for a "generate audio" switch, so it is a
 * mapping constant rather than a port: mvaigc expects the field, the Model
 * has no opinion on it. Audio comes from referenceAudio.
 */
export const VIDEO_MAPPING_CONSTANTS = { audio: false } as const;

export const imageMapping: GenerationWireMapping = {
  capability: imageCapability,
  result: 'image',
  routes: [{ model: 'Nano-Banana-Pro' }],
  fields: imageMappingFields,
};

export const videoMapping: GenerationWireMapping = {
  capability: videoCapability,
  result: 'video',
  routes: [{ model: 'minimax_h3_768p' }],
  fields: videoMappingFields,
  constants: VIDEO_MAPPING_CONSTANTS,
};
