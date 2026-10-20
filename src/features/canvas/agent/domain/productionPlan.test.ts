import { describe, expect, it, beforeEach } from 'vitest';
import {
  canTransitionStage,
  calculatePlanProgress,
  propagateStaleStages,
  productionPlanSchema,
  type ProductionPlanV1,
  type ProductionStageV1,
} from './productionPlan';
import {
  productionPlanRepository,
  OptimisticLockError,
} from '../infrastructure/productionPlanRepository';

describe('ProductionPlan domain and repository', () => {
  beforeEach(() => {
    productionPlanRepository.clearAll();
  });

  const basePlan: ProductionPlanV1 = {
    schemaVersion: 1,
    id: 'plan-tvc-01',
    projectId: 'proj-coffee',
    revision: 1,
    workflow: {
      id: 'ad-tvc',
      variant: 'canonical',
      profileRevision: '1.0',
    },
    scope: {
      deliverables: ['commercial-video'],
      targetNodeIds: ['node-1'],
    },
    sourceIds: ['src-brief-1'],
    decisions: [
      {
        key: 'duration',
        value: 30,
        source: 'user',
        scope: 'global',
        timestamp: 1700000000000,
      },
    ],
    stageOutline: [
      { id: 'stage-brief', order: 0, name: 'Brief 与风格锚定' },
      { id: 'stage-storyboard', order: 1, name: '分镜设计' },
      { id: 'stage-generation', order: 2, name: '镜头生成' },
      { id: 'stage-post', order: 3, name: '剪辑与成片' },
    ],
    stages: [],
    status: 'active',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  };

  describe('schema & transitions', () => {
    it('validates a complete ProductionPlan structure', () => {
      const parsed = productionPlanSchema.parse(basePlan);
      expect(parsed.id).toBe('plan-tvc-01');
      expect(parsed.stageOutline).toHaveLength(4);
    });

    it('enforces valid stage transitions', () => {
      expect(canTransitionStage('draft', 'ready')).toBe(true);
      expect(canTransitionStage('ready', 'running')).toBe(true);
      expect(canTransitionStage('running', 'succeeded')).toBe(true);
      expect(canTransitionStage('succeeded', 'running')).toBe(false); // cannot go backwards directly
      expect(canTransitionStage('succeeded', 'stale')).toBe(true); // can become stale on upstream changes
    });

    it('propagates stale status to downstream dependent stages', () => {
      const stages: ProductionStageV1[] = [
        {
          id: 's1',
          order: 0,
          name: 'Stage 1',
          revision: 1,
          goal: 'Brief',
          dependsOn: [],
          status: 'succeeded',
          review: { beforeExecution: [], afterExecution: [] },
          executionLocks: {},
          workItems: [],
          currentOutputs: [],
          supersededOutputs: [],
        },
        {
          id: 's2',
          order: 1,
          name: 'Stage 2',
          revision: 1,
          goal: 'Storyboard',
          dependsOn: ['s1'],
          status: 'succeeded',
          review: { beforeExecution: [], afterExecution: [] },
          executionLocks: {},
          workItems: [],
          currentOutputs: [],
          supersededOutputs: [],
        },
        {
          id: 's3',
          order: 2,
          name: 'Stage 3',
          revision: 1,
          goal: 'Generation',
          dependsOn: ['s2'],
          status: 'succeeded',
          review: { beforeExecution: [], afterExecution: [] },
          executionLocks: {},
          workItems: [],
          currentOutputs: [],
          supersededOutputs: [],
        },
      ];

      // Modify stage 1
      const updated = propagateStaleStages(stages, 's1');
      expect(updated.find((s) => s.id === 's1')?.status).toBe('draft');
      expect(updated.find((s) => s.id === 's2')?.status).toBe('stale');
      expect(updated.find((s) => s.id === 's3')?.status).toBe('stale');
    });

    it('calculates plan progress accurately', () => {
      const planWithStages: ProductionPlanV1 = {
        ...basePlan,
        stages: [
          {
            id: 'stage-brief',
            order: 0,
            name: 'Brief',
            revision: 1,
            goal: 'Brief',
            dependsOn: [],
            status: 'succeeded',
            review: { beforeExecution: [], afterExecution: [] },
            executionLocks: {},
            workItems: [],
            currentOutputs: [],
            supersededOutputs: [],
          },
          {
            id: 'stage-storyboard',
            order: 1,
            name: 'Storyboard',
            revision: 1,
            goal: 'Storyboard',
            dependsOn: ['stage-brief'],
            status: 'succeeded',
            review: { beforeExecution: [], afterExecution: [] },
            executionLocks: {},
            workItems: [],
            currentOutputs: [],
            supersededOutputs: [],
          },
        ],
      };

      const progress = calculatePlanProgress(planWithStages);
      expect(progress.completedStages).toBe(2);
      expect(progress.totalStages).toBe(4);
      expect(progress.percent).toBe(50);
    });
  });

  describe('repository & project isolation', () => {
    it('isolates plans by projectId', () => {
      productionPlanRepository.savePlan(basePlan);

      expect(productionPlanRepository.getPlan('proj-coffee', 'plan-tvc-01')).toBeDefined();
      expect(productionPlanRepository.getPlan('other-project', 'plan-tvc-01')).toBeUndefined();
      expect(productionPlanRepository.listPlans('other-project')).toHaveLength(0);
      expect(productionPlanRepository.listPlans('proj-coffee')).toHaveLength(1);
    });

    it('enforces optimistic locking on stage updates', () => {
      productionPlanRepository.savePlan(basePlan);

      const stage1: ProductionStageV1 = {
        id: 'stage-brief',
        order: 0,
        name: 'Brief 与风格锚定',
        revision: 1,
        goal: '锁定产品卖点与调性',
        dependsOn: [],
        status: 'draft',
        review: { beforeExecution: [], afterExecution: [] },
        executionLocks: {},
        workItems: [
          {
            id: 'item-brief-doc',
            name: 'Brand Brief',
            kind: 'document',
            inputRefs: [],
            requiredCapabilities: [],
            attempts: 0,
            status: 'pending',
            payload: { text: 'Coffee TVC Brief' },
            supersededOutputs: [],
          },
        ],
        currentOutputs: [],
        supersededOutputs: [],
      };

      // Successfully author stage with expectedRevision = 1
      const updatedPlan = productionPlanRepository.authorStage({
        projectId: 'proj-coffee',
        planId: 'plan-tvc-01',
        expectedRevision: 1,
        stage: stage1,
      });

      expect(updatedPlan.revision).toBe(2);
      expect(updatedPlan.stages).toHaveLength(1);

      // Subsequent update with stale revision (1) must fail!
      expect(() =>
        productionPlanRepository.authorStage({
          projectId: 'proj-coffee',
          planId: 'plan-tvc-01',
          expectedRevision: 1,
          stage: stage1,
        })
      ).toThrow(OptimisticLockError);

      // Updating with correct revision (2) succeeds
      const readyPlan = productionPlanRepository.updateStageStatus({
        projectId: 'proj-coffee',
        planId: 'plan-tvc-01',
        expectedRevision: 2,
        stageId: 'stage-brief',
        status: 'ready',
      });
      expect(readyPlan.revision).toBe(3);
      expect(readyPlan.stages[0].status).toBe('ready');
    });

    it('updates work items and tracks superseded outputs upon regeneration', () => {
      const stageWithItem: ProductionStageV1 = {
        id: 'stage-shot1',
        order: 0,
        name: 'Shot 1',
        revision: 1,
        goal: 'Generate shot 1',
        dependsOn: [],
        status: 'running',
        review: { beforeExecution: [], afterExecution: [] },
        executionLocks: {},
        workItems: [
          {
            id: 'item-shot-1',
            name: 'Shot 1 Video',
            kind: 'video',
            inputRefs: [],
            requiredCapabilities: ['generation:video'],
            attempts: 0,
            status: 'pending',
            payload: { prompt: 'Coffee beans falling' },
            supersededOutputs: [],
          },
        ],
        currentOutputs: [],
        supersededOutputs: [],
      };

      productionPlanRepository.savePlan({
        ...basePlan,
        revision: 1,
        stages: [stageWithItem],
      });

      // First run succeeds with output v1
      const output1 = {
        outputId: 'out-1',
        assetId: 'asset-video-v1',
        version: 1,
        verified: true,
        sourceWorkItemId: 'item-shot-1',
        createdAt: Date.now(),
      };

      const planV2 = productionPlanRepository.updateWorkItemStatus({
        projectId: 'proj-coffee',
        planId: 'plan-tvc-01',
        expectedRevision: 1,
        stageId: 'stage-shot1',
        itemId: 'item-shot-1',
        status: 'succeeded',
        output: output1,
      });

      const itemV2 = planV2.stages[0].workItems[0];
      expect(itemV2.currentOutput?.assetId).toBe('asset-video-v1');
      expect(itemV2.supersededOutputs).toHaveLength(0);

      // Regeneration with output v2 -> output1 is superseded!
      const output2 = {
        outputId: 'out-2',
        assetId: 'asset-video-v2',
        version: 2,
        verified: true,
        sourceWorkItemId: 'item-shot-1',
        createdAt: Date.now(),
      };

      const planV3 = productionPlanRepository.updateWorkItemStatus({
        projectId: 'proj-coffee',
        planId: 'plan-tvc-01',
        expectedRevision: 2,
        stageId: 'stage-shot1',
        itemId: 'item-shot-1',
        status: 'succeeded',
        output: output2,
      });

      const itemV3 = planV3.stages[0].workItems[0];
      expect(itemV3.currentOutput?.assetId).toBe('asset-video-v2');
      expect(itemV3.supersededOutputs).toHaveLength(1);
      expect(itemV3.supersededOutputs[0].assetId).toBe('asset-video-v1');
    });
  });
});
