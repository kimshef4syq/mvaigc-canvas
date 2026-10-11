import { describe, expect, it } from 'vitest';

import {
  applyMvaigcProviders,
  buildMvaigcProviders,
} from './mvaigcProviderAutoConfig';

describe('buildMvaigcProviders', () => {
  it('image provider uses asyncTask pointing at the local proxy', () => {
    const [image] = buildMvaigcProviders(8787, 'user:pass');
    expect(image.mediaType).toBe('image');
    expect(image.baseUrl).toBe('http://127.0.0.1:8787');
    expect(image.endpointPath).toBe('/v1/images/generations');
    expect(image.apiKey).toBe('user:pass');
    const extra = image.extraParams as Record<string, unknown>;
    const asyncTask = extra.asyncTask as Record<string, unknown>;
    expect(asyncTask.resultEndpointPath).toBe('/v1/tasks/{taskId}');
    expect(asyncTask.successValues).toContain('succeeded');
    expect(asyncTask.pendingValues).toContain('processing');
  });

  it('exposes every mvaigc image model in the picker', () => {
    const [image] = buildMvaigcProviders(8787, 'user:pass');
    for (const key of ['doubao5.0_Pro', 'doubao', 'gpt_image2', 'wan2_7_Image', 'Nano-Banana', 'qwen']) {
      expect(image.models).toContain(key);
    }
  });

  it('puts Nano-Banana-Pro first so it is the default model', () => {
    const [image] = buildMvaigcProviders(8787, 'user:pass');
    expect(image.models[0]).toBe('Nano-Banana-Pro');
  });

  it('exposes every mvaigc video model in the picker', () => {
    const [, video] = buildMvaigcProviders(8787, 'user:pass');
    for (const key of ['botsmart_seedance_2_5', 'veo_3_1', 'minimax_h3', 'kling_v3_omni', 'wan_2_7']) {
      expect(video.models).toContain(key);
    }
  });

  it('video provider uses the video* polling fields', () => {
    const [, video] = buildMvaigcProviders(8787, 'user:pass');
    expect(video.mediaType).toBe('video');
    expect(video.endpointPath).toBe('/v1/videos');
    const extra = video.extraParams as Record<string, unknown>;
    expect(extra.videoStatusEndpointPath).toBe('/v1/tasks/{taskId}');
    expect(extra.videoSuccessValues).toContain('succeeded');
    expect(extra.videoTaskIdPath).toBe('id');
  });

  it('video provider forces a JSON request body (proxy accepts JSON only)', () => {
    // Without this OSC defaults video providers to multipart, which the local
    // proxy rejects.
    const [, video] = buildMvaigcProviders(8787, 'user:pass');
    const extra = video.extraParams as Record<string, unknown>;
    expect(extra.videoRequestBodyMode).toBe('json');
  });

  it('allows long generations (timeout >= 10 minutes)', () => {
    // mvaigc image/video tasks routinely take minutes; a short poll timeout
    // makes OSC give up on tasks that later succeed.
    const [image, video] = buildMvaigcProviders(8787, 'user:pass');
    const imageTimeout = (image.extraParams as { asyncTask: { timeoutMs: number } }).asyncTask.timeoutMs;
    const videoTimeout = (video.extraParams as { videoPollTimeoutMs: number }).videoPollTimeoutMs;
    expect(imageTimeout).toBeGreaterThanOrEqual(600000);
    expect(videoTimeout).toBeGreaterThanOrEqual(600000);
  });

  it('uses a stable id per kind so re-saving updates in place', () => {
    const a = buildMvaigcProviders(8787, 'u:p');
    const b = buildMvaigcProviders(9000, 'u:p');
    expect(a.map((p) => p.id)).toEqual(b.map((p) => p.id));
    expect(a[0].id).not.toBe(a[1].id);
  });

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

describe('mvaigc video perModel', () => {
  const video = () => buildMvaigcProviders(8787, 'u:p').find((p) => p.mediaType === 'video')!;
  const perModel = () => (video().extraParams as Record<string, unknown>).perModel as Record<string, any>;

  it('Seedance 2.5 = 4..30s, SD2.0 系列 = 4..15s', () => {
    expect(perModel().botsmart_seedance_2_5.durations).toEqual(
      Array.from({ length: 27 }, (_, i) => String(4 + i)),
    );
    expect(perModel().botsmart_seedance_2_5.durations).toContain('30');
    expect(perModel().botsmart_seedance_2.durations).toContain('15');
    expect(perModel().botsmart_seedance_2.durations).not.toContain('16');
  });

  it('MiniMax H3 = 4..15s, 其余 = 4..10s', () => {
    expect(perModel().minimax_h3.durations[0]).toBe('4');
    expect(perModel().minimax_h3.durations.at(-1)).toBe('15');
    expect(perModel().wan_2_7.durations.at(-1)).toBe('10');
  });
});

describe('mvaigc video perModel — 480p 与宽高比补齐（hd 后缀除外）', () => {
  const video = () => buildMvaigcProviders(8787, 'u:p').find((p) => p.mediaType === 'video')!;
  const perModel = () => (video().extraParams as Record<string, unknown>).perModel as Record<string, any>;
  const EXTRA_RATIOS = ['21:9', '9:21', '4:3', '3:4', '3:2', '2:3'];

  it('非 hd 模型都含 480p', () => {
    for (const m of ['botsmart_seedance_2_5', 'botsmart_seedance_2', 'botsmart_seedance_2_fast', 'veo_3_1', 'minimax_h3', 'minimax_h3_768p', 'vidu_q3', 'happyhorse_1_720p', 'happyhorse_1_1080p', 'kling_v3_omni', 'wan_2_7']) {
      expect(perModel()[m].resolutions, m).toContain('480p');
    }
  });

  it('hd 后缀模型不含 480p', () => {
    expect(perModel().botsmart_seedance_2_hd.resolutions).not.toContain('480p');
  });

  it('非 hd 模型都含这 6 个宽高比', () => {
    for (const m of ['botsmart_seedance_2_5', 'botsmart_seedance_2', 'botsmart_seedance_2_fast', 'veo_3_1', 'minimax_h3', 'wan_2_7']) {
      for (const r of EXTRA_RATIOS) expect(perModel()[m].aspectRatios, `${m} ${r}`).toContain(r);
    }
  });

  it('hd 模型也补这 6 个宽高比（只是不加 480p）', () => {
    for (const r of EXTRA_RATIOS) expect(perModel().botsmart_seedance_2_hd.aspectRatios).toContain(r);
  });

  it('已有的不重复：解析结果里无重复项', () => {
    for (const m of Object.keys(perModel())) {
      const res: string[] = perModel()[m].resolutions ?? [];
      const ar: string[] = perModel()[m].aspectRatios ?? [];
      expect(new Set(res).size, `${m} res dup`).toBe(res.length);
      expect(new Set(ar).size, `${m} ar dup`).toBe(ar.length);
    }
  });
});
