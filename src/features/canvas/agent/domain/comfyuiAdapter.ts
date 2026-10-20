import { z } from 'zod';

export const comfyUiConnectionStatusSchema = z.object({
  connected: z.boolean(),
  serverUrl: z.string().optional(),
  missingNodes: z.array(z.string()).default([]),
  missingModels: z.array(z.string()).default([]),
  ready: z.boolean(),
  error: z.string().optional(),
});

export type ComfyUiConnectionStatus = z.infer<typeof comfyUiConnectionStatusSchema>;

export const comfyUiInputSpecSchema = z.object({
  nodeId: z.string().min(1),
  parameter: z.string().min(1),
  type: z.enum(['image', 'video', 'audio', 'text', 'number', 'boolean']),
  required: z.boolean(),
  defaultValue: z.unknown().optional(),
  currentValue: z.unknown().optional(),
  constraints: z.object({
    min: z.number().optional(),
    max: z.number().optional(),
    options: z.array(z.string()).optional(),
  }).optional(),
});

export type ComfyUiInputSpec = z.infer<typeof comfyUiInputSpecSchema>;

export const comfyUiWorkflowSummarySchema = z.object({
  workflowId: z.string().min(1),
  sourceNodeId: z.string().optional(),
  name: z.string().min(1),
  version: z.string().default('1.0'),
  sourceSha256: z.string().length(64),
  inputs: z.array(comfyUiInputSpecSchema),
  outputNodes: z.array(z.string()).min(1),
});

export type ComfyUiWorkflowSummary = z.infer<typeof comfyUiWorkflowSummarySchema>;

export const comfyUiRunRequestSchema = z.object({
  workflowId: z.string().min(1),
  sourceNodeId: z.string().optional(),
  expectedSourceSha256: z.string().length(64).optional(),
  inputValues: z.record(z.string(), z.unknown()).default({}),
  inputBindings: z.array(z.object({
    nodeId: z.string().min(1),
    parameter: z.string().min(1),
    workspacePath: z.string().min(1),
  })).default([]),
  count: z.number().int().positive().default(1),
});

export type ComfyUiRunRequest = z.infer<typeof comfyUiRunRequestSchema>;
// Input shape: defaulted fields (inputValues/inputBindings/count) are optional on call.
export type ComfyUiRunRequestInput = z.input<typeof comfyUiRunRequestSchema>;

export const comfyUiRunReceiptSchema = z.object({
  runId: z.string().min(1),
  promptId: z.string().min(1),
  status: z.enum(['pending', 'running', 'succeeded', 'failed', 'cancelled']),
  outputAssetIds: z.array(z.string()).default([]),
  executionTimeMs: z.number().nonnegative().optional(),
  missingInputs: z.array(z.string()).optional(),
  missingNodes: z.array(z.string()).optional(),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }).optional(),
  createdAt: z.number().int().positive(),
});

export type ComfyUiRunReceipt = z.infer<typeof comfyUiRunReceiptSchema>;

/**
 * Validates run inputs against workflow input specs.
 */
export function validateComfyUiInputs(
  workflow: ComfyUiWorkflowSummary,
  request: ComfyUiRunRequestInput
): {
  valid: boolean;
  missingInputs: string[];
  diffs: Record<string, unknown>;
} {
  const missingInputs: string[] = [];
  const diffs: Record<string, unknown> = {};
  const inputValues = request.inputValues || {};
  const inputBindings = request.inputBindings || [];

  for (const input of workflow.inputs) {
    const key = `${input.nodeId}:${input.parameter}`;
    const directValue = inputValues[key] ?? inputValues[input.parameter];
    const binding = inputBindings.find(
      (b) => b.nodeId === input.nodeId && b.parameter === input.parameter
    );

    const providedValue = directValue ?? binding?.workspacePath ?? input.currentValue ?? input.defaultValue;

    if (input.required && (providedValue === undefined || providedValue === null || providedValue === '')) {
      missingInputs.push(`节点 ${input.nodeId} 的参数 "${input.parameter}" (${input.type}) 未提供必填输入`);
    }

    if (directValue !== undefined && directValue !== input.currentValue) {
      diffs[key] = { from: input.currentValue, to: directValue };
    }
  }

  return {
    valid: missingInputs.length === 0,
    missingInputs,
    diffs,
  };
}
