import {
  productionPlanSchema,
  canTransitionStage,
  type OutputReferenceV1,
  type ProductionPlanV1,
  type ProductionStageV1,
  type ReviewCheckStatus,
  type StageStatus,
  type WorkItemStatus,
} from '../domain/productionPlan';

export class OptimisticLockError extends Error {
  constructor(expected: number, actual: number) {
    super(`制作计划版本冲突：期望 revision ${expected}，实际为 ${actual}，请重新读取计划后再操作。`);
    this.name = 'OptimisticLockError';
  }
}

class ProductionPlanRepository {
  private plans = new Map<string, ProductionPlanV1>();

  private makeKey(projectId: string, planId: string): string {
    return `${projectId}:${planId}`;
  }

  savePlan(plan: ProductionPlanV1): ProductionPlanV1 {
    const validated = productionPlanSchema.parse(plan);
    const key = this.makeKey(validated.projectId, validated.id);
    this.plans.set(key, validated);
    return validated;
  }

  getPlan(projectId: string, planId: string): ProductionPlanV1 | undefined {
    return this.plans.get(this.makeKey(projectId, planId));
  }

  getActivePlan(projectId: string): ProductionPlanV1 | undefined {
    for (const plan of this.plans.values()) {
      if (plan.projectId === projectId && (plan.status === 'active' || plan.status === 'waiting-user')) {
        return plan;
      }
    }
    return undefined;
  }

  listPlans(projectId: string): ProductionPlanV1[] {
    const results: ProductionPlanV1[] = [];
    for (const plan of this.plans.values()) {
      if (plan.projectId === projectId) {
        results.push(plan);
      }
    }
    return results.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  authorStage(input: {
    projectId: string;
    planId: string;
    expectedRevision: number;
    stage: ProductionStageV1;
  }): ProductionPlanV1 {
    const plan = this.getPlan(input.projectId, input.planId);
    if (!plan) {
      throw new Error(`未找到项目 ${input.projectId} 下的制作计划 ${input.planId}`);
    }

    if (plan.revision !== input.expectedRevision) {
      throw new OptimisticLockError(input.expectedRevision, plan.revision);
    }

    const existingStageIndex = plan.stages.findIndex((s) => s.id === input.stage.id);
    const updatedStages = [...plan.stages];
    if (existingStageIndex >= 0) {
      updatedStages[existingStageIndex] = input.stage;
    } else {
      updatedStages.push(input.stage);
    }

    const updatedPlan: ProductionPlanV1 = {
      ...plan,
      revision: plan.revision + 1,
      stages: updatedStages,
      updatedAt: Date.now(),
    };

    return this.savePlan(updatedPlan);
  }

  updateStageStatus(input: {
    projectId: string;
    planId: string;
    expectedRevision: number;
    stageId: string;
    status: StageStatus;
  }): ProductionPlanV1 {
    const plan = this.getPlan(input.projectId, input.planId);
    if (!plan) {
      throw new Error(`未找到项目 ${input.projectId} 下的制作计划 ${input.planId}`);
    }

    if (plan.revision !== input.expectedRevision) {
      throw new OptimisticLockError(input.expectedRevision, plan.revision);
    }

    const stage = plan.stages.find((s) => s.id === input.stageId);
    if (!stage) {
      throw new Error(`制作计划 ${input.planId} 中未找到阶段 ${input.stageId}`);
    }

    if (!canTransitionStage(stage.status, input.status)) {
      throw new Error(`阶段 ${input.stageId} 状态无法从 ${stage.status} 流转到 ${input.status}`);
    }

    const updatedStages = plan.stages.map((s) => {
      if (s.id !== input.stageId) return s;
      return {
        ...s,
        status: input.status,
        revision: s.revision + 1,
      };
    });

    const updatedPlan: ProductionPlanV1 = {
      ...plan,
      revision: plan.revision + 1,
      stages: updatedStages,
      updatedAt: Date.now(),
    };

    return this.savePlan(updatedPlan);
  }

  updateWorkItemStatus(input: {
    projectId: string;
    planId: string;
    expectedRevision: number;
    stageId: string;
    itemId: string;
    status: WorkItemStatus;
    output?: OutputReferenceV1;
    error?: string;
  }): ProductionPlanV1 {
    const plan = this.getPlan(input.projectId, input.planId);
    if (!plan) {
      throw new Error(`未找到项目 ${input.projectId} 下的制作计划 ${input.planId}`);
    }

    if (plan.revision !== input.expectedRevision) {
      throw new OptimisticLockError(input.expectedRevision, plan.revision);
    }

    const stage = plan.stages.find((s) => s.id === input.stageId);
    if (!stage) {
      throw new Error(`制作计划 ${input.planId} 中未找到阶段 ${input.stageId}`);
    }

    const item = stage.workItems.find((w) => w.id === input.itemId);
    if (!item) {
      throw new Error(`阶段 ${input.stageId} 中未找到工作项 ${input.itemId}`);
    }

    const updatedItems = stage.workItems.map((w) => {
      if (w.id !== input.itemId) return w;
      const supersededOutputs = input.output && w.currentOutput
        ? [...w.supersededOutputs, w.currentOutput]
        : w.supersededOutputs;

      return {
        ...w,
        status: input.status,
        currentOutput: input.output ?? w.currentOutput,
        supersededOutputs,
        error: input.error,
        attempts: input.status === 'running' ? w.attempts + 1 : w.attempts,
      };
    });

    const updatedStages = plan.stages.map((s) => {
      if (s.id !== input.stageId) return s;
      const stageOutputs = input.output
        ? [...s.currentOutputs.filter((o) => o.sourceWorkItemId !== input.itemId), input.output]
        : s.currentOutputs;
      return {
        ...s,
        workItems: updatedItems,
        currentOutputs: stageOutputs,
        revision: s.revision + 1,
      };
    });

    const updatedPlan: ProductionPlanV1 = {
      ...plan,
      revision: plan.revision + 1,
      stages: updatedStages,
      updatedAt: Date.now(),
    };

    return this.savePlan(updatedPlan);
  }

  recordStageReview(input: {
    projectId: string;
    planId: string;
    expectedRevision: number;
    stageId: string;
    reviewId: string;
    status: ReviewCheckStatus;
    reason?: string;
  }): ProductionPlanV1 {
    const plan = this.getPlan(input.projectId, input.planId);
    if (!plan) {
      throw new Error(`未找到项目 ${input.projectId} 下的制作计划 ${input.planId}`);
    }

    if (plan.revision !== input.expectedRevision) {
      throw new OptimisticLockError(input.expectedRevision, plan.revision);
    }

    const stage = plan.stages.find((s) => s.id === input.stageId);
    if (!stage) {
      throw new Error(`制作计划 ${input.planId} 中未找到阶段 ${input.stageId}`);
    }

    let found = false;
    const updateCheck = (c: any) => {
      if (c.id === input.reviewId) {
        found = true;
        return {
          ...c,
          status: input.status,
          decidedAt: Date.now(),
          reason: input.reason,
        };
      }
      return c;
    };

    const beforeExecution = stage.review.beforeExecution.map(updateCheck);
    const afterExecution = stage.review.afterExecution.map(updateCheck);

    if (!found) {
      throw new Error(`阶段 ${input.stageId} 中未找到审核项 ${input.reviewId}`);
    }

    const updatedStages = plan.stages.map((s) => {
      if (s.id !== input.stageId) return s;
      return {
        ...s,
        review: { beforeExecution, afterExecution },
        revision: s.revision + 1,
      };
    });

    const updatedPlan: ProductionPlanV1 = {
      ...plan,
      revision: plan.revision + 1,
      stages: updatedStages,
      updatedAt: Date.now(),
    };

    return this.savePlan(updatedPlan);
  }

  deletePlan(projectId: string, planId: string): boolean {
    return this.plans.delete(this.makeKey(projectId, planId));
  }

  clearAll(): void {
    this.plans.clear();
  }
}

export const productionPlanRepository = new ProductionPlanRepository();
