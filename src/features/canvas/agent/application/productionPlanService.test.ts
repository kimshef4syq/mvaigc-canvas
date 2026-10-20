import { describe, expect, it, beforeEach } from 'vitest';
import { productionPlanService } from './productionPlanService';
import { productionPlanRepository } from '../infrastructure/productionPlanRepository';

describe('ProductionPlanService', () => {
  beforeEach(() => {
    productionPlanRepository.clearAll();
  });

  it('creates plan with idempotency via requestId', () => {
    const input = {
      projectId: 'proj-tvc',
      requestId: 'req-001',
      workflow: { id: 'ad-tvc', variant: 'canonical' },
      scope: { deliverables: ['commercial-video'] },
      stageOutline: [
        { id: 'stage-brief', order: 0, name: 'Brief' },
        { id: 'stage-storyboard', order: 1, name: 'Storyboard' },
      ],
    };

    const plan1 = productionPlanService.createPlan(input);
    expect(plan1.id).toBeDefined();
    expect(plan1.revision).toBe(1);

    // Same requestId returns identical plan without creating duplicate
    const plan2 = productionPlanService.createPlan(input);
    expect(plan2.id).toBe(plan1.id);
    expect(productionPlanService.listPlans('proj-tvc')).toHaveLength(1);
  });

  it('authors stages and propagates stale down the chain', () => {
    const plan = productionPlanService.createPlan({
      projectId: 'proj-tvc',
      workflow: { id: 'ad-tvc' },
      scope: { deliverables: ['commercial-video'] },
      stageOutline: [
        { id: 'stage-brief', order: 0, name: 'Brief' },
        { id: 'stage-storyboard', order: 1, name: 'Storyboard' },
      ],
    });

    // Author stage 1
    const planAfterS1 = productionPlanService.authorStage({
      projectId: 'proj-tvc',
      planId: plan.id,
      expectedRevision: 1,
      stage: {
        id: 'stage-brief',
        order: 0,
        name: 'Brief',
        revision: 1,
        goal: 'Clarify brand brief',
        dependsOn: [],
        status: 'ready',
        review: { beforeExecution: [], afterExecution: [] },
        executionLocks: {},
        workItems: [],
        currentOutputs: [],
        supersededOutputs: [],
      },
    });

    expect(planAfterS1.revision).toBe(2);
    expect(planAfterS1.stages).toHaveLength(1);

    // Author stage 2 depending on stage 1
    const planAfterS2 = productionPlanService.authorStage({
      projectId: 'proj-tvc',
      planId: plan.id,
      expectedRevision: 2,
      stage: {
        id: 'stage-storyboard',
        order: 1,
        name: 'Storyboard',
        revision: 1,
        goal: 'Draft 6 shots',
        dependsOn: ['stage-brief'],
        status: 'succeeded',
        review: { beforeExecution: [], afterExecution: [] },
        executionLocks: {},
        workItems: [],
        currentOutputs: [],
        supersededOutputs: [],
      },
    });

    expect(planAfterS2.revision).toBe(3);
    expect(planAfterS2.stages).toHaveLength(2);

    // Now re-author stage 1 -> stage 2 should be marked stale!
    const planReauthored = productionPlanService.authorStage({
      projectId: 'proj-tvc',
      planId: plan.id,
      expectedRevision: 3,
      stage: {
        id: 'stage-brief',
        order: 0,
        name: 'Brief Modified',
        revision: 2,
        goal: 'Updated brand brief',
        dependsOn: [],
        status: 'ready',
        review: { beforeExecution: [], afterExecution: [] },
        executionLocks: {},
        workItems: [],
        currentOutputs: [],
        supersededOutputs: [],
      },
      changeReason: 'User requested tone update',
    });

    expect(planReauthored.revision).toBe(4);
    const s2 = planReauthored.stages.find((s) => s.id === 'stage-storyboard');
    expect(s2?.status).toBe('stale');
  });

  it('resets failed items for retry without touching succeeded items', () => {
    const plan = productionPlanService.createPlan({
      projectId: 'proj-tvc',
      workflow: { id: 'ad-tvc' },
      scope: { deliverables: ['commercial-video'] },
      stageOutline: [{ id: 'stage-shots', order: 0, name: 'Shots' }],
      initialStage: {
        id: 'stage-shots',
        order: 0,
        name: 'Shots',
        revision: 1,
        goal: 'Render shots',
        dependsOn: [],
        status: 'running',
        review: { beforeExecution: [], afterExecution: [] },
        executionLocks: {},
        workItems: [
          {
            id: 'shot-1',
            name: 'Shot 1',
            kind: 'video',
            inputRefs: [],
            requiredCapabilities: ['generation:video'],
            attempts: 1,
            status: 'succeeded',
            payload: {},
            currentOutput: {
              outputId: 'out-1',
              version: 1,
              verified: true,
              sourceWorkItemId: 'shot-1',
              createdAt: Date.now(),
            },
            supersededOutputs: [],
          },
          {
            id: 'shot-2',
            name: 'Shot 2',
            kind: 'video',
            inputRefs: [],
            requiredCapabilities: ['generation:video'],
            attempts: 1,
            status: 'failed',
            error: 'Timeout on provider',
            payload: {},
            supersededOutputs: [],
          },
        ],
        currentOutputs: [],
        supersededOutputs: [],
      },
    });

    const retriedPlan = productionPlanService.retryItems({
      projectId: 'proj-tvc',
      planId: plan.id,
      expectedRevision: 1,
      stageId: 'stage-shots',
      itemIds: ['shot-2'],
    });

    expect(retriedPlan.revision).toBe(2);
    const stage = retriedPlan.stages[0];
    const item1 = stage.workItems.find((w) => w.id === 'shot-1');
    const item2 = stage.workItems.find((w) => w.id === 'shot-2');

    expect(item1?.status).toBe('succeeded');
    expect(item2?.status).toBe('pending');
    expect(item2?.error).toBeUndefined();
    expect(stage.status).toBe('ready');
  });
});
