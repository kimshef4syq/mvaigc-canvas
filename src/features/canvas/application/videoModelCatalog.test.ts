import { describe, it, expect } from 'vitest';

import {
  buildVideoModelCatalog,
  isVideoEntryAvailableInMode,
  resolvePerModelCapabilities,
  type VideoCatalogEntry,
} from './videoModelCatalog';
import type { CustomProviderConfig } from '@/stores/customProvidersStore';

function videoProvider(extraParams: Record<string, unknown>, models: string[]): CustomProviderConfig {
  return {
    id: 'p1',
    label: 'P',
    mediaType: 'video',
    baseUrl: 'http://x',
    endpointPath: '/v1/videos',
    modelListEndpointPath: '/v1/models',
    httpMethod: 'POST',
    apiKey: 'k',
    apiStyle: 'generic-json',
    responseFormat: 'generic',
    models,
    supportsWebSearch: false,
    supportedResolutions: ['720p', '1080p'],
    extraParams,
  } as CustomProviderConfig;
}

describe('resolvePerModelCapabilities', () => {
  it('returns per-model overrides when present', () => {
    const p = videoProvider(
      {
        supportedDurations: [5, 10],
        perModel: { 'sd2.5': { durations: [5, 10, 15, 30], images: 30, videos: 3, audios: 3 } },
      },
      ['sd2.5', 'sd2']
    );
    expect(resolvePerModelCapabilities(p, 'sd2.5').durations).toEqual(['5', '10', '15', '30']);
    expect(resolvePerModelCapabilities(p, 'sd2.5').images).toBe(30);
    expect(resolvePerModelCapabilities(p, 'sd2')).toEqual({}); // 未声明 → 空，调用方回退
  });

  it('ignores invalid numeric values and empty arrays', () => {
    const p = videoProvider(
      { perModel: { m: { images: 0, videos: -2, durations: [], resolutions: ['1080p'] } } },
      ['m']
    );
    const caps = resolvePerModelCapabilities(p, 'm');
    expect(caps.images).toBeUndefined();
    expect(caps.videos).toBeUndefined();
    expect(caps.durations).toBeUndefined();
    expect(caps.resolutions).toEqual(['1080p']);
  });
});

describe('buildVideoModelCatalog model metadata', () => {
  it('passes vendor grouping and the model’s scenes through to the entry', () => {
    const p = videoProvider(
      {
        modelBrands: {
          'maas_seedance_2_5': { brand: 'Seedance', order: 0, tag: 'New' },
          kling_v3: { brand: 'Kling', order: 4 },
        },
        modelScenes: {
          maas_seedance_2_5: ['start2video', 'start-end2video', 'reference2video'],
          kling_v3: ['start2video', 'start-end2video'],
        },
      },
      ['maas_seedance_2_5', 'kling_v3']
    );
    const catalog = buildVideoModelCatalog([p]);
    const sd = catalog.find((entry) => entry.modelId === 'maas_seedance_2_5')!;
    const kling = catalog.find((entry) => entry.modelId === 'kling_v3')!;
    expect(sd).toMatchObject({ brand: 'Seedance', brandOrder: 0, brandTag: 'New' });
    expect(kling).toMatchObject({ brand: 'Kling', brandOrder: 4 });
    expect(kling.brandTag).toBeUndefined();
    expect(sd.supportedScenes).toEqual([
      'start2video',
      'start-end2video',
      'reference2video',
    ]);
    expect(kling.supportedScenes).toEqual(['start2video', 'start-end2video']);
  });

  it('leaves brand and scenes undefined when the provider declares neither', () => {
    const entry = buildVideoModelCatalog([videoProvider({}, ['m1'])])[0];
    expect(entry.brand).toBeUndefined();
    expect(entry.supportedScenes).toBeUndefined();
  });
});

describe('buildVideoModelCatalog per-model', () => {
  it('applies per-model durations/resolutions and falls back otherwise', () => {
    const p = videoProvider(
      {
        supportedRatios: ['16:9'],
        supportedDurations: [5, 10],
        perModel: {
          'sd2.5': {
            durations: [5, 10, 15, 30],
            resolutions: ['1080p'],
            aspectRatios: ['16:9', '9:16'],
            images: 30,
          },
          sd2: { durations: [5, 10, 15] },
        },
      },
      ['sd2.5', 'sd2']
    );
    const catalog = buildVideoModelCatalog([p]);
    const e25 = catalog.find((e) => e.modelId === 'sd2.5')!;
    const e2 = catalog.find((e) => e.modelId === 'sd2')!;
    expect(e25.supportedDurations).toEqual(['5', '10', '15', '30']);
    expect(e25.supportedResolutions).toEqual(['1080p']);
    expect(e25.supportedAspectRatios).toEqual(['16:9', '9:16']);
    expect(e25.supportedImageCount).toBe(30);
    expect(e2.supportedDurations).toEqual(['5', '10', '15']);
    expect(e2.supportedResolutions).toEqual(['720p', '1080p']); // 回退供应商级
    expect(e2.supportedImageCount).toBeUndefined();
  });

  it('ignores perModel entirely when absent (behavior unchanged)', () => {
    const p = videoProvider({ supportedDurations: [5, 10], supportedRatios: ['16:9'] }, ['m1']);
    const e = buildVideoModelCatalog([p])[0];
    expect(e.supportedDurations).toEqual(['5', '10']);
    expect(e.supportedImageCount).toBeUndefined();
  });
});

describe('isVideoEntryAvailableInMode', () => {
  const entry = (scenes?: string[]): VideoCatalogEntry => ({
    id: 'e',
    providerId: 'p',
    providerLabel: 'P',
    modelId: 'm',
    modelLabel: 'M',
    supportedDurations: ['5'],
    supportedResolutions: ['720p'],
    supportedAspectRatios: ['16:9'],
    inputSchema: {
      images: { enabled: true, min: 0, max: 1, roles: ['reference'], requireImageHost: false },
      video: { enabled: false, min: 0, max: 0, field: '' },
      audio: { enabled: false, min: 0, max: 0, field: '' },
    },
    usable: true,
    ...(scenes ? { supportedScenes: scenes } : {}),
  });

  it('keeps every model selectable in text-to-video and image-to-video modes', () => {
    expect(isVideoEntryAvailableInMode(entry(['start2video']), 'text')).toBe(true);
    expect(isVideoEntryAvailableInMode(entry(['start2video']), 'image')).toBe(true);
  });

  it('only offers reference-capable models in all-reference mode', () => {
    expect(isVideoEntryAvailableInMode(entry(['start2video', 'reference2video']), 'reference')).toBe(true);
    expect(isVideoEntryAvailableInMode(entry(['start2video', 'start-end2video']), 'reference')).toBe(false);
  });

  it('only offers start/end-frame capable models in frames mode', () => {
    expect(isVideoEntryAvailableInMode(entry(['start-end2video']), 'frames')).toBe(true);
    expect(isVideoEntryAvailableInMode(entry(['reference2video']), 'frames')).toBe(false);
  });

  it('leaves models without a declared scene list selectable everywhere', () => {
    for (const mode of ['text', 'image', 'frames', 'reference'] as const) {
      expect(isVideoEntryAvailableInMode(entry(), mode)).toBe(true);
    }
  });
});
