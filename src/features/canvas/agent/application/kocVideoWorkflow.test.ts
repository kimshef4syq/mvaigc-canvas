import { describe, expect, it } from 'vitest';
import {
  detectKocContentFormat,
  createKocPlan,
  createAudioProductionPlan,
} from './kocVideoWorkflow';

describe('KOC Video & Standalone Audio Workflow (T15 & A22)', () => {
  describe('Content Format Detection', () => {
    it('detects on-camera format by default or when host requested', () => {
      expect(detectKocContentFormat('做一条小红书博主种草视频')).toBe('on-camera');
    });

    it('detects hands-only format for unboxing / hands close-up', () => {
      expect(detectKocContentFormat('仅手部出镜展示这款新耳机的降噪效果')).toBe('hands-only');
    });

    it('detects product-only format when no humans present', () => {
      expect(detectKocContentFormat('仅产品静物展示，不要人物出现')).toBe('product-only');
    });
  });

  describe('Audio & Subtitle Policy Isolation (A22)', () => {
    it('A22: user explicit no-BGM and no-subtitles overrides default', () => {
      const plan = createKocPlan({
        projectId: 'proj-1',
        prompt: '做一条美妆带货视频，明确不要 BGM，也不加字幕',
      });

      expect(plan.workflow.id).toBe('koc-video');
      const soundPolicy = plan.stages[0].executionLocks.soundPolicy as Record<string, string>;
      expect(soundPolicy.bgmMode).toBe('off');
      expect(soundPolicy.subtitleMode).toBe('off');
      expect(soundPolicy.voiceoverMode).toBe('native-in-video');

      // Post stage should be omitted for short clip without BGM or subtitles!
      const stageIds = plan.stageOutline.map((s) => s.id);
      expect(stageIds).not.toContain('post');
    });

    it('defaults to instrumental ducked BGM and subtitles off (strict opt-in)', () => {
      const plan = createKocPlan({
        projectId: 'proj-1',
        prompt: '做一条日常数码开箱种草视频',
      });

      const soundPolicy = plan.stages[0].executionLocks.soundPolicy as Record<string, string>;
      expect(soundPolicy.bgmMode).toBe('instrumental-ducked');
      expect(soundPolicy.subtitleMode).toBe('off'); // Default is OFF!
    });
  });

  describe('Hook & Persona Candidates in Brief Payload', () => {
    it('generates 5 hook options and 3 personas for on-camera format', () => {
      const plan = createKocPlan({
        projectId: 'proj-1',
        prompt: '小红书护肤品真人出镜种草',
        contentFormat: 'on-camera',
      });

      const briefWorkItem = plan.stages[0].workItems[0];
      const payload = briefWorkItem.payload as {
        hookCandidates: Array<{ id: string }>;
        personaCandidates: Array<{ id: string }>;
      };

      expect(briefWorkItem.payload.selectedHookId).toBeUndefined();
      expect(briefWorkItem.payload.selectedPersonaId).toBeUndefined();
      expect(plan.stages[0].review.afterExecution[0].status).toBe('pending');
      expect(payload.hookCandidates).toHaveLength(5);
      expect(payload.personaCandidates).toHaveLength(3);
    });

    it('omits persona candidates when format is product-only', () => {
      const plan = createKocPlan({
        projectId: 'proj-1',
        prompt: '小红书护肤品仅产品静物种草',
        contentFormat: 'product-only',
      });

      const briefWorkItem = plan.stages[0].workItems[0];
      const payload = briefWorkItem.payload as {
        hookCandidates: Array<{ id: string }>;
        personaCandidates: Array<{ id: string }>;
      };

      expect(payload.hookCandidates).toHaveLength(5);
      expect(payload.personaCandidates).toHaveLength(0);
    });
  });

  describe('Standalone Audio Production Workflow', () => {
    it('creates 4-stage standalone audio production pipeline', () => {
      const plan = createAudioProductionPlan({
        projectId: 'proj-1',
        prompt: '为解说词录制一段专业的中文男声配音并制作伴奏',
      });

      expect(plan.workflow.id).toBe('audio-production');
      const stageIds = plan.stageOutline.map((s) => s.id);
      expect(stageIds).toEqual(['script-prep', 'voice-generation', 'music-scoring', 'audio-mastering']);
      expect(plan.stages[0].id).toBe('script-prep');
    });
  });
});
