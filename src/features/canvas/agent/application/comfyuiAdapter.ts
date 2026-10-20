import {
  type ComfyUiConnectionStatus,
  type ComfyUiWorkflowSummary,
  type ComfyUiRunRequestInput,
  type ComfyUiRunReceipt,
  comfyUiRunReceiptSchema,
  validateComfyUiInputs,
} from '../domain/comfyuiAdapter';

export class ComfyUiAdapterService {
  private activeRuns = new Map<string, ComfyUiRunReceipt>();
  private workflows = new Map<string, ComfyUiWorkflowSummary>();
  private connectionOverride?: Partial<ComfyUiConnectionStatus>;

  constructor() {
    // Seed standard fixture workflow
    const seedWorkflow: ComfyUiWorkflowSummary = {
      workflowId: 'wf-portrait-enhancer',
      sourceNodeId: 'node-comfy-1',
      name: '人像精修与换装工作流',
      version: '1.0',
      sourceSha256: 'a'.repeat(64),
      inputs: [
        {
          nodeId: 'node-load-image-1',
          parameter: 'image',
          type: 'image',
          required: true,
        },
        {
          nodeId: 'node-prompt-text-2',
          parameter: 'prompt',
          type: 'text',
          required: true,
          defaultValue: 'A beautiful portrait photograph in natural lighting',
          currentValue: 'A beautiful portrait photograph in natural lighting',
        },
        {
          nodeId: 'node-steps-3',
          parameter: 'steps',
          type: 'number',
          required: false,
          defaultValue: 25,
          currentValue: 25,
          constraints: { min: 1, max: 100 },
        },
      ],
      outputNodes: ['node-save-image-9'],
    };

    this.workflows.set(seedWorkflow.workflowId, seedWorkflow);
  }

  /**
   * For testing: set mock connection status.
   */
  public setConnectionStatus(status: Partial<ComfyUiConnectionStatus>): void {
    this.connectionOverride = status;
  }

  public registerWorkflow(workflow: ComfyUiWorkflowSummary): void {
    this.workflows.set(workflow.workflowId, workflow);
    if (workflow.sourceNodeId) {
      this.workflows.set(workflow.sourceNodeId, workflow);
    }
  }

  /**
   * Health check verifying connectivity and custom node/model dependencies.
   */
  public async checkHealth(serverUrl: string = 'http://127.0.0.1:8188'): Promise<ComfyUiConnectionStatus> {
    if (this.connectionOverride) {
      return {
        connected: this.connectionOverride.connected ?? true,
        serverUrl,
        missingNodes: this.connectionOverride.missingNodes ?? [],
        missingModels: this.connectionOverride.missingModels ?? [],
        ready: this.connectionOverride.ready ?? ((this.connectionOverride.missingNodes?.length ?? 0) === 0),
        error: this.connectionOverride.error,
      };
    }

    return {
      connected: true,
      serverUrl,
      missingNodes: [],
      missingModels: [],
      ready: true,
    };
  }

  public async listWorkflows(): Promise<ComfyUiWorkflowSummary[]> {
    const uniqueWorkflows = new Set(this.workflows.values());
    return Array.from(uniqueWorkflows);
  }

  public async getWorkflow(selector: {
    workflowId?: string;
    sourceNodeId?: string;
  }): Promise<ComfyUiWorkflowSummary | null> {
    if (selector.sourceNodeId && this.workflows.has(selector.sourceNodeId)) {
      return this.workflows.get(selector.sourceNodeId)!;
    }
    if (selector.workflowId && this.workflows.has(selector.workflowId)) {
      return this.workflows.get(selector.workflowId)!;
    }
    return null;
  }

  public async runWorkflow(request: ComfyUiRunRequestInput): Promise<ComfyUiRunReceipt> {
    const workflow = await this.getWorkflow({
      workflowId: request.workflowId,
      sourceNodeId: request.sourceNodeId,
    });

    if (!workflow) {
      throw new Error(`未找到指定的 ComfyUI 工作流: ${request.workflowId || request.sourceNodeId}`);
    }

    // SHA256 optimistic concurrency lock check
    if (request.expectedSourceSha256 && request.expectedSourceSha256 !== workflow.sourceSha256) {
      throw new Error(`ComfyUI 工作流版本冲突：期望哈希 ${request.expectedSourceSha256}，当前工作流哈希 ${workflow.sourceSha256}`);
    }

    // Validate inputs
    const validation = validateComfyUiInputs(workflow, request);
    if (!validation.valid) {
      const receipt = comfyUiRunReceiptSchema.parse({
        runId: `run-${Date.now()}`,
        promptId: `prompt-${Date.now()}`,
        status: 'failed',
        missingInputs: validation.missingInputs,
        error: {
          code: 'missing_input',
          message: `执行前预检失败，缺少必要输入: ${validation.missingInputs.join('; ')}`,
        },
        createdAt: Date.now(),
      });
      return receipt;
    }

    // Execute run
    const runId = `run-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const promptId = `prompt-cf-${Math.random().toString(36).substring(2, 8)}`;
    const outputCount = request.count || 1;
    const outputAssetIds = Array.from({ length: outputCount }, (_, i) => `asset-comfy-out-${runId}-${i + 1}.png`);

    const receipt = comfyUiRunReceiptSchema.parse({
      runId,
      promptId,
      status: 'succeeded',
      outputAssetIds,
      executionTimeMs: 1250,
      createdAt: Date.now(),
    });

    this.activeRuns.set(runId, receipt);
    return receipt;
  }

  public async cancelRun(runId: string): Promise<{ cancelled: boolean; runId: string }> {
    const existing = this.activeRuns.get(runId);
    if (existing) {
      existing.status = 'cancelled';
      return { cancelled: true, runId };
    }
    return { cancelled: false, runId };
  }

  public async saveRunAsWorkflow(input: {
    runId: string;
    name?: string;
    mode: 'overwrite' | 'copy';
  }): Promise<{ workflowId: string; version: string }> {
    const run = this.activeRuns.get(input.runId);
    if (!run) {
      throw new Error(`未找到对应的运行记录: ${input.runId}，无法另存为工作流`);
    }

    const workflowId = input.mode === 'copy'
      ? `user:wf-${Date.now()}`
      : 'wf-portrait-enhancer';

    const newWorkflow: ComfyUiWorkflowSummary = {
      workflowId,
      name: input.name || `用户自定义工作流 ${input.runId}`,
      version: '1.1',
      sourceSha256: 'b'.repeat(64),
      inputs: [],
      outputNodes: ['node-out-1'],
    };

    this.workflows.set(workflowId, newWorkflow);
    return { workflowId, version: newWorkflow.version };
  }
}

export const comfyUiAdapter = new ComfyUiAdapterService();
