import { describe, expect, it } from 'vitest';

import { AGNES_PROVIDER_DEFAULTS, type CustomProviderConfig } from '@/stores/customProvidersStore';
import { buildImageModelCatalog } from './modelCatalog';

function imageProvider(extraParams: Record<string, unknown>, models: string[]): CustomProviderConfig {
  return {
    id: 'p1',
    label: 'P',
    mediaType: 'image',
    baseUrl: 'http://x',
    endpointPath: '/v1/images/generations',
    httpMethod: 'POST',
    apiKey: 'k',
    apiStyle: 'generic-json',
    models,
    supportsWebSearch: false,
    extraParams,
  } as CustomProviderConfig;
}

describe('custom image catalog model metadata', () => {
  it('uses modelDescriptions for the picker label and keeps the raw id otherwise', () => {
    const entries = buildImageModelCatalog({
      customProviders: [imageProvider(
        { modelDescriptions: { 'gpt_image2_5_sunburst': 'GPT-Image-2.5-Pro' } },
        ['gpt_image2_5_sunburst', 'unlabelled'],
      )],
    });
    expect(entries.map((entry) => [entry.modelId, entry.modelLabel])).toEqual([
      ['gpt_image2_5_sunburst', 'GPT-Image-2.5-Pro'],
      ['unlabelled', 'unlabelled'],
    ]);
  });

  it('passes the vendor grouping through so the picker can build a submenu', () => {
    const entries = buildImageModelCatalog({
      customProviders: [imageProvider(
        {
          modelBrands: {
            a: { brand: 'GPT', order: 0, tag: 'Recommend' },
            b: { brand: 'Nano-Banana', order: 1, tag: 'New' },
            c: { brand: 'Seedream', order: 2 },
          },
        },
        ['a', 'b', 'c'],
      )],
    });
    expect(entries.map((entry) => [entry.brand, entry.brandOrder, entry.brandTag])).toEqual([
      ['GPT', 0, 'Recommend'],
      ['Nano-Banana', 1, 'New'],
      ['Seedream', 2, undefined],
    ]);
  });

  it('leaves brand fields undefined for providers that declare no grouping', () => {
    const entries = buildImageModelCatalog({
      customProviders: [imageProvider({}, ['m1'])],
    });
    expect(entries[0].brand).toBeUndefined();
    expect(entries[0].brandOrder).toBeUndefined();
  });

  it('applies per-model resolution and ratio overrides to the entry', () => {
    const entries = buildImageModelCatalog({
      customProviders: [imageProvider(
        {
          supportedRatios: ['auto', '16:9'],
          perModel: {
            'doubao5.0_Pro': { resolutions: ['2K', '1K'], aspectRatios: ['16:9', '9:16'] },
          },
        },
        ['doubao5.0_Pro', 'plain'],
      )],
    });
    const doubao = entries.find((entry) => entry.modelId === 'doubao5.0_Pro')!;
    const plain = entries.find((entry) => entry.modelId === 'plain')!;
    expect(doubao.supportedResolutions).toEqual(['2K', '1K']);
    expect(doubao.supportedRatios).toEqual(['16:9', '9:16']);
    expect(plain.supportedResolutions).toBeUndefined();
    expect(plain.supportedRatios).toEqual(['auto', '16:9']);
  });
});

describe('Agnes image catalog', () => {
  it('exposes 3K only for Image 2.1 while retaining Image 2.0 explicit pixels', () => {
    const entries = buildImageModelCatalog({ customProviders: [], agnesApiKey: 'agnes-key' });
    const image21 = entries.find(({ modelId }) => (
      modelId === AGNES_PROVIDER_DEFAULTS.models.image21Flash
    ));
    const image20 = entries.find(({ modelId }) => (
      modelId === AGNES_PROVIDER_DEFAULTS.models.image20Flash
    ));

    expect(image21?.supportedResolutions).toContain('3K');
    expect(image20?.supportedResolutions).not.toContain('3K');
    expect(image20?.supportedResolutions).toEqual([
      '1024x1024',
      '1024x768',
      '768x1024',
      'auto',
    ]);
  });
});
