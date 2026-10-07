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
