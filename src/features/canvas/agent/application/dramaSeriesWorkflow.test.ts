import { describe, expect, it } from 'vitest';
import {
  buildDramaSeriesStageOutline,
  sortDramaAnchorsByDependency,
  type DramaAnchorSpec,
  type DramaShotSpec,
} from '../domain/dramaSeries';
import {
  createDramaSeriesPlan,
  authorDramaStoryboardStage,
  reworkDramaShot,
} from './dramaSeriesWorkflow';

describe('Drama Series Workflow Application Service (T12 & A07)', () => {
  describe('Stage Outline & Conditional Stages', () => {
    it('A07: skips script stage when user provides existing script sources', () => {
      const plan = createDramaSeriesPlan({
        projectId: 'proj-1',
        prompt: '基于已上传的剧本文档制作短剧成片',
        sourceIds: ['source-script-1.docx'],
        scope: { episodeScope: '第1集' },
      });

      const stageIds = plan.stageOutline.map((s) => s.id);
      expect(stageIds).not.toContain('script');
      expect(stageIds[0]).toBe('production-plan');
      expect(plan.scope.targetEpisodeScope).toBe('第1集');
      expect(plan.sourceIds).toContain('source-script-1.docx');
    });

    it('includes script stage when user starts from scratch without existing script', () => {
      const plan = createDramaSeriesPlan({
        projectId: 'proj-1',
        prompt: '我想写一部都市战神赘婿短剧并制作成片',
        scope: { hasExistingScript: false },
      });

      const stageIds = plan.stageOutline.map((s) => s.id);
      expect(stageIds[0]).toBe('script');
      expect(stageIds).toContain('production-plan');
      expect(plan.stages[0].id).toBe('script');
    });

    it('omits scene-keyframes stage completely when user chooses skip', () => {
      const outline = buildDramaSeriesStageOutline({
        hasExistingScript: true,
        skipKeyframes: true,
      });

      const stageIds = outline.map((s) => s.id);
      expect(stageIds).not.toContain('scene-keyframes');
      expect(stageIds).toEqual(['production-plan', 'asset-anchors', 'storyboard', 'visual-gen', 'post']);
    });
  });

  describe('Anchor Dependency Ordering (Prop precedes Character)', () => {
    it('sorts props before characters that depend on them', () => {
      const unsorted: DramaAnchorSpec[] = [
        {
          id: 'char-protagonist',
          name: '主角李云天',
          kind: 'character',
          dependsOnPropIds: ['prop-token'],
          prompt: 'A stoic young man holding a dragon jade token',
          aspectRatio: '1:1',
        },
        {
          id: 'prop-token',
          name: '龙纹玉佩',
          kind: 'prop',
          dependsOnPropIds: [],
          prompt: 'An ancient carved dragon jade pendant',
          aspectRatio: '1:1',
        },
        {
          id: 'scene-hall',
          name: '李家宗族大堂',
          kind: 'scene',
          dependsOnPropIds: [],
          prompt: 'Grand traditional Chinese family council hall',
          aspectRatio: '16:9',
        },
      ];

      const sorted = sortDramaAnchorsByDependency(unsorted);
      expect(sorted[0].id).toBe('prop-token');
      expect(sorted[1].id).toBe('char-protagonist');
      expect(sorted[2].id).toBe('scene-hall');
    });
  });

  describe('Storyboard 15s Hard Cap & Verbatim Dialogue', () => {
    it('enforces maximum 15 seconds duration per clip group', () => {
      const plan = createDramaSeriesPlan({
        projectId: 'proj-1',
        prompt: '制作短剧',
        scope: { hasExistingScript: true },
      });

      const validShots: DramaShotSpec[] = [
        {
          shotId: 'shot-1',
          shotNumber: 1,
          clipGroupId: 'group-1',
          durationSeconds: 12.0,
          shotSize: 'medium',
          cameraMovement: 'slow push',
          actionDescription: '李云天冷笑一声，踏入大门',
          verbatimDialogue: '“三年之期已到，我何须再忍！”',
          sfxAmbience: 'heavy footsteps and thunderstorm',
          blocking: [],
        },
      ];

      const stage = authorDramaStoryboardStage(plan, validShots);
      expect(stage.id).toBe('storyboard');
      expect(stage.workItems).toHaveLength(2); // blocking-memory + storyboard-doc

      const oversizedShots: DramaShotSpec[] = [
        {
          ...validShots[0],
          shotId: 'shot-oversized',
          durationSeconds: 18.0, // > 15s cap!
        },
      ];

      expect(() => authorDramaStoryboardStage(plan, oversizedShots)).toThrow('超出单片段 15 秒硬上限');
    });
  });

  describe('Targeted Shot Rework (A11, A15)', () => {
    it('re-authors only the target shot work item without touching other shots', () => {
      const basePlan = createDramaSeriesPlan({
        projectId: 'proj-1',
        prompt: '短剧制作',
        scope: { hasExistingScript: true },
      });

      // Add visual-gen stage with 2 shots
      const planWithVisualGen = {
        ...basePlan,
        stages: [
          ...basePlan.stages,
          {
            id: 'visual-gen',
            order: 4,
            name: '视频生成',
            revision: 1,
            goal: '生成分镜镜头',
            dependsOn: ['storyboard'],
            status: 'ready' as const,
            review: { beforeExecution: [], afterExecution: [] },
            executionLocks: {},
            workItems: [
              {
                id: 'shot-1',
                name: '镜头 1',
                kind: 'video' as const,
                inputRefs: [],
                requiredCapabilities: ['generation:video'],
                attempts: 1,
                status: 'succeeded' as const,
                payload: { prompt: '原始镜头 1 提示词' },
                supersededOutputs: [],
              },
              {
                id: 'shot-2',
                name: '镜头 2',
                kind: 'video' as const,
                inputRefs: [],
                requiredCapabilities: ['generation:video'],
                attempts: 1,
                status: 'succeeded' as const,
                payload: { prompt: '原始镜头 2 提示词' },
                supersededOutputs: [],
              },
            ],
            currentOutputs: [],
            supersededOutputs: [],
          },
        ],
      };

      const reworkedPlan = reworkDramaShot(planWithVisualGen, 'shot-1', '优化后的高光特写镜头 1 提示词');

      const visualGen = reworkedPlan.stages.find((s) => s.id === 'visual-gen')!;
      expect(reworkedPlan.revision).toBe(2);
      expect(visualGen.workItems[0].status).toBe('pending');
      expect(visualGen.workItems[0].attempts).toBe(2);
      expect((visualGen.workItems[0].payload as { prompt: string }).prompt).toBe('优化后的高光特写镜头 1 提示词');

      // Shot 2 is UNTOUCHED
      expect(visualGen.workItems[1].status).toBe('succeeded');
      expect(visualGen.workItems[1].attempts).toBe(1);
      expect((visualGen.workItems[1].payload as { prompt: string }).prompt).toBe('原始镜头 2 提示词');
    });
  });
});
