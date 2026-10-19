import { describe, expect, it } from 'vitest';

import { AGNES_PROVIDER_DEFAULTS } from '@/stores/customProvidersStore';
import { buildChatModelCatalog, isNonChatModel, resolveAgentProtocol } from './chatModelCatalog';

describe('Agnes chat catalog', () => {
  it('places Agnes 2.5 first and retains saved-project compatibility ids', () => {
    const entries = buildChatModelCatalog([], 'agnes-key');
    expect(entries.map((entry) => entry.modelId)).toEqual([
      AGNES_PROVIDER_DEFAULTS.models.chat25Flash,
      AGNES_PROVIDER_DEFAULTS.models.chat20Flash,
      AGNES_PROVIDER_DEFAULTS.models.chat15Flash,
    ]);
  });

  it('does not expose Agnes models without a saved key', () => {
    expect(buildChatModelCatalog([], '   ')).toEqual([]);
  });

  it('excludes embedding and reranker models from the text catalog', () => {
    const provider = {
      id: 'deepseek41',
      label: 'deepseek41',
      mediaType: 'chat' as const,
      baseUrl: 'https://gateway.example',
      endpointPath: '/v1/chat/completions',
      apiKey: 'secret',
      apiStyle: 'openai-compatible',
      models: ['deepseek-v4-pro-ga-260813', 'bge-m3', 'bge-reranker-v2-m3'],
      supportsWebSearch: false,
    };
    const entries = buildChatModelCatalog([provider], '');
    expect(entries.map((entry) => entry.modelId)).toEqual(['deepseek-v4-pro-ga-260813']);
    expect(isNonChatModel('bge-m3')).toBe(true);
    expect(isNonChatModel('bge-reranker-v2-m3')).toBe(true);
    expect(isNonChatModel('text-embedding-3-large')).toBe(true);
    expect(isNonChatModel('deepseek-v4-pro-ga-260813')).toBe(false);
  });

  it('uses an explicit standard endpoint shape before a stale provider kind', () => {
    const provider = {
      id: 'gateway',
      label: 'Gateway',
      mediaType: 'chat' as const,
      baseUrl: 'https://gateway.example',
      endpointPath: '/v1/chat/completions',
      apiKey: 'secret',
      apiStyle: 'openai-compatible',
      models: ['gemini-compatible'],
      supportsWebSearch: false,
      extraParams: { providerKind: 'google-gemini' },
    };
    expect(resolveAgentProtocol(provider, {})).toBe('openai-chat-completions');
    expect(resolveAgentProtocol({
      ...provider,
      endpointPath: '/v1beta/models/{model}:generateContent',
      extraParams: { providerKind: 'openai-chat-completions' },
    }, {})).toBe('google-gemini');
  });
});
