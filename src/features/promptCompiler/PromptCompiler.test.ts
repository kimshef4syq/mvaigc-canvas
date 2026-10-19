import { describe, expect, it } from 'vitest';
import { compileMinimaxH3Prompt, compileSeedancePrompt } from './PromptCompiler';
import { lintPrompt } from './PromptLinter';

describe('imported video prompt contracts', () => {
  it('assembles the H3 sections and ordered timeline', () => {
    expect(compileMinimaxH3Prompt({
      durationSeconds: 6,
      space: '街角',
      camera: '中景，侧面机位',
      cameraMotion: '从路口缓慢推进',
      lighting: '傍晚侧光',
      backgroundMotion: '树影随风摆动',
      actions: [
        { startSeconds: 0, endSeconds: 2, action: '人物停步' },
        { startSeconds: 2, endSeconds: 4, action: '抬头' },
        { startSeconds: 4, endSeconds: 6, action: '继续前行' },
      ],
      sound: '脚步声',
    })).toContain('4–6秒 继续前行\n重要背景运动：树影随风摆动\n台词或声音：脚步声');
  });

  it('rejects overlapping actions and references only supplied Seedance slots', () => {
    expect(() => compileSeedancePrompt({
      durationSeconds: 8,
      scene: '房间',
      actions: [
        { startSeconds: 0, endSeconds: 3, action: '走向门口' },
        { startSeconds: 2, endSeconds: 4, action: '开门' },
        { startSeconds: 4, endSeconds: 6, action: '进屋' },
        { startSeconds: 6, endSeconds: 8, action: '关门' },
      ],
    })).toThrow(/non-overlapping/);
    const prompt = compileSeedancePrompt({
      durationSeconds: 8,
      scene: '房间',
      characterImageSlot: 1,
      actions: [
        { startSeconds: 0, endSeconds: 2, action: '走向门口' },
        { startSeconds: 2, endSeconds: 4, action: '开门' },
        { startSeconds: 4, endSeconds: 6, action: '进屋' },
        { startSeconds: 6, endSeconds: 8, action: '关门' },
      ],
    });
    expect(prompt).toContain('@图片1');
    expect(prompt).not.toContain('@音频1');
  });

  it('keeps explicit exclusions and quoted text while surfacing preflight issues', () => {
    const result = lintPrompt({
      prompt: '人脸特写，不要磨皮，片尾字幕“你好”',
      modality: 'video',
      referenceAudioDurationSeconds: 4,
    });
    expect(result.prompt).toContain('不要磨皮，片尾字幕“你好”');
    expect(result.prompt).not.toContain('自然皮肤纹理');
    expect(result.suggestedPrompt).toContain('自然皮肤纹理');
    expect(result.issues.filter((issue) => issue.code !== 'audio-sample').every((issue) => issue.sourceProfileId)).toBe(true);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      'negation', 'on-image-text', 'plastic-skin', 'audio-sample',
    ]);
  });

  it('assembles distinct H3 shots with ordered actions', () => {
    const prompt = compileMinimaxH3Prompt({
      durationSeconds: 8,
      space: '室内', lighting: '晨光',
      shots: [
        { camera: '近景', cameraMotion: '推进', backgroundMotion: '窗帘摆动', sound: '脚步', actions: [{ startSeconds: 0, endSeconds: 4, action: '转身' }] },
        { camera: '特写', cameraMotion: '固定', backgroundMotion: '光影移动', sound: '呼吸', actions: [{ startSeconds: 4, endSeconds: 8, action: '抬眼' }] },
      ],
    });
    expect(prompt).toContain('【镜头1】');
    expect(prompt).toContain('【镜头2】');
    expect(prompt).toContain('4–8秒 抬眼');
  });

  it('uses precise Seedance timing only when selected', () => {
    const actions = [0, 2, 4, 6].map((startSeconds) => ({ startSeconds, endSeconds: startSeconds + 2, action: '行走' }));
    expect(compileSeedancePrompt({ durationSeconds: 8, scene: '街道', actions, timingMode: 'precise' })).toContain('2–4秒：行走');
    expect(compileSeedancePrompt({ durationSeconds: 8, scene: '街道', actions })).not.toContain('2–4秒：行走');
  });

  it('flags semantic risks without changing the requested subject or style', () => {
    const original = '复古中国风的韩漫角色，保持同一人，加入品牌 logo，高级感';
    const issues = lintPrompt({
      prompt: original,
      modality: 'video',
      referenceImageCount: 0,
    });
    expect(issues.prompt).toBe(original);
    expect(issues.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'brand-injection', 'character-refs', 'cultural-stereotypes',
      'era-disambiguation', 'mood-vocabulary', 'webtoon-proportions',
    ]));
    expect(lintPrompt({ prompt: original, modality: 'video', referenceImageCount: 1 })
      .issues.map((issue) => issue.code)).not.toContain('brand-injection');
  });
});
