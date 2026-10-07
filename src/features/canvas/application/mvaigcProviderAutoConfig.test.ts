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
