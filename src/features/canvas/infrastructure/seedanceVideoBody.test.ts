import { describe, expect, it } from 'vitest';

import type { CustomProviderConfig } from '@/stores/customProvidersStore';

import { buildVideoJsonBody, resolveVideoRequestBodyMode } from './customProviderGateway';

function seedanceProvider(): CustomProviderConfig {
  return {
    id: 'seedance',
    label: '即梦 / Seedance Video',
    baseUrl: 'https://ark.cn-beijing.volces.com',
    endpointPath: '/api/v3/contents/generations/tasks',
    httpMethod: 'POST',
    apiKey: 'secret',
    apiStyle: 'generic-json',
    models: ['doubao-seedance-2-0-fast-260215'],
    supportsWebSearch: false,
    mediaType: 'video',
    extraParams: {
      providerKind: 'seedance-video',
      requestComposer: 'video-volcengine-seedance-json',
      videoRequestBodyMode: 'json',
      defaultRequestParams: { generate_audio: false, watermark: false },
    },
  } as CustomProviderConfig;
}

describe('buildVideoJsonBody (volcengine seedance)', () => {
  it('writes reference image, video and audio into the Ark content array with roles', () => {
    const body = buildVideoJsonBody(seedanceProvider(), 'doubao-seedance-2-0-fast-260215', {
      prompt: '一只猫奔跑',
      model: 'doubao-seedance-2-0-fast-260215',
      size: '720p',
      aspect_ratio: '16:9',
      reference_images: ['https://example.com/a.png'],
      reference_videos: ['https://example.com/b.mp4'],
      reference_audios: ['https://example.com/c.mp3'],
      extra_params: { seconds: 5 },
    });

    expect(body.content).toEqual([
      { type: 'image_url', image_url: { url: 'https://example.com/a.png' }, role: 'reference_image' },
      { type: 'video_url', video_url: { url: 'https://example.com/b.mp4' }, role: 'reference_video' },
      { type: 'audio_url', audio_url: { url: 'https://example.com/c.mp3' }, role: 'reference_audio' },
      { type: 'text', text: '一只猫奔跑' },
    ]);
  });

  it('emits only the text entry when no references are connected', () => {
    const body = buildVideoJsonBody(seedanceProvider(), 'doubao-seedance-2-0-fast-260215', {
      prompt: '一只猫奔跑',
      model: 'doubao-seedance-2-0-fast-260215',
      size: '720p',
      aspect_ratio: '16:9',
      extra_params: { seconds: 5 },
    });

    expect(body.content).toEqual([{ type: 'text', text: '一只猫奔跑' }]);
  });
});

describe('resolveVideoRequestBodyMode', () => {
  it('uses the seedance preset json mode', () => {
    expect(resolveVideoRequestBodyMode(seedanceProvider())).toBe('json');
  });
});
