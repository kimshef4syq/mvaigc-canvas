import { describe, expect, it } from 'vitest';
import type { AudioCatalogEntry } from './audioModelCatalog';
import { buildComfyUIAudioRequest } from './comfyUIAudioRequest';

const entry: AudioCatalogEntry = {
  id: 'custom:voice:workflow', kind: 'comfyui', providerId: 'voice', providerLabel: 'Voice',
  modelId: 'workflow', modelLabel: 'workflow', providerKind: 'comfyui', enabled: true,
  textSlots: [{ nodeId: '10', input: 'text' }, { nodeId: '11', input: 'text' }],
  audioRefs: { min: 0, max: 1 }, extraParams: {},
};
describe('ComfyUI canvas audio request', () => {
  it('sends every named slot and the first slot as prompt, preserving reference order', () => {
    expect(buildComfyUIAudioRequest(entry, { '10.text': '正文', '11.text': '温暖', stale: 'ignore' }, ['file:///voice.wav']))
      .toMatchObject({ model: entry.id, prompt: '正文', reference_audios: ['file:///voice.wav'],
        extra_params: { textSlotValues: { '10.text': '正文', '11.text': '温暖' } } });
  });
  it('rejects overflow before uploads, including workflows without audio slots', () => {
    expect(() => buildComfyUIAudioRequest(entry, {}, ['one', 'two'])).toThrow('只支持 1 个参考音频');
    expect(() => buildComfyUIAudioRequest({ ...entry, audioRefs: { min: 0, max: 0 } }, {}, ['one']))
      .toThrow('只支持 0 个参考音频');
  });
  it('allows server defaults for optional audio and rejects missing required references', () => {
    expect(buildComfyUIAudioRequest(entry, {}, []).reference_audios).toEqual([]);
    expect(() => buildComfyUIAudioRequest({ ...entry, audioRefs: { min: 1, max: 1 } }, {}, []))
      .toThrow('至少需要 1 个参考音频');
  });
  it('blocks unavailable and slotless workflows', () => {
    expect(() => buildComfyUIAudioRequest({ ...entry, notReadyReason: 'Invalid binding' }, {}, []))
      .toThrow('Invalid binding');
    expect(() => buildComfyUIAudioRequest({ ...entry, textSlots: [] }, {}, [])).toThrow('没有可绑定的文本输入');
  });
});

it('includes boolean defaults and preserves an explicitly unchecked value', () => {
  const controlled = { ...entry, booleanSlots: [{ nodeId: '33:31', input: 'value', defaultValue: true }] };
  expect(buildComfyUIAudioRequest(controlled, {}, []).extra_params).toMatchObject({ booleanSlotValues: { '33:31.value': true } });
  expect(buildComfyUIAudioRequest(controlled, { '10.text': 'lyrics' }, [], { '33:31.value': false }).extra_params)
    .toMatchObject({ textSlotValues: { '10.text': 'lyrics' }, booleanSlotValues: { '33:31.value': false } });
  expect(() => buildComfyUIAudioRequest(controlled, {}, [], { '33:31.value': 'false' })).toThrow('布尔值');
});
