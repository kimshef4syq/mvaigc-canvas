import { describe, expect, it } from 'vitest';
import {
  assertRoleActionAllowed,
  RolePermissionViolationError,
  plannerResponseSchema,
  executorResponseSchema,
} from './productionRoles';

describe('productionRoles permissions & boundaries', () => {
  describe('role permission enforcement', () => {
    it('blocks planner from executing generation.submit (paid generation)', () => {
      expect(() =>
        assertRoleActionAllowed('planner', 'canvas_command', 'generation.submit')
      ).toThrow(RolePermissionViolationError);

      expect(() =>
        assertRoleActionAllowed('planner', 'canvas_command', 'generation.submit')
      ).toThrow(/显式禁止的职责/);
    });

    it('allows planner to search profiles and write document nodes', () => {
      expect(() => assertRoleActionAllowed('planner', 'profile_search')).not.toThrow();
      expect(() => assertRoleActionAllowed('planner', 'profile_read')).not.toThrow();
      expect(() => assertRoleActionAllowed('planner', 'source_read')).not.toThrow();
      expect(() => assertRoleActionAllowed('planner', 'canvas_command', 'node.create')).not.toThrow();
    });

    it('blocks executor from rewriting plans or searching knowledge profiles', () => {
      expect(() => assertRoleActionAllowed('executor', 'profile_search')).toThrow(
        RolePermissionViolationError
      );
      expect(() =>
        assertRoleActionAllowed('executor', 'production_plan', 'authorStage')
      ).toThrow(RolePermissionViolationError);
    });

    it('allows executor to run canvas generation commands', () => {
      expect(() =>
        assertRoleActionAllowed('executor', 'canvas_command', 'generation.submit')
      ).not.toThrow();
      expect(() =>
        assertRoleActionAllowed('executor', 'canvas_command', 'generation.recover')
      ).not.toThrow();
    });

    it('blocks router from writing to canvas or plans', () => {
      expect(() => assertRoleActionAllowed('router', 'canvas_command')).toThrow(
        RolePermissionViolationError
      );
      expect(() => assertRoleActionAllowed('router', 'production_plan')).toThrow(
        RolePermissionViolationError
      );
      expect(() => assertRoleActionAllowed('router', 'source_inspect')).not.toThrow();
    });
  });

  describe('role response schema validation', () => {
    it('validates planner response with stage contract', () => {
      const response = plannerResponseSchema.parse({
        stage: {
          id: 'stage-brief',
          order: 0,
          name: 'Brief 策划阶段',
          revision: 1,
          goal: '明确产品卖点与调性',
          dependsOn: [],
          status: 'ready',
          review: { beforeExecution: [], afterExecution: [] },
          executionLocks: {},
          workItems: [
            {
              id: 'item-doc-1',
              name: 'Brief Document',
              kind: 'document',
              inputRefs: [],
              requiredCapabilities: [],
              attempts: 0,
              status: 'succeeded',
              payload: { text: 'Coffee brief' },
              supersededOutputs: [],
            },
          ],
          currentOutputs: [],
          supersededOutputs: [],
        },
        changeReason: '初始化首阶段',
      });
      expect(response.stage.id).toBe('stage-brief');
      expect(response.stage.workItems).toHaveLength(1);
    });

    it('validates executor response with item receipts and stage status', () => {
      const response = executorResponseSchema.parse({
        stageId: 'stage-shots',
        stageStatus: 'succeeded',
        itemResults: [
          {
            itemId: 'item-shot-1',
            status: 'succeeded',
            output: {
              outputId: 'out-1',
              assetId: 'asset-video-1',
              version: 1,
              verified: true,
              sourceWorkItemId: 'item-shot-1',
              createdAt: Date.now(),
            },
            receiptId: 'rcpt-123',
          },
        ],
      });
      expect(response.stageStatus).toBe('succeeded');
      expect(response.itemResults[0].output?.assetId).toBe('asset-video-1');
    });
  });
});
