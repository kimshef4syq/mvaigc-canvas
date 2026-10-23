/**
 * The Hypit-facing wiring: port tables, capability declarations, and the
 * `defineEndpoint` instance.
 *
 * This module is the only place that imports the Hypit SDK at runtime. The
 * SDK resolves its `import` condition to TypeScript source that Node refuses
 * to load from `node_modules`, so nothing here can be unit-tested outside
 * Hypit — it is covered by the end-to-end run instead. Keep pure translation
 * in `./provider.ts`, which imports nothing from the SDK.
 */
import { defineEndpoint } from '@hypit/hypit/endpoint';
import type { AsyncEndpoint, CredentialRef, EndpointInstance, EndpointRequest } from '@hypit/hypit/endpoint';
import { generationTypes, mappingSupportsRequest } from '@hypit/generation';
import type { GenerationRequest, GenerationWireMapping } from '@hypit/generation';

import { createMvaigcImageEndpoint, createMvaigcVideoEndpoint } from './lifecycle.js';
import { imageCapability, imageMapping, portsOfConstraints, videoCapability, videoMapping } from './provider.js';

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
  image: AsyncEndpoint;
} {
  const shared = {
    baseUrl: options.baseUrl,
    getSecret: () => options.apiKey.key,
    ...(options.pollIntervalMs === undefined ? {} : { pollIntervalMs: options.pollIntervalMs }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  };
  return {
    video: createMvaigcVideoEndpoint(shared),
    image: createMvaigcImageEndpoint(shared),
  };
}

function supportFor(mapping: GenerationWireMapping) {
  // `mappingSupportsRequest` reads `{ ports }`, which lives on
  // `request.constraints` — an EndpointRequest has no `ports` of its own. Its
  // parameter is typed `unknown`, so passing the wrong object compiles; it then
  // reads no ports and refuses every request. The SDK's own example passes
  // `request.constraints` (examples/provider-package/packages/provider-videos).
  return (request: EndpointRequest) => {
    const constraints = request.constraints as unknown as GenerationRequest;
    portsOfConstraints(constraints);
    return mappingSupportsRequest(mapping, constraints)
      ? { status: 'supported' as const }
      : { status: 'unsupported' as const, reason: `mvaigc cannot serve this ${mapping.capability.name} request shape` };
  };
}

/** The Endpoint instance Hypit loads, covering both capabilities on one account. */
export function createMvaigcProvider(options: MvaigcProviderOptions): EndpointInstance {
  const { video, image } = createMvaigcEndpoints(options);
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
    ],
  });
}
