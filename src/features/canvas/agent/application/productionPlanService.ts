import {
  productionPlanRepository,
  OptimisticLockError,
} from '../infrastructure/productionPlanRepository';
import {
  type DecisionRecordV1,
  type PlanStatus,
  type ProductionPlanV1,
  type ProductionStageV1,
  type ReviewCheckStatus,
  type StageOutlineItem,
  type StageStatus,
  type WorkItemStatus,
  propagateStaleStages,
} from '../domain/productionPlan';

export interface CreatePlanInput {
  projectId: string;
  requestId?: string;
  workflow: {
    id: string;
    variant?: string;
    profileRevision?: string;
  };
  scope: {
    deliverables: string[];
    targetEpisodeScope?: string;
    targetNodeIds?: string[];
  };
  sourceIds?: string[];
  decisions?: DecisionRecordV1[];
  stageOutline: StageOutlineItem[];
  initialStage?: ProductionStageV1;
}

export interface AuthorStageInput {
  projectId: string;
  planId: string;
  expectedRevision: number;
  stage: ProductionStageV1;
  changeReason?: string;
}

export interface ReplanInput {
  projectId: string;
  planId: string;
  expectedRevision: number;
  updatedOutline?: StageOutlineItem[];
  changeReason: string;
}

export interface RecordReviewInput {
  projectId: string;
  planId: string;
  expectedRevision: number;
  stageId: string;
  reviewId: string;
  status: ReviewCheckStatus;
  reason?: string;
}

export interface RetryItemsInput {
  projectId: string;
  planId: string;
  expectedRevision: number;
  stageId: string;
  itemIds: string[];
}

export class ProductionPlanService {
  private requestCache = new Map<string, ProductionPlanV1>();

  createPlan(input: CreatePlanInput): ProductionPlanV1 {
    if (input.requestId && this.requestCache.has(input.requestId)) {
      return this.requestCache.get(input.requestId)!;
    }

    const now = Date.now();
    const planId = `plan-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

    const plan: ProductionPlanV1 = {
      schemaVersion: 1,
      id: planId,
      projectId: input.projectId,
      revision: 1,
      workflow: {
        id: input.workflow.id,
        variant: input.workflow.variant ?? 'canonical',
        profileRevision: input.workflow.profileRevision ?? '1.0',
      },
      scope: {
        deliverables: input.scope.deliverables,
        targetEpisodeScope: input.scope.targetEpisodeScope,
        targetNodeIds: input.scope.targetNodeIds ?? [],
      },
      sourceIds: input.sourceIds ?? [],
      decisions: input.decisions ?? [],
      stageOutline: input.stageOutline,
      stages: input.initialStage ? [input.initialStage] : [],
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };

    const saved = productionPlanRepository.savePlan(plan);
    if (input.requestId) {
      this.requestCache.set(input.requestId, saved);
    }
    return saved;
  }

  getPlan(projectId: string, planId: string): ProductionPlanV1 | undefined {
    return productionPlanRepository.getPlan(projectId, planId);
  }

  getActivePlan(projectId: string): ProductionPlanV1 | undefined {
    return productionPlanRepository.getActivePlan(projectId);
  }

  listPlans(projectId: string): ProductionPlanV1[] {
    return productionPlanRepository.listPlans(projectId);
  }

  authorStage(input: AuthorStageInput): ProductionPlanV1 {
    const plan = productionPlanRepository.getPlan(input.projectId, input.planId);
    if (!plan) {
      throw new Error(`未找到制作计划：${input.planId}`);
    }

    if (plan.revision !== input.expectedRevision) {
      throw new OptimisticLockError(input.expectedRevision, plan.revision);
    }

    // Check if modifying an existing stage requires propagating stale to downstream
    let updatedStages = plan.stages;
    const existingIndex = plan.stages.findIndex((s) => s.id === input.stage.id);
    if (existingIndex >= 0) {
      // Stage already existed, re-authoring: propagate stale
      updatedStages = propagateStaleStages(plan.stages, input.stage.id);
      const stageIdx = updatedStages.findIndex((s) => s.id === input.stage.id);
      updatedStages[stageIdx] = input.stage;
    } else {
      updatedStages = [...plan.stages, input.stage];
    }

    const updatedPlan: ProductionPlanV1 = {
      ...plan,
      revision: plan.revision + 1,
      stages: updatedStages,
      updatedAt: Date.now(),
    };

    return productionPlanRepository.savePlan(updatedPlan);
  }

  replan(input: ReplanInput): ProductionPlanV1 {
    const plan = productionPlanRepository.getPlan(input.projectId, input.planId);
    if (!plan) {
      throw new Error(`未找到制作计划：${input.planId}`);
    }

    if (plan.revision !== input.expectedRevision) {
      throw new OptimisticLockError(input.expectedRevision, plan.revision);
    }

    const updatedPlan: ProductionPlanV1 = {
      ...plan,
      revision: plan.revision + 1,
      stageOutline: input.updatedOutline ?? plan.stageOutline,
      decisions: [
        ...plan.decisions,
        {
          key: `replan:${Date.now()}`,
          value: input.changeReason,
          source: 'user',
          scope: 'plan',
          timestamp: Date.now(),
        },
      ],
      updatedAt: Date.now(),
    };

    return productionPlanRepository.savePlan(updatedPlan);
  }

  recordReview(input: RecordReviewInput): ProductionPlanV1 {
    return productionPlanRepository.recordStageReview(input);
  }

  retryItems(input: RetryItemsInput): ProductionPlanV1 {
    const plan = productionPlanRepository.getPlan(input.projectId, input.planId);
    if (!plan) {
      throw new Error(`未找到制作计划：${input.planId}`);
    }

    if (plan.revision !== input.expectedRevision) {
      throw new OptimisticLockError(input.expectedRevision, plan.revision);
    }

    const stage = plan.stages.find((s) => s.id === input.stageId);
    if (!stage) {
      throw new Error(`未找到阶段：${input.stageId}`);
    }

    const retrySet = new Set(input.itemIds);
    const updatedItems = stage.workItems.map((item) => {
      if (retrySet.has(item.id)) {
        // Reset status to pending for retry, preserving previous outputs in supersededOutputs
        const supersededOutputs = item.currentOutput
          ? [...item.supersededOutputs, item.currentOutput]
          : item.supersededOutputs;
        return {
          ...item,
          status: 'pending' as WorkItemStatus,
          error: undefined,
          supersededOutputs,
        };
      }
      return item;
    });

    const updatedStages = plan.stages.map((s) => {
      if (s.id !== input.stageId) return s;
      return {
        ...s,
        workItems: updatedItems,
        status: 'ready' as StageStatus,
        revision: s.revision + 1,
      };
    });

    const updatedPlan: ProductionPlanV1 = {
      ...plan,
      revision: plan.revision + 1,
      stages: updatedStages,
      updatedAt: Date.now(),
    };

    return productionPlanRepository.savePlan(updatedPlan);
  }

  setPlanStatus(input: {
    projectId: string;
    planId: string;
    expectedRevision: number;
    status: PlanStatus;
  }): ProductionPlanV1 {
    const plan = productionPlanRepository.getPlan(input.projectId, input.planId);
    if (!plan) {
      throw new Error(`未找到制作计划：${input.planId}`);
    }

    if (plan.revision !== input.expectedRevision) {
      throw new OptimisticLockError(input.expectedRevision, plan.revision);
    }

    const updatedPlan: ProductionPlanV1 = {
      ...plan,
      revision: plan.revision + 1,
      status: input.status,
      updatedAt: Date.now(),
    };

    return productionPlanRepository.savePlan(updatedPlan);
  }
}

export const productionPlanService = new ProductionPlanService();
