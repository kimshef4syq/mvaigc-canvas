import { describe, expect, it } from 'vitest';
import {
  detectGeneralVideoDriver,
  matchGeneralVideoMethodCards,
  TEXT_ANIMATION_STYLES,
} from '../domain/generalVideoCards';
import {
  createGeneralVideoPlan,
  compileGeneralVideoClipPrompts,
  executeGeneralVideoMethodDirect,
} from './generalVideoWorkflow';

describe('General Video Workflow & Method Cards (T10)', () => {
  describe('N/C/S Driver Routing & Stage Outline Generation', () => {
    it('detects speech driver for explainer/tutorial requests and generates required stages', () => {
      const driver = detectGeneralVideoDriver('制作一个关于量子力学的科普讲解解说视频');
      expect(driver).toBe('speech');

      const plan = createGeneralVideoPlan({
        projectId: 'proj-1',
        prompt: '制作一个关于量子力学的科普讲解解说视频',
      });

      expect(plan.workflow.id).toBe('general-video');
      expect(plan.workflow.variant).toBe('speech');

      const stageIds = plan.stageOutline.map((s) => s.id);
      // Speech requires: intent-brief -> audio -> visual-gen -> post
      expect(stageIds).toEqual(['intent-brief', 'audio', 'visual-gen', 'post']);
      expect(plan.stages[0].executionLocks.soundPolicy).toEqual(
        expect.objectContaining({ mode: 'vo-post-mix', voiceModel: 'seed-audio-1.0' })
      );
    });

    it('detects narrative driver and omits audio stage when no independent BGM is requested', () => {
      const driver = detectGeneralVideoDriver('制作一部雨夜赛博朋克科幻故事短片');
      expect(driver).toBe('narrative');

      const planWithoutBgm = createGeneralVideoPlan({
        projectId: 'proj-1',
        prompt: '制作一部雨夜赛博朋克科幻故事短片',
        options: { wantBgm: false },
      });

      const stageIdsWithoutBgm = planWithoutBgm.stageOutline.map((s) => s.id);
      // Narrative without BGM should NOT include audio stage!
      expect(stageIdsWithoutBgm).not.toContain('audio');
      expect(stageIdsWithoutBgm).toEqual(['intent-brief', 'visual-gen']);
      expect(planWithoutBgm.stages[0].executionLocks.soundPolicy).toEqual(
        expect.objectContaining({ mode: 'native-sfx-ambience', music: 'none' })
      );

      // Narrative with BGM requested adds audio and post
      const planWithBgm = createGeneralVideoPlan({
        projectId: 'proj-1',
        prompt: '制作一部雨夜赛博朋克科幻故事短片',
        options: { wantBgm: true, hasAssets: true },
      });
      const stageIdsWithBgm = planWithBgm.stageOutline.map((s) => s.id);
      expect(stageIdsWithBgm).toEqual(['intent-brief', 'assets', 'visual-gen', 'audio', 'post']);
    });

    it('detects on-camera driver and preserves native spoken voice without standalone audio stage', () => {
      const driver = detectGeneralVideoDriver('博主第一人称日常 Vlog 真人出镜记录');
      expect(driver).toBe('on-camera');

      const plan = createGeneralVideoPlan({
        projectId: 'proj-1',
        prompt: '博主第一人称日常 Vlog 真人出镜记录',
      });

      expect(plan.workflow.variant).toBe('on-camera');
      const stageIds = plan.stageOutline.map((s) => s.id);
      expect(stageIds).not.toContain('audio');
      expect(stageIds).toEqual(['intent-brief', 'visual-gen']);
      expect(plan.stages[0].executionLocks.soundPolicy).toEqual(
        expect.objectContaining({ mode: 'native-voice-ambience', music: 'none' })
      );
    });
  });

  describe('Method Cards: Standalone vs Workflow Execution', () => {
    it('executes method card standalone in direct mode without workflow DAG', () => {
      const result = executeGeneralVideoMethodDirect({
        prompt: '特写咖啡杯升腾的热气',
        methodCardKeywordOrId: '戏剧性停顿',
      });

      expect(result.appliedCard).toBe('戏剧性停顿');
      expect(result.enhancedPrompt).toContain('Dramatic pause');
      expect(result.guidanceRules.length).toBeGreaterThan(0);
    });

    it('supports all 24 named text animation styles in keyword matching', () => {
      expect(TEXT_ANIMATION_STYLES).toHaveLength(24);

      const matchTypewriter = matchGeneralVideoMethodCards('文字动画：打字机效果');
      expect(matchTypewriter.length).toBeGreaterThan(0);
      expect(matchTypewriter[0].id).toBe('text-animation-typewriter');

      const matchGlitch = matchGeneralVideoMethodCards('使用故障切片动效');
      expect(matchGlitch.length).toBeGreaterThan(0);
      expect(matchGlitch[0].id).toBe('text-animation-glitch-slice');
    });

    it('compiles multi-shot prompts enforcing camera perspective deltas and photoreal-skin', () => {
      const prompts = compileGeneralVideoClipPrompts(
        [
          {
            id: 'shot-1',
            order: 0,
            shotSize: 'medium',
            cameraAngle: 'level',
            cameraMove: 'static',
            subjectAction: 'A young female scientist gazes intently at holographic display',
            hasHumanSubject: true,
            dialogue: 'We found the signal.',
            sfxAmbience: 'subtle lab hum',
          },
          {
            id: 'shot-2',
            order: 1,
            shotSize: 'medium', // Will be adjusted to close-up to prevent jump cut
            cameraAngle: 'low-angle',
            cameraMove: 'push-in',
            subjectAction: 'The scientist presses control keys rapidly',
            hasHumanSubject: true,
            sfxAmbience: 'keyboard clicks and ascending tone',
          },
        ],
        'narrative',
        { enforcePhotorealSkin: true }
      );

      expect(prompts).toHaveLength(2);

      // Shot 1 has 0 delta, shot 2 has 45 degree delta
      expect(prompts[0].cameraDelta).toBe(0);
      expect(prompts[1].cameraDelta).toBe(45);

      // Shot 2 shot size adjusted to close-up to enforce shot jump
      expect(prompts[1].prompt).toContain('close-up shot');

      // Both include photoreal skin directives
      expect(prompts[0].prompt).toContain('Photoreal human skin texture');
      expect(prompts[1].prompt).toContain('Photoreal human skin texture');

      // Audio directives
      expect(prompts[0].prompt).toContain('native dialogue: "We found the signal."');
      expect(prompts[1].prompt).toContain('native atmospheric sound: keyboard clicks');
    });
  });
});
