import {
  type ProductionPlanV1,
  type PlanStatus,
  calculatePlanProgress,
} from '../domain/productionPlan';
import { type TaskRouteV1 } from '../domain/taskRoute';

export function nodeIdsFromAgentOutput(output: unknown): string[] {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return [];
  const record = output as Record<string, unknown>;
  const nested = record.output && typeof record.output === 'object' && !Array.isArray(record.output)
    ? record.output as Record<string, unknown>
    : record;
  const references = nested.references
    && typeof nested.references === 'object'
    && !Array.isArray(nested.references)
    ? nested.references as Record<string, unknown>
    : undefined;
  if (!references) return [];
  const ids = [
    ...(Array.isArray(references.nodeIds) ? references.nodeIds : []),
    ...(typeof references.nodeId === 'string' ? [references.nodeId] : []),
  ];
  return Array.from(new Set(ids.filter(
    (id): id is string => typeof id === 'string' && id.trim().length > 0,
  )));
}

export function generationLocateTargetsFromAgentOutput(output: unknown): {
  inputNodeIds: string[];
  resultNodeIds: string[];
} {
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    return { inputNodeIds: [], resultNodeIds: [] };
  }
  const record = output as Record<string, unknown>;
  const followThrough = record.followThrough
    && typeof record.followThrough === 'object'
    && !Array.isArray(record.followThrough)
    ? record.followThrough as Record<string, unknown>
    : undefined;
  const inputNodeIds = Array.isArray(followThrough?.inputNodeIds)
    ? followThrough.inputNodeIds
    : [];
  const resultNodeIds = Array.isArray(followThrough?.resultNodeIds)
    ? followThrough.resultNodeIds
    : [];
  return {
    inputNodeIds: Array.from(new Set(inputNodeIds.filter(
      (nodeId): nodeId is string => typeof nodeId === 'string' && nodeId.trim().length > 0,
    ))),
    resultNodeIds: Array.from(new Set(resultNodeIds.filter(
      (nodeId): nodeId is string => typeof nodeId === 'string' && nodeId.trim().length > 0,
    ))),
  };
}

export interface AgentGenerationProgress {
  phase: 'accepted' | 'polling';
  attempt: number;
  maxAttempts: number;
  statuses: string[];
}

export function generationProgressFromAgentOutput(output: unknown): AgentGenerationProgress | null {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return null;
  const record = output as Record<string, unknown>;
  const followThrough = record.followThrough
    && typeof record.followThrough === 'object'
    && !Array.isArray(record.followThrough)
    ? record.followThrough as Record<string, unknown>
    : null;
  if (!followThrough) return null;
  if (followThrough.phase === 'accepted') {
    return { phase: 'accepted', attempt: 0, maxAttempts: 0, statuses: [] };
  }
  if (followThrough.phase !== 'generation-follow-through') return null;
  const attempt = typeof followThrough.attempt === 'number' && Number.isFinite(followThrough.attempt)
    ? Math.max(1, Math.floor(followThrough.attempt))
    : 1;
  const maxAttempts = typeof followThrough.maxAttempts === 'number' && Number.isFinite(followThrough.maxAttempts)
    ? Math.max(attempt, Math.floor(followThrough.maxAttempts))
    : attempt;
  const statuses = Array.isArray(followThrough.statuses)
    ? followThrough.statuses.filter((status): status is string => typeof status === 'string')
    : [];
  return { phase: 'polling', attempt, maxAttempts, statuses };
}

export function executionReceiptFromAgentOutput(
  output: unknown,
): { receiptId?: string; rollbackToken?: string } {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return {};
  const record = output as Record<string, unknown>;
  const nested = record.output && typeof record.output === 'object' && !Array.isArray(record.output)
    ? record.output as Record<string, unknown>
    : undefined;
  const execution = record.execution && typeof record.execution === 'object' && !Array.isArray(record.execution)
    ? record.execution as Record<string, unknown>
    : undefined;
  const nestedExecution = nested?.execution
    && typeof nested.execution === 'object'
    && !Array.isArray(nested.execution)
    ? nested.execution as Record<string, unknown>
    : undefined;
  const receiptId = [execution?.receiptId, nestedExecution?.receiptId, record.receiptId]
    .find((value): value is string => typeof value === 'string' && Boolean(value));
  const rollbackToken = [record.rollbackToken, nested?.rollbackToken]
    .find((value): value is string => typeof value === 'string' && Boolean(value));
  return {
    ...(receiptId ? { receiptId } : {}),
    ...(rollbackToken ? { rollbackToken } : {}),
  };
}

export interface ProductionStageSummaryView {
  id: string;
  order: number;
  name: string;
  status: string;
  goal: string;
  totalWorkItems: number;
  succeededWorkItems: number;
  failedWorkItems: number;
  reviewCount: number;
  pendingReviewCount: number;
}

export interface ProductionPlanView {
  planId: string;
  projectId: string;
  revision: number;
  workflowId: string;
  status: PlanStatus;
  progressPercent: number;
  completedStages: number;
  totalStages: number;
  deliverables: string[];
  stages: ProductionStageSummaryView[];
  activeStageId?: string;
  canContinue: boolean;
  canPause: boolean;
  canCancel: boolean;
}

export function projectProductionPlanView(plan: ProductionPlanV1): ProductionPlanView {
  const progress = calculatePlanProgress(plan);
  const stages: ProductionStageSummaryView[] = plan.stageOutline.map((outline) => {
    const authoredStage = plan.stages.find((s) => s.id === outline.id);
    if (!authoredStage) {
      return {
        id: outline.id,
        order: outline.order,
        name: outline.name,
        status: 'outline',
        goal: '',
        totalWorkItems: 0,
        succeededWorkItems: 0,
        failedWorkItems: 0,
        reviewCount: 0,
        pendingReviewCount: 0,
      };
    }
    const succeededCount = authoredStage.workItems.filter((w) => w.status === 'succeeded').length;
    const failedCount = authoredStage.workItems.filter((w) => w.status === 'failed').length;
    const allReviews = [...authoredStage.review.beforeExecution, ...authoredStage.review.afterExecution];
    const pendingReviews = allReviews.filter((r) => r.status === 'pending').length;

    return {
      id: authoredStage.id,
      order: authoredStage.order,
      name: authoredStage.name,
      status: authoredStage.status,
      goal: authoredStage.goal,
      totalWorkItems: authoredStage.workItems.length,
      succeededWorkItems: succeededCount,
      failedWorkItems: failedCount,
      reviewCount: allReviews.length,
      pendingReviewCount: pendingReviews,
    };
  });

  const activeStage = plan.stages.find(
    (s) => s.status === 'running' || s.status === 'ready' || s.status === 'waiting-user'
  );

  return {
    planId: plan.id,
    projectId: plan.projectId,
    revision: plan.revision,
    workflowId: plan.workflow.id,
    status: plan.status,
    progressPercent: progress.percent,
    completedStages: progress.completedStages,
    totalStages: progress.totalStages,
    deliverables: plan.scope.deliverables,
    stages,
    activeStageId: activeStage?.id,
    canContinue: plan.status === 'paused' || plan.status === 'waiting-user' || plan.status === 'active',
    canPause: plan.status === 'active',
    canCancel: plan.status === 'active' || plan.status === 'waiting-user' || plan.status === 'paused',
  };
}

export function projectPlanLocateTargets(plan: ProductionPlanV1, stageId?: string): {
  targetNodeIds: string[];
  outputNodeIds: string[];
  assetIds: string[];
} {
  const targetNodeIds = new Set(plan.scope.targetNodeIds);
  const outputNodeIds = new Set<string>();
  const assetIds = new Set<string>();

  const targetStages = stageId
    ? plan.stages.filter((s) => s.id === stageId)
    : plan.stages;

  for (const stage of targetStages) {
    for (const output of stage.currentOutputs) {
      if (output.nodeId) outputNodeIds.add(output.nodeId);
      if (output.assetId) assetIds.add(output.assetId);
    }
    for (const item of stage.workItems) {
      if (item.currentOutput?.nodeId) outputNodeIds.add(item.currentOutput.nodeId);
      if (item.currentOutput?.assetId) assetIds.add(item.currentOutput.assetId);
    }
  }

  return {
    targetNodeIds: Array.from(targetNodeIds),
    outputNodeIds: Array.from(outputNodeIds),
    assetIds: Array.from(assetIds),
  };
}

export function projectTaskRouteBadge(route: TaskRouteV1): {
  badgeLabel: string;
  isDirect: boolean;
  showPlanPanel: boolean;
  scopeSummary: string;
} {
  switch (route.kind) {
    case 'direct':
      return {
        badgeLabel: '直接任务',
        isDirect: true,
        showPlanPanel: false,
        scopeSummary: route.requestedDeliverables.join('、') || '单步执行',
      };
    case 'stage':
      return {
        badgeLabel: '独立阶段',
        isDirect: false,
        showPlanPanel: false,
        scopeSummary: route.stageIntent ?? route.requestedDeliverables.join('、') ?? '单阶段',
      };
    case 'workflow':
      return {
        badgeLabel: '制作计划',
        isDirect: false,
        showPlanPanel: true,
        scopeSummary: `${route.workflow ?? '全流程'} (${route.requestedDeliverables.join('、')})`,
      };
    case 'clarify':
      return {
        badgeLabel: '待澄清',
        isDirect: false,
        showPlanPanel: false,
        scopeSummary: route.missingFacts.map((f) => f.question).join('；'),
      };
  }
}

