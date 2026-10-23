/**
 * The mvaigc task lifecycle: submit, poll, collect.
 *
 * Kept apart from the port translation so each can be read (and tested) alone.
 * Everything here takes an injected `fetch`, so the whole lifecycle is
 * exercisable without a network or a Hypit runtime.
 */
import type {
  AsyncEndpoint,
  EndpointPollContext,
  EndpointStartContext,
} from '@hypit/hypit/endpoint';
import { canonicalize, wakeAfter } from '@hypit/hypit/endpoint';
import { sealGeneratedImageSet, sealGeneratedVideoSet } from '@hypit/generation';
import type { GenerationMediaValue } from '@hypit/generation';

import {
  assertSupportedVideoPorts,
  portsOfConstraints,
  secretFor,
  buildImagePayload,
  buildVideoPayload,
  type MvaigcImagePorts,
  type MvaigcVideoPorts,
} from './provider.js';

export interface MvaigcEndpointOptions {
  baseUrl: string;
  pollIntervalMs?: number;
  fetch?: typeof globalThis.fetch;
}

/**
 * Accept only an HTTPS URL or loopback HTTP for the media download.
 *
 * The URL is re-read from persisted handle state, so it is not necessarily the
 * one this process received, and it receives no credential — but a bad scheme
 * (file:, data:) would have the provider fetch something that is not the
 * service's media.
 */
function outputAddress(value: string): string {
  const url = new URL(value);
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error(`mvaigc returned a non-HTTPS media url (${url.protocol})`);
  }
  return url.href;
}

/**
 * The service base URL, restricted to HTTPS or loopback HTTP.
 *
 * Every request carries the account password in plaintext, so a mistyped or
 * hostile baseUrl would send the user's mvaigc credentials to an arbitrary
 * endpoint. Both official Providers apply the same restriction.
 */
function serviceBase(value: string): string {
  const url = new URL(value);
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error(`mvaigc baseUrl must be HTTPS or loopback HTTP, got ${url.protocol}//${url.hostname}`);
  }
  return url.href.replace(/\/+$/u, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`mvaigc returned no ${label}`);
  }
  return value;
}

/** Drop any URL from service-supplied text so a signed link never leaks. */
function withoutUrls(value: string): string {
  return value.replace(/https?:\/\/\S+/giu, '[redacted-url]');
}

// One helper, so a wrong-shape mistake fails with the same directive message
// everywhere instead of silently reading no ports (the bug that disabled every
// request).
function portsOf(context: EndpointStartContext): Record<string, unknown[]> {
  return portsOfConstraints(context.need.constraints);
}

function firstOf<T>(ports: Record<string, unknown[]>, name: string): T | undefined {
  const value = ports[name];
  return Array.isArray(value) ? (value[0] as T | undefined) : undefined;
}

/**
 * Turn one Hypit media port into the inline data URL the proxy uploads from.
 * The proxy only recognises `data:<mime>;base64,...` (mvaigc_proxy/client.rs);
 * any other shape would reach mvaigc as a bogus URL.
 */
async function inlineMedia(
  context: EndpointStartContext,
  ports: Record<string, unknown[]>,
  name: string,
): Promise<string[]> {
  const supplied = ports[name];
  if (!Array.isArray(supplied) || supplied.length === 0) return [];
  const urls: string[] = [];
  for (const value of supplied as GenerationMediaValue[]) {
    const { artifact } = value;
    const bytes = await context.resources.get(artifact.resource);
    if (bytes === undefined) throw new Error(`mvaigc reference ${name} bytes are unavailable`);
    urls.push(`data:${artifact.mediaType};base64,${Buffer.from(bytes).toString('base64')}`);
  }
  return urls;
}

async function videoPorts(
  context: EndpointStartContext,
): Promise<MvaigcVideoPorts> {
  const ports = portsOf(context);
  const firstFrame = await inlineMedia(context, ports, 'firstFrame');
  const lastFrame = await inlineMedia(context, ports, 'lastFrame');
  const resolved: MvaigcVideoPorts = {
    prompt: text(firstOf<string>(ports, 'prompt'), 'prompt'),
    durationSeconds: Number(firstOf<number>(ports, 'duration') ?? 5),
    referenceImages: await inlineMedia(context, ports, 'referenceImage'),
    referenceVideos: await inlineMedia(context, ports, 'referenceVideo'),
    referenceAudioUrls: await inlineMedia(context, ports, 'referenceAudio'),
  };
  const resolution = firstOf<string>(ports, 'resolution');
  if (resolution !== undefined) resolved.resolution = resolution;
  const aspectRatio = firstOf<string>(ports, 'aspectRatio');
  if (aspectRatio !== undefined) resolved.aspectRatio = aspectRatio;
  if (firstFrame[0] !== undefined) resolved.firstFrameUrl = firstFrame[0];
  if (lastFrame[0] !== undefined) resolved.lastFrameUrl = lastFrame[0];
  return resolved;
}

async function imagePorts(context: EndpointStartContext): Promise<MvaigcImagePorts> {
  const ports = portsOf(context);
  const resolved: MvaigcImagePorts = {
    prompt: text(firstOf<string>(ports, 'prompt'), 'prompt'),
    referenceImages: await inlineMedia(context, ports, 'images'),
  };
  const aspectRatio = firstOf<string>(ports, 'aspectRatio');
  if (aspectRatio !== undefined) resolved.aspectRatio = aspectRatio;
  const outputFormat = firstOf<string>(ports, 'outputFormat');
  if (outputFormat !== undefined) resolved.outputFormat = outputFormat;
  return resolved;
}

function createLifecycle(
  options: MvaigcEndpointOptions,
  submitPath: string,
  mediaKind: 'image' | 'video',
  build: (context: EndpointStartContext) => Promise<{ model: string; body: Record<string, unknown> }>,
  guard?: (context: EndpointStartContext) => Promise<void>,
): AsyncEndpoint {
  const base = serviceBase(options.baseUrl);
  const fetcher = options.fetch ?? globalThis.fetch;
  const interval = options.pollIntervalMs ?? 5_000;

  async function call(
    context: { credentials: Readonly<Record<string, { secret?: string }>> },
    path: string,
    init: RequestInit = {},
  ): Promise<Record<string, unknown>> {
    const response = await fetcher(`${base}${path}`, {
      ...init,
      headers: {
        ...init.headers,
        authorization: `Bearer ${secretFor(context)}`,
      },
    });
    if (!response.ok) {
      // The proxy reports failures as {"error":{"message":"…"}}, and that message
      // is the only thing separating a bad credential from a bad model id from
      // insufficient balance. Dropping it leaves the user with a bare status.
      let detail = '';
      try {
        const body: unknown = await response.json();
        if (isRecord(body) && isRecord(body.error) && typeof body.error.message === 'string') {
          detail = `: ${withoutUrls(body.error.message)}`;
        }
      } catch {
        // A non-JSON error body leaves the status as the only evidence.
      }
      throw new Error(
        `mvaigc ${init.method ?? 'GET'} ${path} returned HTTP ${response.status}${detail}`,
      );
    }
    const parsed: unknown = await response.json();
    if (!isRecord(parsed)) throw new Error(`mvaigc ${path} returned a non-object body`);
    return parsed;
  }

  return {
    async start(context) {
      await guard?.(context);
      const { model, body } = await build(context);
      const task = await call(context, submitPath, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...body, model }),
      });
      const id = text(task.id, 'task id');
      const handle = { id };
      const receipt = { id };
      // Checkpoint before returning so an interrupted Build still names the
      // remote work it began.
      await context.checkpoint?.({ handle, receipt });
      return { ...wakeAfter(handle, interval), receipt };
    },

    async poll(context) {
      const handle = context.handle as { id?: unknown };
      const id = text(handle?.id, 'task id');
      const task = await call(context, `/v1/tasks/${encodeURIComponent(id)}`);
      const status = text(task.status, 'task status');
      if (status === 'processing') {
        return wakeAfter({ id }, interval, Date.now(), { phase: 'processing' });
      }
      if (status === 'failed') {
        const error = isRecord(task.error) ? task.error : {};
        const detail = typeof error.message === 'string' ? withoutUrls(error.message) : 'no detail';
        return {
          status: 'failed',
          receipt: { id },
          failure: { code: 'MVAIGC_FAILED', message: `mvaigc task ${id} failed: ${detail}` },
        };
      }
      if (status !== 'succeeded') {
        throw new Error(`mvaigc task ${id} reported an unknown status ${status}`);
      }
      const output = Array.isArray(task.output) ? task.output : [];
      const first = output[0];
      if (!isRecord(first) || typeof first.url !== 'string' || first.url.length === 0) {
        // A contract violation, not a pending job: fail loudly.
        throw new Error(`mvaigc task ${id} succeeded without an output url`);
      }
      return { status: 'ready', handle: { id, url: first.url } };
    },

    async collect(context: EndpointPollContext) {
      const handle = context.handle as { url?: unknown };
      const url = outputAddress(text(handle?.url, 'output url'));
      // The download goes straight to the media URL, not through the proxy, so
      // the proxy's own request timeout does not bound it. Without a deadline a
      // stalled connection wedges a collect slot while poll keeps reporting progress.
      const response = await fetcher(url, { signal: AbortSignal.timeout(600_000) });
      if (!response.ok) throw new Error(`mvaigc download returned HTTP ${response.status}`);
      const mediaType = response.headers.get('content-type')?.split(';')[0]?.trim();
      if (mediaType === undefined || !mediaType.startsWith(`${mediaKind}/`)) {
        throw new Error(`mvaigc returned a non-${mediaKind} result`);
      }
      const artifact = await context.resources.put(new Uint8Array(await response.arrayBuffer()), mediaType);
      const value = mediaKind === 'video'
        ? sealGeneratedVideoSet({ videos: [artifact] })
        : sealGeneratedImageSet({ images: [artifact] });
      return { status: 'completed', result: { value: { kind: 'inline', value: canonicalize(value) } } };
    },
  };
}

export function createMvaigcVideoEndpoint(options: MvaigcEndpointOptions): AsyncEndpoint {
  return createLifecycle(options, '/v1/videos', 'video', async (context) => {
    const ports = await videoPorts(context);
    return buildVideoPayload(ports);
  }, async (context) => {
    assertSupportedVideoPorts(await videoPorts(context));
  });
}

export function createMvaigcImageEndpoint(options: MvaigcEndpointOptions): AsyncEndpoint {
  return createLifecycle(options, '/v1/images/generations', 'image', async (context) => {
    return buildImagePayload(await imagePorts(context));
  });
}

