import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AUDIO_INPUT_SCHEMA,
  defaultAudioInputSchemaForProviderKind,
} from './audioInputSchema';

describe('audio input schema per provider kind', () => {
  it('disables every TTS concept for the comfyui provider kind', () => {
    const schema = defaultAudioInputSchemaForProviderKind('comfyui');
    expect(schema.voice.enabled).toBe(false);
    expect(schema.referenceAudio.enabled).toBe(false);
    expect(schema.referenceAudio.min).toBe(0);
    expect(schema.referenceAudio.max).toBe(0);
    expect(schema.controlInstruction.enabled).toBe(false);
    expect(schema.promptText.enabled).toBe(false);
    expect(schema.parameters).toEqual([]);
    expect(schema.text.enabled).toBe(true);
    expect(schema.text.required).toBe(false);
  });

  it('keeps the doubao TTS defaults unchanged', () => {
    expect(defaultAudioInputSchemaForProviderKind('local-doubao-tts')).toEqual(DEFAULT_AUDIO_INPUT_SCHEMA);
  });

  it('keeps the VoxCPM reference-audio schema unchanged', () => {
    const schema = defaultAudioInputSchemaForProviderKind('gradio-voxcpm');
    expect(schema.voice.enabled).toBe(false);
    expect(schema.referenceAudio.enabled).toBe(true);
    expect(schema.referenceAudio.max).toBe(1);
    expect(schema.controlInstruction.enabled).toBe(true);
    expect(schema.promptText.enabled).toBe(true);
    expect(schema.parameters.map((parameter) => parameter.key)).toEqual([
      'cfgValue',
      'ditSteps',
      'doNormalize',
      'denoise',
    ]);
  });
});
