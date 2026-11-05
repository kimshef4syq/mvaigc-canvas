/**
 * The Hypit-facing wiring: port tables, capability declarations, and the
 * `defineEndpoint` instance.
 *
 * Integration tests load the real SDK using test/setup.mjs (tsx plus the
 * distribution resolver), matching Hypit's CLI bootstrap.
 */
import { defineEndpoint } from '@hypit/hypit/endpoint';
import type { AsyncEndpoint, CredentialRef, EndpointInstance, EndpointRequest } from '@hypit/hypit/endpoint';
import { generationTypes, mappingSupportsRequest } from '@hypit/generation';
import type { GenerationRequest, GenerationWireMapping } from '@hypit/generation';

import { createMvaigcImageEndpoint, createMvaigcSeedanceEndpoint, createMvaigcVideoEndpoint } from './lifecycle.js';
import {
  imageCapability, imageMapping, portsOfConstraints, seedanceVideoCapability, seedanceVideoMapping,
  videoCapability, videoMapping,
} from './provider.js';

export interface MvaigcProviderOptions {
  instance: string;
  pool: string;
  baseUrl: string;
  apiKey: CredentialRef;
  pollIntervalMs?: number;
  fetch?: typeof globalThis.fetch;
}

/**
 * The two endpoints on their own, so tests can drive the handlers directly —
 * `defineEndpoint` returns an instance whose `offers` carry only the endpoint
 * *id*, not the handler object.
 */
export function createMvaigcEndpoints(options: MvaigcProviderOptions): {
  video: AsyncEndpoint;
  seedance: AsyncEndpoint;
  image: AsyncEndpoint;
} {
  const shared = {
    baseUrl: options.baseUrl,
    ...(options.pollIntervalMs === undefined ? {} : { pollIntervalMs: options.pollIntervalMs }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  };
  return {
    video: createMvaigcVideoEndpoint(shared),
    seedance: createMvaigcSeedanceEndpoint(shared),
    image: createMvaigcImageEndpoint(shared),
  };
}

function supportFor(mapping: GenerationWireMapping) {
  // `mappingSupportsRequest` reads `{ ports }`, which lives on
  // `request.constraints` — an EndpointRequest has no `ports` of its own. Its
  // parameter is typed `unknown`, so passing the wrong object compiles; it then
  // reads no ports and refuses every request. The SDK's own example passes
  // `request.constraints` (examples/provider-package/packages/provider-videos).
  //
  // Everything `start` can refuse must be refused here too, or `plan` reports
  // "supported" and the refusal only surfaces after a paid job is submitted.
  return (request: EndpointRequest) => {
    const constraints = request.constraints as unknown as GenerationRequest;
    portsOfConstraints(constraints);
    if (!mappingSupportsRequest(mapping, constraints)) {
      return { status: 'unsupported' as const, reason: `mvaigc cannot serve this ${mapping.capability.name} request shape` };
    }
    const ports = portsOfConstraints(constraints);
    const tiers = ports.resolution;
    if (mapping === imageMapping && tiers !== undefined && String(tiers[0]) !== '2K') {
      return { status: 'unsupported' as const, reason: `mvaigc images support 2K only, not ${String(tiers[0])}` };
    }
    if (mapping === videoMapping && tiers !== undefined) {
      const tier = String(tiers[0]);
      if (tier !== '768P' && tier !== '2K') {
        return { status: 'unsupported' as const, reason: `mvaigc renders 768P or 2K, not ${tier}` };
      }
    }
    if (mapping === seedanceVideoMapping) {
      if (tiers !== undefined) {
        const tier = String(tiers[0]).toLowerCase();
        if (tier !== '480p' && tier !== '720p' && tier !== '1080p') {
          return { status: 'unsupported' as const, reason: `mvaigc Seedance-2.5 renders 480P, 720P or 1080P, not ${String(tiers[0])}` };
        }
      }
      // mvaigc's video submit has no web-search field; sending `true` would be
      // dropped upstream, so it is refused at plan time instead.
      if (ports.webSearch !== undefined && Boolean(ports.webSearch[0])) {
        return { status: 'unsupported' as const, reason: 'mvaigc cannot carry Seedance web search' };
      }
    }
    return { status: 'supported' as const };
  };
}

/** The Endpoint instance Hypit loads, covering every capability on one account. */
export function createMvaigcProvider(options: MvaigcProviderOptions): EndpointInstance {
  const { video, seedance, image } = createMvaigcEndpoints(options);
  return defineEndpoint({
    instance: options.instance,
    pool: options.pool,
    credentials: { apiKey: options.apiKey },
    credentialInputs: { apiKey: { label: 'mvaigc account:password' } },
    defaultConcurrency: 1,
    actionLimits: {
      submit: { concurrency: 1 },
      poll: { concurrency: 4 },
      collect: { concurrency: 2 },
    },
    capabilities: [
      { capability: imageCapability, returns: generationTypes.imageSet,
        lifecycle: 'asynchronous', supports: supportFor(imageMapping), endpoint: image },
      { capability: videoCapability, returns: generationTypes.videoSet,
        lifecycle: 'asynchronous', supports: supportFor(videoMapping), endpoint: video },
      { capability: seedanceVideoCapability, returns: generationTypes.videoSet,
        lifecycle: 'asynchronous', supports: supportFor(seedanceVideoMapping), endpoint: seedance },
    ],
  });
}
