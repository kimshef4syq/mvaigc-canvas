import { describe, expect, it, beforeEach } from 'vitest';
import { productionCoordinator } from './productionCoordinator';
import { productionPlanRepository } from '../infrastructure/productionPlanRepository';
import { type ProductionPlanV1 } from '../domain/productionPlan';

describe('ProductionCoordinator', () => {
  beforeEach(() => {
    productionPlanRepository.clearAll();
    productionCoordinator.clearReceipts();
  });

  const testPlan: ProductionPlanV1 = {
    schemaVersion: 1,
    id: 'plan-coord-01',
    projectId: 'proj-video',
    revision: 1,
    workflow: { id: 'general-video', variant: 'canonical', profileRevision: '1.0' },
    scope: { deliverables: ['continuity-video-series'] },
    stageOutline: [{ id: 'stage-shots', order: 0, name: 'Shot Generation' }],
    stages: [
      {
        id: 'stage-shots',
        order: 0,
        name: 'Shot Generation',
        revision: 1,
        goal: 'Generate 2 video shots',
        dependsOn: [],
        status: 'ready',
        review: { beforeExecution: [], afterExecution: [] },
        executionLocks: { concurrencyLimit: 2 },
        workItems: [
          {
            id: 'shot-1',
            name: 'Shot 1',
            kind: 'video',
            inputRefs: [],
            requiredCapabilities: ['generation:video'],
            attempts: 0,
            status: 'pending',
            payload: { prompt: 'Shot 1 prompt' },
            supersededOutputs: [],
          },
          {
            id: 'shot-2',
            name: 'Shot 2',
            kind: 'video',
            inputRefs: [],
            requiredCapabilities: ['generation:video'],
            attempts: 0,
            status: 'pending',
            payload: { prompt: 'Shot 2 prompt' },
            supersededOutputs: [],
          },
        ],
        currentOutputs: [],
        supersededOutputs: [],
      },
    ],
    status: 'active',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  };

  it('prevents concurrent execution of the same stage with leases', () => {
    productionCoordinator.acquireLease('proj-video', 'plan-coord-01', 'stage-shots', 'run-1');

    // Attempt from run-2 must be rejected
    expect(() =>
      productionCoordinator.acquireLease('proj-video', 'plan-coord-01', 'stage-shots', 'run-2')
    ).toThrow(/独占执行中/);

    // Releasing lease allows new run to acquire
    productionCoordinator.releaseLease('proj-video', 'plan-coord-01', 'stage-shots', 'run-1');
    expect(() =>
      productionCoordinator.acquireLease('proj-video', 'plan-coord-01', 'stage-shots', 'run-2')
    ).not.toThrow();
  });

  it('executes stage work items, records receipts, and reuses receipts idempotently', async () => {
    productionPlanRepository.savePlan(testPlan);

    let executorCalls = 0;
    const mockExecutor = async (item: any) => {
      executorCalls++;
      return {
        output: {
          outputId: `out-${item.id}`,
          assetId: `asset-${item.id}`,
          version: 1,
          verified: true,
          sourceWorkItemId: item.id,
          createdAt: Date.now(),
        },
        receiptId: `rcpt-${item.id}`,
      };
    };

    // First execution: runs executor twice
    const result1 = await productionCoordinator.executeStage({
      projectId: 'proj-video',
      planId: 'plan-coord-01',
      stageId: 'stage-shots',
      expectedRevision: 1,
      runId: 'run-1',
      executeItem: mockExecutor,
    });

    expect(result1.finalStageStatus).toBe('succeeded');
    expect(result1.completedItems).toBe(2);
    expect(result1.reusedReceipts).toBe(0);
    expect(executorCalls).toBe(2);

    // Reset items to pending to simulate re-running
    const planV2 = result1.resumedPlan;
    const resetPlan = {
      ...planV2,
      stages: [
        {
          ...planV2.stages[0],
          status: 'ready' as const,
          workItems: planV2.stages[0].workItems.map((w) => ({ ...w, status: 'pending' as const })),
        },
      ],
    };
    productionPlanRepository.savePlan(resetPlan);

    // Second execution with identical payload: receipts must be reused without calling executor!
    const result2 = await productionCoordinator.executeStage({
      projectId: 'proj-video',
      planId: 'plan-coord-01',
      stageId: 'stage-shots',
      expectedRevision: resetPlan.revision,
      runId: 'run-2',
      executeItem: mockExecutor,
    });

    expect(result2.finalStageStatus).toBe('succeeded');
    expect(result2.reusedReceipts).toBe(2);
    expect(executorCalls).toBe(2); // no extra calls!
  });

  it('handles partial failures by recording successes and marking stage failed', async () => {
    productionPlanRepository.savePlan(testPlan);

    const mockExecutor = async (item: any) => {
      if (item.id === 'shot-2') {
        throw new Error('供应商配额不足或请求超时');
      }
      return {
        output: {
          outputId: `out-${item.id}`,
          assetId: `asset-${item.id}`,
          version: 1,
          verified: true,
          sourceWorkItemId: item.id,
          createdAt: Date.now(),
        },
        receiptId: `rcpt-${item.id}`,
      };
    };

    const result = await productionCoordinator.executeStage({
      projectId: 'proj-video',
      planId: 'plan-coord-01',
      stageId: 'stage-shots',
      expectedRevision: 1,
      runId: 'run-partial',
      executeItem: mockExecutor,
    });

    expect(result.finalStageStatus).toBe('failed');
    expect(result.completedItems).toBe(1);
    expect(result.failedItems).toBe(1);

    const stage = result.resumedPlan.stages[0];
    const shot1 = stage.workItems.find((w) => w.id === 'shot-1');
    const shot2 = stage.workItems.find((w) => w.id === 'shot-2');

    expect(shot1?.status).toBe('succeeded');
    expect(shot1?.currentOutput).toBeDefined();
    expect(shot2?.status).toBe('failed');
    expect(shot2?.error).toContain('供应商配额不足');
  });
});
