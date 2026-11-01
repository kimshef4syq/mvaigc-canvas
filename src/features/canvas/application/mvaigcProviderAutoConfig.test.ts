import { describe, expect, it } from 'vitest';

import {
  applyMvaigcProviders,
  buildMvaigcProviders,
  syncMvaigcProvidersFromSettings,
} from './mvaigcProviderAutoConfig';

type BrandMeta = { brand: string; order: number; tag?: string };

const image = () => buildMvaigcProviders(8787, 'u:p').find((p) => p.mediaType === 'image')!;
const video = () => buildMvaigcProviders(8787, 'u:p').find((p) => p.mediaType === 'video')!;
const extra = (provider: ReturnType<typeof image>) => provider.extraParams as Record<string, unknown>;
const perModel = (provider: ReturnType<typeof image>) =>
  (provider.extraParams as Record<string, unknown>).perModel as Record<string, any>;
const brands = (provider: ReturnType<typeof image>) =>
  (provider.extraParams as Record<string, unknown>).modelBrands as Record<string, BrandMeta>;
const descriptions = (provider: ReturnType<typeof image>) =>
  (provider.extraParams as Record<string, unknown>).modelDescriptions as Record<string, string>;

describe('buildMvaigcProviders', () => {
  it('image provider uses asyncTask pointing at the local proxy', () => {
    const imageProvider = image();
    expect(imageProvider.mediaType).toBe('image');
    expect(imageProvider.baseUrl).toBe('http://127.0.0.1:8787');
    expect(imageProvider.endpointPath).toBe('/v1/images/generations');
    expect(imageProvider.apiKey).toBe('u:p');
    const asyncTask = extra(imageProvider).asyncTask as Record<string, unknown>;
    expect(asyncTask.resultEndpointPath).toBe('/v1/tasks/{taskId}');
    expect(asyncTask.successValues).toContain('succeeded');
    expect(asyncTask.pendingValues).toContain('processing');
  });

  it('video provider uses the video* polling fields', () => {
    const videoProvider = video();
    expect(videoProvider.mediaType).toBe('video');
    expect(videoProvider.endpointPath).toBe('/v1/videos');
    expect(extra(videoProvider).videoStatusEndpointPath).toBe('/v1/tasks/{taskId}');
    expect(extra(videoProvider).videoSuccessValues).toContain('succeeded');
    expect(extra(videoProvider).videoTaskIdPath).toBe('id');
  });

  it('video provider forces a JSON request body (proxy accepts JSON only)', () => {
    // Without this OSC defaults video providers to multipart, which the local
    // proxy rejects.
    expect(extra(video()).videoRequestBodyMode).toBe('json');
  });

  it('allows long generations (timeout >= 10 minutes)', () => {
    const imageTimeout = (extra(image()).asyncTask as { timeoutMs: number }).timeoutMs;
    const videoTimeout = extra(video()).videoPollTimeoutMs as number;
    expect(imageTimeout).toBeGreaterThanOrEqual(600000);
    expect(videoTimeout).toBeGreaterThanOrEqual(600000);
  });

  it('uses a stable id per kind so re-saving updates in place', () => {
    const a = buildMvaigcProviders(8787, 'u:p');
    const b = buildMvaigcProviders(9000, 'u:p');
    expect(a.map((p) => p.id)).toEqual(b.map((p) => p.id));
    expect(a[0].id).not.toBe(a[1].id);
  });
});

describe('mvaigc image model list (live mvaigc.cn catalogue)', () => {
  it('exposes exactly the ten image models the site offers', () => {
    expect(image().models).toEqual([
      'gpt_image2_5_sunburst',
      'gpt_image2_5_flare',
      'gpt_image2',
      'Nano-Banana-2_1',
      'Nano-Banana',
      'Nano-Banana-Pro',
      'doubao5.0_Pro',
      'qwen3_0-Pro',
      'wan2_7_Image',
      'wan2_7_Image-pro',
    ]);
  });

  it('groups by vendor in the site order (GPT, Nano-Banana, Seedream, Qwen)', () => {
    const meta = brands(image());
    expect(meta.gpt_image2_5_sunburst).toEqual({ brand: 'GPT', order: 0, tag: 'Recommend' });
    expect(meta['Nano-Banana-2_1']).toEqual({ brand: 'Nano-Banana', order: 1, tag: 'New' });
    expect(meta['doubao5.0_Pro']).toEqual({ brand: 'Seedream', order: 2 });
    expect(meta['qwen3_0-Pro']).toEqual({ brand: 'Qwen', order: 3 });
    expect(meta.wan2_7_Image).toEqual({ brand: 'Qwen', order: 3 });
  });

  it('labels every model with the site display name', () => {
    expect(descriptions(image())).toEqual({
      gpt_image2_5_sunburst: 'GPT-Image-2.5-Pro',
      gpt_image2_5_flare: 'GPT-Image-2.5-Fast',
      gpt_image2: 'GPT-Image-2',
      'Nano-Banana-2_1': 'Nano-Banana-2.1',
      'Nano-Banana': 'Nano-Banana-2',
      'Nano-Banana-Pro': 'Nano-Banana-Pro',
      'doubao5.0_Pro': 'Seedream-5.0-Pro',
      'qwen3_0-Pro': 'Qwen-3.0-Pro',
      wan2_7_Image: 'WAN-2.7',
      'wan2_7_Image-pro': 'WAN-2.7-Pro',
    });
  });

  it('declares each image model its own resolution tiers, defaulting to 2K first', () => {
    const caps = perModel(image());
    expect(caps.gpt_image2_5_sunburst.resolutions[0]).toBe('2K');
    expect([...caps.gpt_image2_5_sunburst.resolutions].sort()).toEqual(['1K', '2K', '4K']);
    expect(caps['doubao5.0_Pro'].resolutions).toEqual(['2K', '1K']);
    expect(caps['qwen3_0-Pro'].resolutions).toEqual(['2K', '1K']);
    expect(caps.wan2_7_Image.resolutions).toEqual(['2K', '1K']);
    expect(caps['wan2_7_Image-pro'].resolutions[0]).toBe('2K');
    expect([...caps['wan2_7_Image-pro'].resolutions].sort()).toEqual(['1K', '2K', '4K']);
  });

  it('declares each image model its own aspect ratios', () => {
    const caps = perModel(image());
    expect(caps.gpt_image2_5_sunburst.aspectRatios).toContain('5:4');
    expect(caps.gpt_image2_5_sunburst.aspectRatios).toContain('2:1');
    expect(caps['doubao5.0_Pro'].aspectRatios).toEqual(
      ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    );
    expect(caps['doubao5.0_Pro'].aspectRatios).not.toContain('5:4');
  });
});

describe('mvaigc video model list (live mvaigc.cn catalogue)', () => {
  it('exposes exactly the twelve video models the site offers', () => {
    expect(video().models).toEqual([
      'maas_seedance_2_5',
      'maas_seedance_2',
      'botsmart_seedance_2_fast',
      'wan_3_prime',
      'wan_3',
      'happyhorse_1',
      'minimax_h3',
      'vidu_q4',
      'kling_v3',
      'kling_v3_omni',
      'veo_3_1',
      'veo_3_1_fast',
    ]);
  });

  it('groups by vendor in the site order', () => {
    const meta = brands(video());
    expect(meta.maas_seedance_2_5).toEqual({ brand: 'Seedance', order: 0, tag: 'New' });
    expect(meta.wan_3_prime).toEqual({ brand: 'WAN', order: 1, tag: 'Recommend' });
    expect(meta.minimax_h3).toEqual({ brand: 'MiniMax', order: 2 });
    expect(meta.vidu_q4).toEqual({ brand: 'Vidu', order: 3, tag: 'New' });
    expect(meta.kling_v3_omni).toEqual({ brand: 'Kling', order: 4 });
    expect(meta.veo_3_1).toEqual({ brand: 'Veo', order: 5 });
  });

  it('labels every video model with the site display name', () => {
    expect(descriptions(video())).toEqual({
      maas_seedance_2_5: 'Seedance-2.5',
      maas_seedance_2: 'Seedance-2.0',
      botsmart_seedance_2_fast: 'Seedance-2.0-Fast',
      wan_3_prime: 'WAN-3.0-Prime(高速版)',
      wan_3: 'WAN-3.0',
      happyhorse_1: 'HappyHorse-1.1',
      minimax_h3: 'MiniMax-H3',
      vidu_q4: 'Vidu-Q4-Preview',
      kling_v3: 'kling-v3',
      kling_v3_omni: 'kling-v3-omni',
      veo_3_1: 'Veo-3.1',
      veo_3_1_fast: 'Veo-3.1-Fast',
    });
  });

  it('declares the scenes each model can actually run', () => {
    const scenes = extra(video()).modelScenes as Record<string, string[]>;
    expect(scenes.kling_v3).toEqual(['start2video', 'start-end2video']);
    expect(scenes.veo_3_1_fast).toEqual(['start2video', 'start-end2video']);
    expect(scenes.kling_v3_omni).toEqual(['reference2video']);
    expect(scenes.maas_seedance_2_5).toEqual([
      'start2video',
      'start-end2video',
      'reference2video',
    ]);
  });
});

describe('mvaigc video perModel capabilities (live values)', () => {
  it('Seedance 2.5 runs 4..30s, SD2.0 series 4..15s, WAN-3.0 2..30s', () => {
    const caps = perModel(video());
    expect(caps.maas_seedance_2_5.durations[0]).toBe('4');
    expect(caps.maas_seedance_2_5.durations.at(-1)).toBe('30');
    expect(caps.maas_seedance_2.durations.at(-1)).toBe('15');
    expect(caps.wan_3.durations[0]).toBe('2');
    expect(caps.wan_3.durations.at(-1)).toBe('30');
  });

  it('Veo only runs a single 8s take', () => {
    expect(perModel(video()).veo_3_1.durations).toEqual(['8']);
    expect(perModel(video()).veo_3_1_fast.durations).toEqual(['8']);
  });

  it('keeps each model’s real resolution tiers, defaulting to 720P when offered', () => {
    const caps = perModel(video());
    expect(caps.maas_seedance_2_5.resolutions[0]).toBe('720P');
    expect([...caps.maas_seedance_2_5.resolutions].sort()).toEqual(['1080P', '480P', '720P']);
    expect(caps.botsmart_seedance_2_fast.resolutions).toEqual(['720P', '480P']);
    expect(caps.minimax_h3.resolutions).toEqual(['2K', '768P']);
    expect(caps.vidu_q4.resolutions).toEqual(['720P', '1080P', '540P', '2K', '4K']);
    expect(caps.kling_v3.resolutions).toEqual(['1080P']);
  });

  it('keeps each model’s real aspect ratios', () => {
    const caps = perModel(video());
    expect(caps.maas_seedance_2_5.aspectRatios).toEqual(
      ['21:9', '16:9', '9:16', '1:1', '4:3', '3:4'],
    );
    expect(caps.veo_3_1.aspectRatios).toEqual(['16:9', '9:16']);
    expect(caps.kling_v3.aspectRatios).toEqual(['16:9', '9:16', '1:1']);
  });

  it('keeps each model’s real reference slot limits', () => {
    const caps = perModel(video());
    expect(caps.maas_seedance_2_5).toMatchObject({ images: 30, videos: 10, audios: 10 });
    expect(caps.maas_seedance_2).toMatchObject({ images: 9, videos: 3, audios: 3 });
    expect(caps.wan_3).toMatchObject({ images: 10, videos: 5, audios: 5 });
    expect(caps.veo_3_1).toMatchObject({ images: 3 });
    expect(caps.veo_3_1.videos).toBeUndefined();
    expect(caps.kling_v3_omni).toMatchObject({ images: 7 });
    expect(caps.kling_v3.images).toBeUndefined();
  });

  it('lists no duplicate values', () => {
    for (const [model, caps] of Object.entries(perModel(video())) as [string, any][]) {
      for (const key of ['durations', 'resolutions', 'aspectRatios']) {
        const list: string[] = caps[key] ?? [];
        expect(new Set(list).size, `${model} ${key} dup`).toBe(list.length);
      }
    }
  });
});

describe('applyMvaigcProviders', () => {
  it('adds providers when they do not exist yet', () => {
    const added: string[] = [];
    const updated: string[] = [];
    applyMvaigcProviders(8787, 'u:p', {
      addProvider: (p) => added.push(p.id),
      updateProvider: (id) => updated.push(id),
      hasProvider: () => false,
    });
    expect(added).toEqual(['mvaigc-image', 'mvaigc-video']);
    expect(updated).toEqual([]);
  });

  it('updates providers in place when they already exist', () => {
    const added: string[] = [];
    const updated: string[] = [];
    applyMvaigcProviders(8787, 'u:p', {
      addProvider: (p) => added.push(p.id),
      updateProvider: (id) => updated.push(id),
      hasProvider: () => true,
    });
    expect(added).toEqual([]);
    expect(updated).toEqual(['mvaigc-image', 'mvaigc-video']);
  });
});

describe('syncMvaigcProvidersFromSettings', () => {
  it('rewrites both providers on launch when credentials are saved', () => {
    const added: string[] = [];
    const updated: string[] = [];
    syncMvaigcProvidersFromSettings(
      { account: 'u', password: 'p', port: 8787 },
      {
        addProvider: (p) => added.push(p.id),
        updateProvider: (id) => updated.push(id),
        hasProvider: () => true,
      },
    );
    expect(added).toEqual([]);
    expect(updated).toEqual(['mvaigc-image', 'mvaigc-video']);
  });

  it('does nothing when the account is not configured', () => {
    const added: string[] = [];
    const updated: string[] = [];
    syncMvaigcProvidersFromSettings(
      { account: '', password: '', port: 8787 },
      {
        addProvider: (p) => added.push(p.id),
        updateProvider: (id) => updated.push(id),
        hasProvider: () => true,
      },
    );
    expect(added).toEqual([]);
    expect(updated).toEqual([]);
  });
});
