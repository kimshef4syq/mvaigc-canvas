/**
 * Translation from Hypit's Model ports onto the Canvas mvaigc reverse proxy.
 *
 * The proxy speaks an OpenAI-ish shape on loopback (`/v1/images/generations`,
 * `/v1/videos`, `/v1/tasks/{id}`); Hypit speaks port tables. This module owns
 * only the translation and the task lifecycle — no policy, no storage.
 */

export const providerModule = { name: 'mvaigc-provider', version: '1' } as const;

export const videoCapability = {
  module: { name: '@hypit/minimax-h3', version: '1' },
  name: 'minimax-h3',
} as const;

export interface MvaigcVideoPorts {
  prompt: string;
  durationSeconds: number;
  resolution?: string;
  aspectRatio?: string;
  referenceImages: string[];
  referenceVideos: string[];
  referenceAudioUrls: string[];
  generateAudio: boolean;
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
    audio: ports.generateAudio,
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
