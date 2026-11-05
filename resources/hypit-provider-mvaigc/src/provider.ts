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

/**
 * The second video model the canvas serves through the same account. It is a
 * separate Hypit capability, not a config knob: Hypit plans and reports the
 * exact model, so the adapter must declare the model it can actually carry
 * (mvaigc has no WAN video id whose Hypit module exists, so WAN is not offered).
 */
export const seedanceVideoCapability = {
  module: { name: '@hypit/seedance', version: '1' },
  name: 'seedance-2.5',
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

/** Ports only the Seedance surface declares. */
export interface MvaigcSeedancePorts extends MvaigcVideoPorts {
  generateAudio: boolean;
  webSearch: boolean;
  /** Any reference/frame item authored as a Seedance person reference. */
  usesPersonReference: boolean;
}

/**
 * mvaigc serves both MiniMax H3 tiers from one model id; the tier travels in
 * `resolution`, not in the model id.
 *
 * The per-tier ids this adapter used to send (`minimax_h3_768p`) are gone from
 * mvaigc's live catalogue — `videoPlatform/getVideoApi` lists `minimax_h3`
 * alone — and submitting one still lands on upstream billing:
 * `1147 找不到此API计费单元信息`. Upstream matches the billing unit by
 * `api`/`apiName`, which the proxy copies from `model`.
 *
 * The canvas's own successful H3 jobs send `model=minimax_h3` with
 * `resolution=768P`; this adapter now reproduces that shape exactly.
 */
export const VIDEO_MODEL = 'minimax_h3';

/** mvaigc's id for Seedance 2.5 — one id, tiers carried by `resolution`. */
export const SEEDANCE_VIDEO_MODEL = 'maas_seedance_2_5';

/** Hypit's H3 tier spelling → the tier string mvaigc accepts. */
export function mvaigcVideoTier(tier: string | undefined): '768P' | '2K' {
  if (tier === undefined || tier === '768P') return '768P';
  if (tier === '2K') return '2K';
  throw new Error(`mvaigc cannot serve resolution ${tier}; minimax-h3 offers 768P or 2K`);
}

/**
 * Hypit spells Seedance tiers lowercase (`480p` / `720p` / `1080p`) while
 * mvaigc's catalogue spells them `480P` / `720P` / `1080P`; the canvas sends
 * the uppercase form, so normalize rather than forward the author's casing.
 * `4k` is a Seedance surface value mvaigc does not sell on this model.
 */
export function mvaigcSeedanceTier(tier: string | undefined): '480P' | '720P' | '1080P' {
  const raw = tier === undefined ? '720p' : tier.trim();
  const match = /^(\d+)[kKpP]$/.exec(raw);
  const normalized = match === null ? undefined : `${match[1]}${raw.slice(-1).toUpperCase()}`;
  if (normalized === '480P' || normalized === '720P' || normalized === '1080P') return normalized;
  throw new Error(`mvaigc cannot serve resolution ${tier}; Seedance-2.5 offers 480P, 720P or 1080P`);
}

interface VideoWireSpec {
  model: string;
  resolution: string;
  audio: boolean;
}

/**
 * Shared wire composer. Hypit declares first/last frame as two ports; mvaigc
 * takes one switch plus one image array (first at [0], last at [1]). Hypit's
 * own port constraints keep frames and reference images mutually exclusive, so
 * the mode is clear.
 */
function composeVideoBody(
  ports: MvaigcVideoPorts,
  spec: VideoWireSpec,
): { model: string; body: Record<string, unknown> } {
  const frames = ports.firstFrameUrl !== undefined || ports.lastFrameUrl !== undefined;
  const frameUrls = [ports.firstFrameUrl, ports.lastFrameUrl].filter(
    (url): url is string => url !== undefined,
  );
  const body: Record<string, unknown> = {
    prompt: ports.prompt,
    seconds: ports.durationSeconds,
    // The tier must be sent explicitly: the proxy defaults a missing
    // `resolution` to 720p, so dropping it would submit a different (and
    // differently billed) job than the author asked for.
    resolution: spec.resolution,
    frames,
    reference_images: frames ? frameUrls : ports.referenceImages,
    reference_videos: ports.referenceVideos,
    reference_audios: ports.referenceAudioUrls,
    audio: spec.audio,
  };
  if (ports.aspectRatio !== undefined) body.aspect_ratio = ports.aspectRatio;
  return { model: spec.model, body };
}

export function buildVideoPayload(ports: MvaigcVideoPorts): {
  model: string;
  body: Record<string, unknown>;
} {
  // minimax-h3 declares no generate-audio port, so this is a mapping
  // constant: mvaigc expects the field, the Model has no opinion on it.
  return composeVideoBody(ports, {
    model: VIDEO_MODEL,
    resolution: mvaigcVideoTier(ports.resolution),
    audio: VIDEO_MAPPING_CONSTANTS.audio,
  });
}

export function buildSeedanceVideoPayload(ports: MvaigcSeedancePorts): {
  model: string;
  body: Record<string, unknown>;
} {
  if (ports.webSearch) {
    throw new Error('mvaigc cannot carry Seedance web search; disable it instead of dropping it silently');
  }
  if (ports.usesPersonReference) {
    throw new Error('mvaigc has no Seedance person-reference switch; clear it instead of dropping it silently');
  }
  return composeVideoBody(ports, {
    model: SEEDANCE_VIDEO_MODEL,
    resolution: mvaigcSeedanceTier(ports.resolution),
    // Seedance declares generate-audio as a port; H3 does not.
    audio: ports.generateAudio,
  });
}

/**
 * Refuse shapes mvaigc cannot honour, rather than sending a request that would
 * drop part of the author's intent. Hypit's rule: a service that cannot carry a
 * field must refuse it, never discard it silently.
 */
export function assertSupportedVideoPorts(ports: MvaigcVideoPorts): void {
  // Unreachable through Hypit: the model's own port table forbids the
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
/** Seedance's table adds the two switches H3 does not declare. */
export const SEEDANCE_VIDEO_PORTS = [...VIDEO_PORTS, 'generateAudio', 'webSearch'] as const;

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

export const seedanceVideoMappingFields = {
  ...videoMappingFields,
  referenceImage: { as: 'urlArray', field: 'reference_images', resourceFields: ['personReference'] },
  referenceVideo: { as: 'urlArray', field: 'reference_videos', resourceFields: ['personReference'] },
  firstFrame: { as: 'url', field: 'first_frame', resourceFields: ['personReference'] },
  lastFrame: { as: 'url', field: 'last_frame', resourceFields: ['personReference'] },
  generateAudio: { as: 'value', field: 'audio' },
  // Declared so the mapping covers Seedance's table; mvaigc has no web-search
  // field, so `buildSeedanceVideoPayload` refuses `true` instead of sending it.
  webSearch: { as: 'value', field: 'web_search' },
  // Seedance's media ports carry a required `personReference` item field
  // (declared here the same way @hypit/provider-hypihub declares it). mvaigc
  // has no equivalent switch, so `true` is refused in the builder.
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
  routes: [{ model: VIDEO_MODEL }],
  fields: videoMappingFields,
  constants: VIDEO_MAPPING_CONSTANTS,
};

export const seedanceVideoMapping: GenerationWireMapping = {
  capability: seedanceVideoCapability,
  result: 'video',
  routes: [{ model: SEEDANCE_VIDEO_MODEL }],
  fields: seedanceVideoMappingFields,
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
