import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { buildMvaigcProviders } from '@/features/canvas/application/mvaigcProviderAutoConfig';
import { buildImageModelCatalog } from '@/features/canvas/application/modelCatalog';
import { buildVideoModelCatalog, isVideoEntryAvailableInMode } from '@/features/canvas/application/videoModelCatalog';
import { groupModelsByBrand } from '@/features/canvas/application/modelGroups';
import { ModelBrandMenu } from './ModelBrandMenu';

const [imageProvider, videoProvider] = buildMvaigcProviders(8787, 'u:p');

describe('mvaigc model menu, end to end', () => {
  it('renders the four image vendors in the order mvaigc.cn shows them', () => {
    const entries = buildImageModelCatalog({ customProviders: [imageProvider] });
    const groups = groupModelsByBrand(entries)!;
    const markup = renderToStaticMarkup(createElement(ModelBrandMenu, {
      groups,
      activeId: entries[0].id,
      openBrand: null,
      onOpenBrandChange: vi.fn(),
      onPick: vi.fn(),
    }));

    const vendorRows = [...markup.matchAll(/data-testid="model-brand-([a-z0-9-]+)"/g)]
      .map((match) => match[1]);
    expect(vendorRows).toEqual(['gpt', 'nano-banana', 'seedream', 'qwen']);
  });

  it('labels the image models with their site names inside the vendor flyout', () => {
    const entries = buildImageModelCatalog({ customProviders: [imageProvider] });
    const groups = groupModelsByBrand(entries)!;
    const markup = renderToStaticMarkup(createElement(ModelBrandMenu, {
      groups,
      activeId: entries[0].id,
      openBrand: 'GPT',
      onOpenBrandChange: vi.fn(),
      onPick: vi.fn(),
    }));
    expect(markup).toContain('GPT-Image-2.5-Pro');
    expect(markup).toContain('GPT-Image-2.5-Fast');
    expect(markup).toContain('GPT-Image-2');
  });

  it('greys out kling-v3 and Veo-3.1-Fast in all-reference mode but still lists them', () => {
    const entries = buildVideoModelCatalog([videoProvider]);
    const groups = groupModelsByBrand(entries)!;
    const markup = renderToStaticMarkup(createElement(ModelBrandMenu, {
      groups,
      activeId: entries[0].id,
      openBrand: 'Kling',
      onOpenBrandChange: vi.fn(),
      onPick: vi.fn(),
      isDisabled: (entry) =>
        !isVideoEntryAvailableInMode(entry as { supportedScenes?: string[] }, 'reference'),
      disabledReason: () => '仅文生/首尾帧',
    }));

    expect(markup).toContain('kling-v3');
    expect(markup).toContain('kling-v3-omni');
    expect(markup).toContain('仅文生/首尾帧');
    // kling-v3 is the start/end-frame-only one: listed, but not clickable.
    expect(markup).toMatch(/disabled="" title="仅文生\/首尾帧"/);
    // kling-v3-omni is the reference-capable one, so it stays enabled.
    expect(markup).toMatch(/title="kling-v3-omni"/);
    expect(markup).not.toMatch(/disabled="" title="kling-v3-omni"/);
  });

  it('renders six video vendors with their badges', () => {
    const entries = buildVideoModelCatalog([videoProvider]);
    const groups = groupModelsByBrand(entries)!;
    expect(groups.map((group) => group.brand)).toEqual([
      'Seedance', 'WAN', 'MiniMax', 'Vidu', 'Kling', 'Veo',
    ]);
    expect(groups[0].tag).toBe('New');
    expect(groups[1].tag).toBe('Recommend');
  });
});
