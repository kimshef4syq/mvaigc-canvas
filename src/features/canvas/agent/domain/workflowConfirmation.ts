import type { ProductionPlanV1, ProductionStageV1, ReviewCheckV1 } from './productionPlan';

export const STAGED_VIDEO_WORKFLOWS = new Set(['mv', 'ad-tvc', 'drama-series', 'koc-video', 'general-video']);
export const STAGED_CONFIRMATION_POLICY = 'staged-v1' as const;
const UNAUTHORED_CONTENT_HASH = `sha256:${'0'.repeat(64)}`;

function contract(stage: ProductionStageV1): string {
  return JSON.stringify({ name: stage.name, goal: stage.goal, dependsOn: stage.dependsOn,
    executionLocks: stage.executionLocks,
    workItems: stage.workItems.map(({ id, name, kind, inputRefs, payload }) => ({ id, name, kind, inputRefs, payload })),
  });
}

function results(stage: ProductionStageV1): string {
  return JSON.stringify({ outputs: stage.currentOutputs, items: stage.workItems.map((item) => ({
    id: item.id, status: item.status, attempts: item.attempts, output: item.currentOutput,
  })) });
}

/** Host-owned gates cannot be deleted or marked passed by planner-authored JSON. */
export function enforceWorkflowConfirmations(
  plan: ProductionPlanV1,
  previous?: ProductionPlanV1,
  userReview?: { stageId: string; reviewId: string },
): ProductionPlanV1 {
  if (plan.workflow.confirmationPolicy !== STAGED_CONFIRMATION_POLICY) return plan;
  return { ...plan, stages: plan.stages.map((stage) => {
    const prior = previous?.stages.find((item) => item.id === stage.id);
    const unchanged = prior && stage.status !== 'stale' && contract(prior) === contract(stage);
    const video = stage.workItems.some((item) => item.kind === 'video');
    const before = video || /^(?:visual-gen|production)$/.test(stage.id);
    const after = stage.id !== 'post' || stage.workItems.some((item) => ['document', 'image', 'video', 'speech', 'music'].includes(item.kind));
    const gate = (phase: 'beforeExecution' | 'afterExecution'): ReviewCheckV1 => {
      const id = `user:${stage.id}:${phase}`;
      const submitted = stage.review[phase].find((item) => item.id === id);
      const sameContent = unchanged && (phase === 'beforeExecution' || results(prior) === results(stage));
      const accepted = sameContent ? prior?.review[phase].find((item) => item.id === id) : undefined;
      const trusted = userReview?.stageId === stage.id && userReview.reviewId === id ? submitted : accepted;
      return { id, label: phase === 'beforeExecution'
        ? `请确认${stage.name}的最终提示词、参考素材、时长和生成范围`
        : `请确认${stage.name}的实际内容及素材来源，再进入下一阶段`,
      contentHash: trusted?.contentHash ?? submitted?.contentHash ?? UNAUTHORED_CONTENT_HASH,
      status: trusted?.confirmedByUser ? trusted.status : 'pending',
      requiresUserConfirmation: true, confirmedByUser: trusted?.confirmedByUser === true,
      ...(trusted?.decidedAt ? { decidedAt: trusted.decidedAt } : {}),
      ...(trusted?.reason ? { reason: trusted.reason } : {}),
      };
    };
    const reviewedStage = { ...stage, review: {
      beforeExecution: before ? [gate('beforeExecution')] : [],
      afterExecution: after ? [gate('afterExecution')] : [],
    } };
    if ((reviewedStage.status === 'succeeded' && !stageReviewsAccepted(reviewedStage, 'afterExecution'))
        || (reviewedStage.status === 'running' && !stageReviewsAccepted(reviewedStage, 'beforeExecution'))) {
      reviewedStage.status = 'waiting-user';
    }
    return reviewedStage;
  }) };
}

export function stageReviewsAccepted(stage: ProductionStageV1, phase: 'beforeExecution' | 'afterExecution'): boolean {
  return stage.review[phase].every((check) => check.status === 'passed' && check.confirmedByUser === true);
}

export function assertStageCanStart(plan: ProductionPlanV1, stage: ProductionStageV1): void {
  if (plan.workflow.confirmationPolicy !== STAGED_CONFIRMATION_POLICY) return;
  assertPreviousStagesAccepted(plan, stage);
  if (!stageReviewsAccepted(stage, 'beforeExecution')) {
    throw new Error(`“${stage.name}”尚未获得用户生成前确认。自动模式也必须等待此确认。`);
  }
}

export function assertPreviousStagesAccepted(plan: ProductionPlanV1, stage: ProductionStageV1): void {
  if (plan.workflow.confirmationPolicy !== STAGED_CONFIRMATION_POLICY) return;
  const predecessors = plan.stageOutline.filter((item) => item.order < stage.order);
  for (const item of predecessors) {
    const upstream = plan.stages.find((candidate) => candidate.id === item.id);
    if (upstream?.status === 'skipped' && item.condition) continue;
    if (!upstream || upstream.status !== 'succeeded' || !stageReviewsAccepted(upstream, 'afterExecution')) {
      throw new Error(`请先完成并由用户确认“${item.name}”，不能提前执行“${stage.name}”。`);
    }
  }
}
