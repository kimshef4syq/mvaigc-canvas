import { describe, expect, it } from 'vitest';

import { buildAudioModelCatalog } from './audioModelCatalog';
import { textSlotKey } from '@/features/canvas/infrastructure/comfyuiGateway';
import { DEFAULT_AUDIO_GENERATION_SETTINGS } from '@/stores/settingsStore';
import type { CustomProviderConfig } from '@/stores/customProvidersStore';

const imageWorkflow = {
  '3': { class_type: 'KSampler', inputs: { seed: 1, positive: ['6', 0] } },
  '6': { class_type: 'CLIPTextEncode', inputs: { text: 'original prompt' } },
  '9': { class_type: 'SaveImage', inputs: { images: ['3', 0] } },
};

// 参考声人声工作流：LoadAudio 已填服务器文件名（音频槽可选），正文由 42.text 提供。
const voiceCloneWorkflow = {
  '40': { class_type: 'LoadAudio', inputs: { audio: 'server.wav' } },
  '42': { class_type: 'Text', inputs: { text: 'BODY' } },
  '43': { class_type: 'FB_Qwen3TTSVoiceClone', inputs: { target_text: ['42', 0], ref_audio: ['40', 0] } },
  '44': { class_type: 'Apply Whisper', inputs: { audio: ['40', 0], prompt: '' } },
  '52': { class_type: 'SaveAudioMP3', inputs: { audio: ['43', 0] } },
};

function provider(overrides: Partial<CustomProviderConfig> = {}): CustomProviderConfig {
  return {
    id: 'comfy-image',
    label: 'Local ComfyUI',
    mediaType: 'image',
    baseUrl: 'http://127.0.0.1:8188',
    apiKey: '',
    apiStyle: 'comfyui',
    models: ['workflow'],
    supportsWebSearch: false,
    extraParams: {
      auth: { mode: 'none' },
      comfyui: { workflow: imageWorkflow, outputNodeIds: ['9'] },
    },
    ...overrides,
  };
}

function comfyAudioProvider(overrides: Partial<CustomProviderConfig> = {}): CustomProviderConfig {
  return provider({
    id: 'comfy-audio',
    label: 'Comfy Audio',
    mediaType: 'audio',
    extraParams: {
      auth: { mode: 'none' },
      comfyui: { workflow: voiceCloneWorkflow, outputNodeIds: ['52'] },
    },
    ...overrides,
  });
}

describe('buildAudioModelCatalog', () => {
  it('merges builtin TTS models with ComfyUI audio providers', () => {
    const catalog = buildAudioModelCatalog(DEFAULT_AUDIO_GENERATION_SETTINGS, [comfyAudioProvider()]);
    expect(catalog.filter((e) => e.kind === 'builtin').map((e) => e.id))
      .toEqual(['local-doubao-tts', 'voxcpm-online']);
    const comfy = catalog.find((e) => e.kind === 'comfyui')!;
    expect(comfy.id).toBe('custom:comfy-audio:workflow');
    expect(comfy.providerKind).toBe('comfyui');
    expect(comfy.textSlots.map(textSlotKey)).toEqual(['42.text']);
    expect(comfy.audioRefs).toEqual({ min: 0, max: 1 });
    expect(comfy.audioModel).toBeUndefined();
  });

  it('carries the original TTS config on builtin entries', () => {
    const catalog = buildAudioModelCatalog(DEFAULT_AUDIO_GENERATION_SETTINGS, []);
    const builtin = catalog.find((e) => e.id === 'local-doubao-tts')!;
    expect(builtin.audioModel).toBe(DEFAULT_AUDIO_GENERATION_SETTINGS.models[0]);
    expect(builtin.textSlots).toEqual([]);
    expect(builtin.audioRefs).toEqual({ min: 0, max: 0 });
  });

  it('excludes image and video providers and unusable audio providers', () => {
    const catalog = buildAudioModelCatalog(DEFAULT_AUDIO_GENERATION_SETTINGS, [
      provider(), provider({ id: 'v', mediaType: 'video' }),
      comfyAudioProvider({ baseUrl: '' }),
    ]);
    expect(catalog.filter((e) => e.kind === 'comfyui')).toEqual([]);
  });

  it('lists a provider whose ComfyUI config cannot be parsed instead of dropping it', () => {
    const catalog = buildAudioModelCatalog(DEFAULT_AUDIO_GENERATION_SETTINGS, [
      comfyAudioProvider({ extraParams: { auth: { mode: 'none' } } }),
    ]);
    const comfy = catalog.find((e) => e.kind === 'comfyui')!;
    expect(comfy.id).toBe('custom:comfy-audio:workflow');
    expect(comfy.notReadyReason).toBe('ComfyUI 配置缺少 API 工作流。');
    expect(comfy.textSlots).toEqual([]);
    expect(comfy.audioRefs).toEqual({ min: 0, max: 0 });
  });
});
