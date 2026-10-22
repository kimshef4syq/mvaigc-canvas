import type { AgentApprovalRecord } from './agentApproval';

export type CanvasAgentExecutionMode = 'manual' | 'auto';

export interface AgentAutoApprovalDecision {
  allowed: boolean;
  reason: string;
}

interface PreparedApprovalLike {
  record: AgentApprovalRecord;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** Automatic tool execution never approves creative decisions on the user's behalf. */
export function decideAgentAutoApproval(
  approval: PreparedApprovalLike,
): AgentAutoApprovalDecision {
  const { record } = approval;
  if (record.status === 'conflicted' || record.expiresAt <= Date.now()) {
    return { allowed: false, reason: '审批预览已冲突或过期' };
  }
  const toolName = record.toolName?.split(/[.:]/).pop();
  if (toolName === 'production_plan' && asRecord(record.arguments)?.action === 'record_review') {
    return { allowed: false, reason: '制作阶段的素材、方案与生成授权必须由用户确认' };
  }
  if (toolName === 'canvas_command') {
    const command = asRecord(record.arguments);
    const commandType = typeof command?.type === 'string' ? command.type : '';
    if (!commandType) return { allowed: false, reason: '工具参数不完整' };
    if (commandType === 'node.delete') {
      return { allowed: false, reason: '删除画布节点仍需用户确认' };
    }
  }
  return { allowed: true, reason: '自动执行已授权范围内的工具操作，保留制作阶段确认' };
}
