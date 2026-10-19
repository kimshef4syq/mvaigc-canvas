import { z } from 'zod';

export const decisionRecordSchema = z.object({
  key: z.string().min(1),
  value: z.unknown(),
  source: z.enum(['user', 'default', 'workflow']),
  scope: z.string().default('global'),
  timestamp: z.number().int().positive(),
  supersedesKey: z.string().optional(),
});

export type DecisionRecordV1 = z.infer<typeof decisionRecordSchema>;

export const reviewCheckStatusSchema = z.enum([
  'pending',
  'passed',
  'rejected',
  'waived',
]);

export type ReviewCheckStatus = z.infer<typeof reviewCheckStatusSchema>;

export const reviewCheckSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  status: reviewCheckStatusSchema.default('pending'),
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  decidedAt: z.number().int().positive().optional(),
  reason: z.string().optional(),
});

export type ReviewCheckV1 = z.infer<typeof reviewCheckSchema>;

export const outputReferenceSchema = z.object({
  outputId: z.string().min(1),
  assetId: z.string().optional(),
  nodeId: z.string().optional(),
  receiptId: z.string().optional(),
  version: z.number().int().positive().default(1),
  verified: z.boolean().default(false),
  sourceWorkItemId: z.string().min(1),
  createdAt: z.number().int().positive().default(() => Date.now()),
});

export type OutputReferenceV1 = z.infer<typeof outputReferenceSchema>;

export const executionLocksSchema = z.object({
  modelRef: z.string().optional(),
  aspectRatio: z.string().optional(),
  resolution: z.string().optional(),
  durationRange: z.tuple([z.number(), z.number()]).optional(),
  soundPolicy: z.record(z.unknown()).optional(),
  promptHash: z.string().optional(),
  inputVersion: z.number().int().positive().optional(),
  concurrencyLimit: z.number().int().positive().optional(),
});

export type ExecutionLocksV1 = z.infer<typeof executionLocksSchema>;

export const workItemKindSchema = z.enum([
  'document',
  'image',
  'video',
  'speech',
  'music',
  'postprocess',
  'comfyui',
]);

export type WorkItemKind = z.infer<typeof workItemKindSchema>;

export const workItemStatusSchema = z.enum([
  'pending',
  'running',
  'succeeded',
  'failed',
  'recoverable',
  'skipped',
]);

export type WorkItemStatus = z.infer<typeof workItemStatusSchema>;

export const productionWorkItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: workItemKindSchema,
  inputRefs: z.array(z.string()).default([]),
  requiredCapabilities: z.array(z.string()).default([]),
  attempts: z.number().int().nonnegative().default(0),
  status: workItemStatusSchema.default('pending'),
  payload: z.record(z.unknown()).default({}),
  currentOutput: outputReferenceSchema.optional(),
  supersededOutputs: z.array(outputReferenceSchema).default([]),
  executionFingerprint: z.string().optional(),
  error: z.string().optional(),
});

export type ProductionWorkItemV1 = z.infer<typeof productionWorkItemSchema>;

export const stageStatusSchema = z.enum([
  'draft',
  'ready',
  'running',
  'waiting-user',
  'succeeded',
  'failed',
  'recoverable',
  'stale',
  'skipped',
  'cancelled',
]);

export type StageStatus = z.infer<typeof stageStatusSchema>;

export const productionStageSchema = z.object({
  id: z.string().min(1),
  order: z.number().int().nonnegative(),
  name: z.string().min(1),
  revision: z.number().int().positive().default(1),
  goal: z.string().default(''),
  dependsOn: z.array(z.string()).default([]),
  status: stageStatusSchema.default('draft'),
  review: z.object({
    beforeExecution: z.array(reviewCheckSchema).default([]),
    afterExecution: z.array(reviewCheckSchema).default([]),
  }).default({ beforeExecution: [], afterExecution: [] }),
  executionLocks: executionLocksSchema.default({}),
  workItems: z.array(productionWorkItemSchema).default([]),
  currentOutputs: z.array(outputReferenceSchema).default([]),
  supersededOutputs: z.array(outputReferenceSchema).default([]),
});

export type ProductionStageV1 = z.infer<typeof productionStageSchema>;

export const planStatusSchema = z.enum([
  'active',
  'waiting-user',
  'paused',
  'completed',
  'cancelled',
  'blocked',
]);

export type PlanStatus = z.infer<typeof planStatusSchema>;

export const stageOutlineItemSchema = z.object({
  id: z.string().min(1),
  order: z.number().int().nonnegative(),
  name: z.string().min(1),
  condition: z.string().optional(),
});

export type StageOutlineItem = z.infer<typeof stageOutlineItemSchema>;

export const productionPlanSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  id: z.string().min(1),
  projectId: z.string().min(1),
  revision: z.number().int().positive().default(1),
  workflow: z.object({
    id: z.string().min(1),
    variant: z.string().default('canonical'),
    profileRevision: z.string().default('1.0'),
  }),
  scope: z.object({
    deliverables: z.array(z.string()).min(1),
    targetEpisodeScope: z.string().optional(),
    targetNodeIds: z.array(z.string()).default([]),
  }),
  sourceIds: z.array(z.string()).default([]),
  decisions: z.array(decisionRecordSchema).default([]),
  stageOutline: z.array(stageOutlineItemSchema).min(1),
  stages: z.array(productionStageSchema).default([]),
  status: planStatusSchema.default('active'),
  createdAt: z.number().int().positive(),
  updatedAt: z.number().int().positive(),
});

export type ProductionPlanV1 = z.infer<typeof productionPlanSchema>;

const VALID_STAGE_TRANSITIONS: Record<StageStatus, StageStatus[]> = {
  draft: ['ready', 'stale', 'cancelled', 'skipped'],
  ready: ['running', 'waiting-user', 'draft', 'stale', 'cancelled', 'skipped'],
  'waiting-user': ['ready', 'running', 'draft', 'cancelled', 'skipped'],
  running: ['succeeded', 'failed', 'recoverable', 'waiting-user', 'cancelled'],
  succeeded: ['stale'],
  failed: ['running', 'ready', 'recoverable', 'cancelled'],
  recoverable: ['running', 'ready', 'failed', 'cancelled'],
  stale: ['draft', 'ready', 'cancelled'],
  skipped: ['ready', 'draft'],
  cancelled: [],
};

export function canTransitionStage(from: StageStatus, to: StageStatus): boolean {
  if (from === to) return true;
  return VALID_STAGE_TRANSITIONS[from]?.includes(to) ?? false;
}

export function propagateStaleStages(
  stages: ProductionStageV1[],
  modifiedStageId: string
): ProductionStageV1[] {
  const staleStageIds = new Set<string>();

  function markDownstream(stageId: string) {
    for (const stage of stages) {
      if (stage.dependsOn.includes(stageId) && !staleStageIds.has(stage.id)) {
        staleStageIds.add(stage.id);
        markDownstream(stage.id);
      }
    }
  }

  markDownstream(modifiedStageId);

  return stages.map((stage) => {
    if (stage.id === modifiedStageId) {
      return {
        ...stage,
        revision: stage.revision + 1,
        status: 'draft' as StageStatus,
      };
    }
    if (staleStageIds.has(stage.id)) {
      return {
        ...stage,
        revision: stage.revision + 1,
        status: (stage.status === 'succeeded' ? 'stale' : stage.status) as StageStatus,
      };
    }
    return stage;
  });
}

export function calculatePlanProgress(plan: ProductionPlanV1): {
  completedStages: number;
  totalStages: number;
  percent: number;
} {
  const totalStages = plan.stageOutline.length;
  if (totalStages === 0) return { completedStages: 0, totalStages: 0, percent: 100 };

  const succeededCount = plan.stages.filter(
    (s) => s.status === 'succeeded' || s.status === 'skipped'
  ).length;

  return {
    completedStages: succeededCount,
    totalStages,
    percent: Math.round((succeededCount / totalStages) * 100),
  };
}
