import {
  productionPlanRepository,
  OptimisticLockError,
} from '../infrastructure/productionPlanRepository';
import {
  type OutputReferenceV1,
  type ProductionPlanV1,
  type ProductionWorkItemV1,
  type StageStatus,
} from '../domain/productionPlan';
import { computeSha256 } from '../infrastructure/sourceRepository';
import { assertStageCanStart, stageReviewsAccepted, STAGED_CONFIRMATION_POLICY } from '../domain/workflowConfirmation';

export interface StageExecutionLease {
  leaseId: string;
  projectId: string;
  planId: string;
  stageId: string;
  ownerRunId: string;
  acquiredAt: number;
  expiresAt: number;
}

export interface ExecutionReceiptRecord {
  receiptId: string;
  fingerprint: string;
  projectId: string;
  planId: string;
  stageId: string;
  itemId: string;
  status: 'succeeded' | 'failed' | 'recoverable';
  output?: OutputReferenceV1;
  error?: string;
  createdAt: number;
}

export interface ExecuteStageOptions {
  projectId: string;
  planId: string;
  stageId: string;
  expectedRevision: number;
  runId: string;
  concurrency?: number;
  signal?: AbortSignal;
  executeItem?: (
    item: ProductionWorkItemV1,
    signal?: AbortSignal
  ) => Promise<{ output: OutputReferenceV1; receiptId?: string }>;
}

export interface StageExecutionResult {
  planId: string;
  stageId: string;
  finalStageStatus: StageStatus;
  completedItems: number;
  failedItems: number;
  reusedReceipts: number;
  resumedPlan: ProductionPlanV1;
}

export class ProductionCoordinator {
  private activeLeases = new Map<string, StageExecutionLease>();
  private receipts = new Map<string, ExecutionReceiptRecord>();

  private leaseKey(projectId: string, planId: string, stageId: string): string {
    return `${projectId}:${planId}:${stageId}`;
  }

  acquireLease(
    projectId: string,
    planId: string,
    stageId: string,
    ownerRunId: string,
    ttlMs = 120_000
  ): StageExecutionLease {
    const key = this.leaseKey(projectId, planId, stageId);
    const existing = this.activeLeases.get(key);
    const now = Date.now();

    if (existing && existing.expiresAt > now && existing.ownerRunId !== ownerRunId) {
      throw new Error(`阶段 ${stageId} 当前正由另一个运行 ${existing.ownerRunId} 独占执行中，请稍候再试。`);
    }

    const lease: StageExecutionLease = {
      leaseId: `lease-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      projectId,
      planId,
      stageId,
      ownerRunId,
      acquiredAt: now,
      expiresAt: now + ttlMs,
    };
    this.activeLeases.set(key, lease);
    return lease;
  }

  releaseLease(projectId: string, planId: string, stageId: string, ownerRunId: string): void {
    const key = this.leaseKey(projectId, planId, stageId);
    const existing = this.activeLeases.get(key);
    if (existing && existing.ownerRunId === ownerRunId) {
      this.activeLeases.delete(key);
    }
  }

  async calculateItemFingerprint(
    projectId: string,
    planId: string,
    stageId: string,
    item: ProductionWorkItemV1
  ): Promise<string> {
    const payloadStr = JSON.stringify(item.payload || {});
    return computeSha256(
      `v1:${projectId}:${planId}:${stageId}:${item.id}:${item.kind}:${payloadStr}`
    );
  }

  getReceipt(fingerprint: string): ExecutionReceiptRecord | undefined {
    return this.receipts.get(fingerprint);
  }

  recordReceipt(receipt: ExecutionReceiptRecord): void {
    this.receipts.set(receipt.fingerprint, receipt);
  }

  async executeStage(options: ExecuteStageOptions): Promise<StageExecutionResult> {
    const { projectId, planId, stageId, expectedRevision, runId, signal } = options;

    const plan = productionPlanRepository.getPlan(projectId, planId);
    if (!plan) {
      throw new Error(`未找到制作计划：${planId}`);
    }

    if (plan.revision !== expectedRevision) {
      throw new OptimisticLockError(expectedRevision, plan.revision);
    }

    const stage = plan.stages.find((s) => s.id === stageId);
    if (!stage) {
      throw new Error(`制作计划中未找到阶段：${stageId}`);
    }

    assertStageCanStart(plan, stage);
    // 1. Acquire execution lease
    this.acquireLease(projectId, planId, stageId, runId);

    // 2. Mark stage as running
    let currentPlan = productionPlanRepository.updateStageStatus({
      projectId,
      planId,
      expectedRevision: plan.revision,
      stageId,
      status: 'running',
    });

    let completedItems = 0;
    let failedItems = 0;
    let reusedReceipts = 0;

    try {
      const itemsToRun = stage.workItems.filter(
        (item) => item.status === 'pending' || item.status === 'failed' || item.status === 'recoverable'
      );

      // Concurrency limit: model limit or default
      const concurrencyLimit = Math.min(
        options.concurrency ?? stage.executionLocks?.concurrencyLimit ?? 4,
        10
      );

      // Process in batches
      for (let i = 0; i < itemsToRun.length; i += concurrencyLimit) {
        if (signal?.aborted) {
          break;
        }

        const batch = itemsToRun.slice(i, i + concurrencyLimit);
        await Promise.all(
          batch.map(async (item) => {
            const fingerprint = await this.calculateItemFingerprint(
              projectId,
              planId,
              stageId,
              item
            );

            // Check if receipt already exists with matching fingerprint
            const existingReceipt = this.getReceipt(fingerprint);
            if (existingReceipt && existingReceipt.status === 'succeeded' && existingReceipt.output) {
              reusedReceipts++;
              completedItems++;
              currentPlan = productionPlanRepository.updateWorkItemStatus({
                projectId,
                planId,
                expectedRevision: currentPlan.revision,
                stageId,
                itemId: item.id,
                status: 'succeeded',
                output: existingReceipt.output,
              });
              return;
            }

            // Mark item as running
            currentPlan = productionPlanRepository.updateWorkItemStatus({
              projectId,
              planId,
              expectedRevision: currentPlan.revision,
              stageId,
              itemId: item.id,
              status: 'running',
            });

            try {
              let output: OutputReferenceV1;
              let receiptId: string | undefined;

              if (options.executeItem) {
                const res = await options.executeItem(item, signal);
                output = res.output;
                receiptId = res.receiptId;
              } else {
                // Default simulator/mock execution for document or verified items
                output = {
                  outputId: `out-${item.id}-${Date.now().toString(36)}`,
                  assetId: `asset-${item.id}`,
                  version: (item.currentOutput?.version ?? 0) + 1,
                  verified: true,
                  sourceWorkItemId: item.id,
                  createdAt: Date.now(),
                };
                receiptId = `rcpt-${fingerprint.slice(7, 19)}`;
              }

              // Record success
              this.recordReceipt({
                receiptId: receiptId ?? `rcpt-${Date.now()}`,
                fingerprint,
                projectId,
                planId,
                stageId,
                itemId: item.id,
                status: 'succeeded',
                output,
                createdAt: Date.now(),
              });

              currentPlan = productionPlanRepository.updateWorkItemStatus({
                projectId,
                planId,
                expectedRevision: currentPlan.revision,
                stageId,
                itemId: item.id,
                status: 'succeeded',
                output,
              });
              completedItems++;
            } catch (err) {
              const errorMessage = err instanceof Error ? err.message : String(err);
              failedItems++;

              this.recordReceipt({
                receiptId: `rcpt-err-${Date.now()}`,
                fingerprint,
                projectId,
                planId,
                stageId,
                itemId: item.id,
                status: 'failed',
                error: errorMessage,
                createdAt: Date.now(),
              });

              currentPlan = productionPlanRepository.updateWorkItemStatus({
                projectId,
                planId,
                expectedRevision: currentPlan.revision,
                stageId,
                itemId: item.id,
                status: 'failed',
                error: errorMessage,
              });
            }
          })
        );
      }

      // Check if aborted mid-execution
      if (signal?.aborted) {
        currentPlan = productionPlanRepository.updateStageStatus({
          projectId,
          planId,
          expectedRevision: currentPlan.revision,
          stageId,
          status: 'recoverable',
        });
        return {
          planId,
          stageId,
          finalStageStatus: 'recoverable',
          completedItems,
          failedItems,
          reusedReceipts,
          resumedPlan: currentPlan,
        };
      }

      // Calculate final stage status
      const updatedStage = currentPlan.stages.find((s) => s.id === stageId)!;
      const allSucceeded = updatedStage.workItems.every((w) => w.status === 'succeeded' || w.status === 'skipped');
      const hasFailed = updatedStage.workItems.some((w) => w.status === 'failed');

      const finalStageStatus: StageStatus = allSucceeded
        ? currentPlan.workflow.confirmationPolicy === STAGED_CONFIRMATION_POLICY && !stageReviewsAccepted(updatedStage, 'afterExecution')
          ? 'waiting-user' : 'succeeded'
        : hasFailed
        ? 'failed'
        : 'recoverable';

      currentPlan = productionPlanRepository.updateStageStatus({
        projectId,
        planId,
        expectedRevision: currentPlan.revision,
        stageId,
        status: finalStageStatus,
      });

      return {
        planId,
        stageId,
        finalStageStatus,
        completedItems,
        failedItems,
        reusedReceipts,
        resumedPlan: currentPlan,
      };
    } finally {
      this.releaseLease(projectId, planId, stageId, runId);
    }
  }

  clearReceipts(): void {
    this.receipts.clear();
    this.activeLeases.clear();
  }
}

export const productionCoordinator = new ProductionCoordinator();
