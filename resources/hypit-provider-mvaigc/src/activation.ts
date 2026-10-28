/**
 * Runtime activation: turn the Profile's Endpoint config into a live provider.
 *
 * Loads the Hypit runtime SDK; tests use the same distribution bootstrap as
 * the CLI, rather than skipping SDK integration coverage.
 */
import type { RuntimeAdapterFactoryContext } from '@hypit/runtime-local/extension';
import {
  createRuntimeEndpointAdapterFacet,
  runtimeConfigCredentialRef,
  runtimeConfigExact,
  runtimeConfigObject,
  runtimeConfigPositiveInteger,
  runtimeConfigString,
} from '@hypit/runtime-local/extension';

import { createMvaigcProvider } from './endpoint.js';
import { providerModule } from './provider.js';

export default {
  format: 'hypit.package@1' as const,
  facets: [createRuntimeEndpointAdapterFacet({
    use: providerModule.name,
    activate(context: RuntimeAdapterFactoryContext) {
      const config = runtimeConfigObject(context.config, 'mvaigc');
      runtimeConfigExact(config, ['baseUrl', 'apiKey', 'pollIntervalMs'], 'mvaigc');
      const baseUrl = runtimeConfigString(config.baseUrl, 'mvaigc baseUrl');
      const apiKey = runtimeConfigCredentialRef(config.apiKey, 'mvaigc apiKey');
      if (!baseUrl || !apiKey || !context.pool) {
        throw new Error('mvaigc requires baseUrl, apiKey and pool');
      }
      return {
        endpoint: createMvaigcProvider({
          instance: context.instance,
          pool: context.pool,
          baseUrl,
          apiKey,
          pollIntervalMs: runtimeConfigPositiveInteger(config.pollIntervalMs, 'pollIntervalMs') ?? 5_000,
        }),
      };
    },
  })],
};
