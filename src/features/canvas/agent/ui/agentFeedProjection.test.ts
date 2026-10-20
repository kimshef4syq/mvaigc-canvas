import { describe, expect, it } from 'vitest';
import {
  executionReceiptFromAgentOutput,
  generationLocateTargetsFromAgentOutput,
  generationProgressFromAgentOutput,
  nodeIdsFromAgentOutput,
} from './agentFeedProjection';

describe('agentFeedProjection', () => {
  it('projects unique node ids from direct and wrapped tool output', () => {
    expect(nodeIdsFromAgentOutput({
      output: {
        references: {
          nodeId: 'node-2',
          nodeIds: ['node-1', 'node-2', '', 42],
        },
      },
    })).toEqual(['node-1', 'node-2']);
  });

  it('projects receipts from command and wrapped execution output', () => {
    expect(executionReceiptFromAgentOutput({
      output: {
        execution: { receiptId: 'receipt-1' },
        rollbackToken: 'rollback-1',
      },
    })).toEqual({ receiptId: 'receipt-1', rollbackToken: 'rollback-1' });
  });

  it('keeps generation input and result locate targets separate', () => {
    expect(generationLocateTargetsFromAgentOutput({
      followThrough: {
        inputNodeIds: ['input-1', 'input-1'],
        resultNodeIds: ['result-1', '', 42],
      },
    })).toEqual({ inputNodeIds: ['input-1'], resultNodeIds: ['result-1'] });
  });

  it('returns empty projections for invalid boundary values', () => {
    expect(nodeIdsFromAgentOutput(['node-1'])).toEqual([]);
    expect(executionReceiptFromAgentOutput(null)).toEqual({});
    expect(generationLocateTargetsFromAgentOutput(null)).toEqual({ inputNodeIds: [], resultNodeIds: [] });
    expect(generationProgressFromAgentOutput(null)).toBeNull();
  });

  it('projects accepted and bounded generation polling progress', () => {
    expect(generationProgressFromAgentOutput({ followThrough: { phase: 'accepted' } })).toEqual({
      phase: 'accepted', attempt: 0, maxAttempts: 0, statuses: [],
    });
    expect(generationProgressFromAgentOutput({
      followThrough: {
        phase: 'generation-follow-through',
        attempt: 7,
        maxAttempts: 72,
        statuses: ['running'],
      },
    })).toEqual({ phase: 'polling', attempt: 7, maxAttempts: 72, statuses: ['running'] });
  });

  describe('production plan & task route projections', () => {
    it('projects production plan progress, outline, and active stage view', async () => {
      const { projectProductionPlanView } = await import('./agentFeedProjection');
      const planView = projectProductionPlanView({
        schemaVersion: 1,
        id: 'plan-001',
        projectId: 'proj-1',
        revision: 2,
        workflow: { id: 'ad-tvc', variant: 'canonical', profileRevision: '1.0' },
        scope: { deliverables: ['commercial-video'], targetNodeIds: ['node-1'] },
        sourceIds: [],
        decisions: [],
        stageOutline: [
          { id: 'stage-1', order: 0, name: 'Brief' },
          { id: 'stage-2', order: 1, name: 'Storyboard' },
        ],
        stages: [
          {
            id: 'stage-1',
            order: 0,
            name: 'Brief',
            revision: 1,
            goal: 'Clarify brief',
            dependsOn: [],
            status: 'succeeded',
            review: { beforeExecution: [], afterExecution: [] },
            executionLocks: {},
            workItems: [
              {
                id: 'w1',
                name: 'Doc',
                kind: 'document',
                inputRefs: [],
                requiredCapabilities: [],
                attempts: 1,
                status: 'succeeded',
                payload: {},
                supersededOutputs: [],
              },
            ],
            currentOutputs: [],
            supersededOutputs: [],
          },
        ],
        status: 'active',
        createdAt: 1000,
        updatedAt: 2000,
      });

      expect(planView.planId).toBe('plan-001');
      expect(planView.totalStages).toBe(2);
      expect(planView.completedStages).toBe(1);
      expect(planView.progressPercent).toBe(50);
      expect(planView.stages[0].status).toBe('succeeded');
      expect(planView.stages[1].status).toBe('outline');
      expect(planView.canPause).toBe(true);
    });

    it('projects locate targets from plan outputs and items', async () => {
      const { projectPlanLocateTargets } = await import('./agentFeedProjection');
      const targets = projectPlanLocateTargets({
        schemaVersion: 1,
        id: 'plan-001',
        projectId: 'proj-1',
        revision: 1,
        workflow: { id: 'mv', variant: 'canonical', profileRevision: '1.0' },
        scope: { deliverables: ['music-video'], targetNodeIds: ['node-brief'] },
        sourceIds: [],
        decisions: [],
        stageOutline: [{ id: 's1', order: 0, name: 'Render' }],
        stages: [
          {
            id: 's1',
            order: 0,
            name: 'Render',
            revision: 1,
            goal: '',
            dependsOn: [],
            status: 'succeeded',
            review: { beforeExecution: [], afterExecution: [] },
            executionLocks: {},
            workItems: [
              {
                id: 'w1',
                name: 'Item',
                kind: 'video',
                inputRefs: [],
                requiredCapabilities: [],
                attempts: 1,
                status: 'succeeded',
                payload: {},
                currentOutput: {
                  outputId: 'out-1',
                  nodeId: 'node-result-1',
                  assetId: 'asset-video-1',
                  version: 1,
                  verified: true,
                  sourceWorkItemId: 'w1',
                  createdAt: 1000,
                },
                supersededOutputs: [],
              },
            ],
            currentOutputs: [],
            supersededOutputs: [],
          },
        ],
        status: 'active',
        createdAt: 1000,
        updatedAt: 1000,
      });

      expect(targets.targetNodeIds).toContain('node-brief');
      expect(targets.outputNodeIds).toContain('node-result-1');
      expect(targets.assetIds).toContain('asset-video-1');
    });

    it('projects route badges distinguishing direct tasks vs workflow plans', async () => {
      const { projectTaskRouteBadge } = await import('./agentFeedProjection');

      const direct = projectTaskRouteBadge({
        version: 1,
        kind: 'direct',
        requestedDeliverables: ['image'],
        scope: { targetNodeIds: [] },
        requiredCapabilities: ['generation:image'],
        sourceIds: [],
        missingFacts: [],
        evidence: [],
      });
      expect(direct.isDirect).toBe(true);
      expect(direct.showPlanPanel).toBe(false);
      expect(direct.badgeLabel).toBe('直接任务');

      const workflow = projectTaskRouteBadge({
        version: 1,
        kind: 'workflow',
        workflow: 'ad-tvc',
        requestedDeliverables: ['commercial-video'],
        scope: { targetNodeIds: [] },
        requiredCapabilities: [],
        sourceIds: [],
        missingFacts: [],
        evidence: [],
      });
      expect(workflow.isDirect).toBe(false);
      expect(workflow.showPlanPanel).toBe(true);
      expect(workflow.badgeLabel).toBe('制作计划');
    });
  });
});
