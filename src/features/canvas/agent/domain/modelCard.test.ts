import { describe, expect, it } from 'vitest';
import {
  resolveVendorModelAlias,
  soundPolicySchema,
  promptLayerRecordSchema,
} from './modelCard';

describe('ModelCard domain & vendor aliases', () => {
  it('resolves vendor aliases correctly', () => {
    expect(resolveVendorModelAlias('minimax-h3')).toBe('minimax-h3');
    expect(resolveVendorModelAlias('h3')).toBe('minimax-h3');
    expect(resolveVendorModelAlias('hailuo')).toBe('minimax');
    expect(resolveVendorModelAlias('seed-dance')).toBe('seedance');
    expect(resolveVendorModelAlias('seed_audio')).toBe('seedaudio');
    expect(resolveVendorModelAlias('kling_1.5')).toBe('kling-omni');
    expect(resolveVendorModelAlias('google-veo')).toBe('veo');
    expect(resolveVendorModelAlias('wan-2.1')).toBe('wan');
    expect(resolveVendorModelAlias('mj')).toBe('midjourney');
    expect(resolveVendorModelAlias('flux')).toBe('banana');
    expect(resolveVendorModelAlias('suno')).toBe('official-music');
  });

  it('validates sound policy kinds and defaults', () => {
    const valid = soundPolicySchema.parse({
      kind: 'dialogue',
      speaker: '主角男声',
      language: 'zh-CN',
      hasDialogue: true,
      hasBgm: false,
    });
    expect(valid.kind).toBe('dialogue');
    expect(valid.hasDialogue).toBe(true);
    expect(valid.hasBgm).toBe(false);

    // Mute policy
    const mute = soundPolicySchema.parse({
      kind: 'mute',
    });
    expect(mute.kind).toBe('mute');
    expect(mute.hasBgm).toBe(false);
  });

  it('validates 3-layer prompt record schema', () => {
    const record = promptLayerRecordSchema.parse({
      schemaVersion: 1,
      sourcePrompt: '雨夜中撑伞的男子站在路灯下',
      preparedPrompt: '全局基准：街角；路灯下雨夜\n【镜头1】\n景别与机位：中景\n主体行为：0-4秒 男子撑伞站立',
      submittedPrompt: '全局基准：街角；路灯下雨夜\n【镜头1】\n景别与机位：中景\n主体行为：0-4秒 男子撑伞站立',
      compilerVersion: 'minimax-design-compiler/1.0',
      compilerHash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      modelId: 'minimax-h3',
      referenceSlots: [
        {
          slotIndex: 1,
          slotToken: '@图片1',
          assetId: 'asset-man-face',
          usage: 'identity',
          label: '角色参考',
        },
      ],
      soundPolicy: {
        kind: 'sfx',
        hasDialogue: false,
        hasBgm: false,
        details: '雨声与远处的汽车喇叭声',
      },
      issues: [],
      createdAt: Date.now(),
    });

    expect(record.modelId).toBe('minimax-h3');
    expect(record.referenceSlots).toHaveLength(1);
    expect(record.referenceSlots[0].slotToken).toBe('@图片1');
    expect(record.soundPolicy?.kind).toBe('sfx');
  });
});
