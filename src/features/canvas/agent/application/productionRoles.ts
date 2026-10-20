import { z } from 'zod';
import { taskRouteSchema, type TaskRouteV1 } from '../domain/taskRoute';
import {
  productionStageSchema,
  outputReferenceSchema,
  type ProductionStageV1,
  type ProductionWorkItemV1,
  type OutputReferenceV1,
  type StageStatus,
  type WorkItemStatus,
  type StageOutlineItem,
} from '../domain/productionPlan';

export const roleKindSchema = z.enum([
  'router',
  'planner',
  'executor',
  'comfyui',
]);

export type RoleKind = z.infer<typeof roleKindSchema>;

// 1. Router Request & Response
export const routerRequestSchema = z.object({
  text: z.string().min(1),
  activePlanId: z.string().optional(),
  selectedNodeIds: z.array(z.string()).default([]),
  attachments: z.array(z.object({
    id: z.string(),
    name: z.string(),
    kind: z.string(),
  })).default([]),
});

export type RouterRequest = z.infer<typeof routerRequestSchema>;

export const routerResponseSchema = z.object({
  route: taskRouteSchema,
});

export type RouterResponse = z.infer<typeof routerResponseSchema>;

// 2. Planner Request & Response
export const plannerRequestSchema = z.object({
  planId: z.string().min(1),
  expectedRevision: z.number().int().positive(),
  currentStageOutline: z.object({
    id: z.string().min(1),
    order: z.number().int().nonnegative(),
    name: z.string().min(1),
    condition: z.string().optional(),
  }),
  sourceIds: z.array(z.string()).default([]),
  lockedDecisions: z.record(z.unknown()).default({}),
  userFeedback: z.string().optional(),
});

export type PlannerRequest = z.infer<typeof plannerRequestSchema>;

export const plannerResponseSchema = z.object({
  stage: productionStageSchema,
  changeReason: z.string().optional(),
  missingFacts: z.array(z.object({
    key: z.string(),
    question: z.string(),
    affects: z.string(),
  })).default([]),
});

export type PlannerResponse = z.infer<typeof plannerResponseSchema>;

// 3. Executor Request & Response
export const executorRequestSchema = z.object({
  planId: z.string().min(1),
  stageId: z.string().min(1),
  expectedRevision: z.number().int().positive(),
  workItems: z.array(z.custom<ProductionWorkItemV1>()).min(1),
  executionLocks: z.record(z.unknown()).default({}),
});

export type ExecutorRequest = z.infer<typeof executorRequestSchema>;

export const workItemExecutionResultSchema = z.object({
  itemId: z.string().min(1),
  status: z.enum(['succeeded', 'failed', 'recoverable', 'skipped']),
  output: outputReferenceSchema.optional(),
  receiptId: z.string().optional(),
  error: z.string().optional(),
  fingerprint: z.string().optional(),
});

export type WorkItemExecutionResult = z.infer<typeof workItemExecutionResultSchema>;

export const executorResponseSchema = z.object({
  stageId: z.string().min(1),
  stageStatus: z.enum(['succeeded', 'failed', 'recoverable', 'waiting-user']),
  itemResults: z.array(workItemExecutionResultSchema),
});

export type ExecutorResponse = z.infer<typeof executorResponseSchema>;

// 4. Role Envelope Discriminated Union
export const roleEnvelopeSchema = z.object({
  version: z.literal(1).default(1),
  role: roleKindSchema,
  projectId: z.string().min(1),
  runId: z.string().min(1),
  taskId: z.string().min(1),
  planId: z.string().optional(),
  stageId: z.string().optional(),
  expectedPlanRevision: z.number().int().positive().optional(),
  sourceRefs: z.array(z.string()).default([]),
  profileRefs: z.array(z.object({
    id: z.string(),
    revision: z.string(),
  })).default([]),
  capabilitySnapshotId: z.string().default('default'),
  cancellationTokenId: z.string().default('none'),
});

export type RoleEnvelopeV1 = z.infer<typeof roleEnvelopeSchema>;

// 5. Tool Scopes & Permissions by Role
export interface RoleToolPolicy {
  role: RoleKind;
  allowedTools: string[];
  allowedCanvasCommands: string[];
  disallowedActions: string[];
}

export const ROLE_TOOL_POLICIES: Record<RoleKind, RoleToolPolicy> = {
  router: {
    role: 'router',
    allowedTools: ['profile_search', 'profile_read', 'source_inspect'],
    allowedCanvasCommands: [],
    disallowedActions: ['canvas_command', 'generation.submit', 'production_plan', 'node.create', 'node.delete'],
  },
  planner: {
    role: 'planner',
    allowedTools: [
      'profile_search',
      'profile_read',
      'source_read',
      'source_inspect',
      'canvas_command',
      'production_plan',
    ],
    allowedCanvasCommands: [
      'canvas.query',
      'node.create', // For writing document/script nodes
      'node.update',
      'group.create',
    ],
    disallowedActions: [
      'generation.submit', // Planner CANNOT submit paid generation!
      'generation.recover',
      'media.postprocess',
      'mcp_run',
    ],
  },
  executor: {
    role: 'executor',
    allowedTools: [
      'canvas_command',
      'production_plan',
      'asset_read',
      'diagnostics',
    ],
    allowedCanvasCommands: [
      'canvas.query',
      'node.create',
      'node.update',
      'generation.submit',
      'generation.recover',
      'group.create',
    ],
    disallowedActions: [
      'profile_search',
      'replan',
      'authorStage', // Executor CANNOT rewrite the script or stage contract!
    ],
  },
  comfyui: {
    role: 'comfyui',
    allowedTools: [
      'comfyui_inspect',
      'comfyui_run',
      'canvas_command',
      'asset_read',
    ],
    allowedCanvasCommands: [
      'canvas.query',
      'node.create',
      'node.update',
    ],
    disallowedActions: [
      'profile_search',
      'generation.submit',
    ],
  },
};

export class RolePermissionViolationError extends Error {
  constructor(role: RoleKind, action: string, reason: string) {
    super(`[权限拦截] 角色 ${role} 无权执行 ${action}：${reason}`);
    this.name = 'RolePermissionViolationError';
  }
}

export function assertRoleActionAllowed(
  role: RoleKind,
  toolName: string,
  subCommand?: string
): void {
  const policy = ROLE_TOOL_POLICIES[role];
  if (!policy) {
    throw new Error(`未定义的角色策略: ${role}`);
  }

  // 1. Check toolName
  if (!policy.allowedTools.includes(toolName)) {
    throw new RolePermissionViolationError(
      role,
      toolName,
      `工具 ${toolName} 不在角色允许范围 [${policy.allowedTools.join(', ')}] 内`
    );
  }

  // 2. Check disallowed actions
  if (policy.disallowedActions.includes(toolName) || (subCommand && policy.disallowedActions.includes(subCommand))) {
    throw new RolePermissionViolationError(
      role,
      subCommand || toolName,
      `操作 ${subCommand || toolName} 属于角色显式禁止的职责`
    );
  }

  // 3. For canvas_command, check allowed sub commands
  if (toolName === 'canvas_command' && subCommand) {
    if (!policy.allowedCanvasCommands.includes(subCommand)) {
      throw new RolePermissionViolationError(
        role,
        `canvas_command.${subCommand}`,
        `命令 ${subCommand} 不在允许的画布命令清单中`
      );
    }
  }
}
