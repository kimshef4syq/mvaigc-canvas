import { lstatSync, readFileSync } from 'node:fs';
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
  /** Only 2K is supported by this adapter. */
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
  // Output format is provider-determined; callers must inspect the returned MIME.
  // Fixed 2K is a declared restriction, never silently substitute an explicit tier.
  if (ports.resolution !== undefined && ports.resolution !== '2K') {
    throw new Error(`mvaigc images support 2K only, not ${ports.resolution}`);
  }
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
  // Unreachable through Hypit: minimax-h3's own port table forbids the
  // combination (atMostOneOf referenceAudio/firstFrame and /lastFrame), so the
  // platform rejects it before a Provider sees the request. Kept as defence in
  // depth for a direct caller, and because mvaigc's frames-audio behaviour is
  // unverified — but it is not a limitation a Hypit user can reach.
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

/**
 * Read the authored ports off an EndpointRequest's `constraints`.
 *
 * `mappingSupportsRequest` expects `{ ports }`, and an EndpointRequest keeps
 * them under `constraints`. The SDK types that parameter as `unknown`, so
 * handing it the request object itself compiles and then silently reads no
 * ports and refuses every request. Failing loudly here turns that class of
 * mistake into an obvious error instead of a capability that never works.
 */
export function portsOfConstraints(constraints: unknown): Record<string, unknown[]> {
  const ports = (constraints as { ports?: unknown } | undefined)?.ports;
  if (ports === null || typeof ports !== 'object' || Array.isArray(ports)) {
    throw new Error('mvaigc supports() received no ports; pass request.constraints, not request');
  }
  return ports as Record<string, unknown[]>;
}

/**
 * Read the account secret for one invocation.
 *
 * The secret is revealed per request on `context.credentials`, never at
 * activation time: a `CredentialRef` carries only `{ store, key }`, where `key`
 * is the store's lookup name. Capturing `.key` at activation and sending it as
 * the bearer token produced `Bearer mvaigc.local`, which the proxy rejects
 * because it wants `<account>:<password>`.
 */
export function secretFor(
  context: { credentials?: Readonly<Record<string, { secret?: string }>> },
): string {
  let secret = context.credentials?.apiKey?.secret;
  // A stable path lets an already-running Hypit worker pick up a renewed
  // canvas grant. Environment-only token rotation would leave it stale.
  if (typeof secret === 'string' && secret.startsWith('osc-grant-file:')) {
    const path = secret.slice('osc-grant-file:'.length);
    try {
      const info = lstatSync(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 128 || (process.platform !== 'win32' && (info.mode & 0o077) !== 0)) {
        throw new Error('invalid grant file');
      }
      secret = readFileSync(path, 'utf8').trim();
      if (!/^osc-local\.[0-9a-f-]{36}$/.test(secret)) throw new Error('invalid grant');
    } catch { throw new Error('Canvas local grant is unavailable; reopen the agent from the original canvas.'); }
  }
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Error(
      'mvaigc account:password is not available for this request; run hypit auth login mvaigc.local',
    );
  }
  // The proxy splits on ':' and, finding none, silently falls back to the
  // Canvas's own stored credentials — billing the wrong account rather than
  // saying what to type. Require the shape here.
  if (/^osc-local\.[0-9a-f-]{36}$/.test(secret)) return secret;
  const separator = secret.indexOf(':');
  if (separator <= 0 || separator === secret.length - 1) {
    throw new Error(
      'mvaigc credential must be <account>:<password>; run hypit auth login mvaigc.local',
    );
  }
  return secret;
}
