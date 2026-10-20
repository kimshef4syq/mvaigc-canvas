import { tool } from '@openai/agents';
import type { JsonObjectSchemaNonStrict } from '@openai/agents-core/types';
import { z } from 'zod';
import { callMcpTool, type McpAgentTool } from '@/commands/mcpClient';
import { canvasAgentApprovalExecution, canvasAgentApprovalStore, createAgentToolRequestFingerprint, createApprovalId } from '../application/agentApproval';
import { redactSensitiveValue } from '../application/agentRedaction';
import type { CanvasAgentContext } from './sdkRuntime';

export function createMcpAgentTools(definitions: McpAgentTool[], context: CanvasAgentContext) {
  return [...definitions].sort((a, b) => `${a.serverId}/${a.tool.name}`.localeCompare(`${b.serverId}/${b.tool.name}`)).map((definition) => {
    const name = definition.agentName;
    // Unsupported JSON schemas fail closed at invocation rather than accepting arbitrary arguments.
    const parse = (raw: unknown): Record<string, unknown> => {
      const value = z.fromJSONSchema(definition.tool.inputSchema).parse(raw);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MCP 工具参数必须是对象');
      return value as Record<string, unknown>;
    };
    return tool({
      name,
      description: `[MCP ${definition.serverId} / ${definition.tool.name}] ${(definition.tool.description ?? '').slice(0, 3000)}。外部工具可能修改软件或文件；结果未知时不得盲目重复调用。`,
      parameters: definition.tool.inputSchema as unknown as JsonObjectSchemaNonStrict<Record<string, Record<string, unknown>>>,
      strict: false,
      needsApproval: true,
      execute: async (raw, _runContext, details) => {
        const callId = details?.toolCall?.callId;
        if (!callId) throw new Error('MCP 调用缺少 callId');
        const args = parse(raw);
        const event = (status: 'executing' | 'succeeded' | 'failed' | 'unknown', output?: unknown, error?: string) => context.onToolEvent?.({ toolName: name, callId, status, input: redactSensitiveValue(args), output, error });
        event('executing');
        try {
          const execution = await canvasAgentApprovalExecution.executeOnce({
            approvalId: createApprovalId(context.runId, name, callId), runId: context.runId, projectId: context.projectId, toolName: name, callId,
            requestFingerprint: await createAgentToolRequestFingerprint(name, raw, details), activeProjectId: context.getActiveProjectId?.(),
            execute: () => callMcpTool(definition.serverId, definition.tool.name, definition.revision, args),
            isSuccess: (output) => output.isError !== true,
          });
          const output = redactSensitiveValue(execution.output);
          event(execution.output.isError === true ? 'failed' : 'succeeded', output);
          return output;
        } catch (error) {
          const message = redactSensitiveValue(String(error));
          const unknown = canvasAgentApprovalStore.get(createApprovalId(context.runId, name, callId))?.status === 'unknown';
          event(unknown ? 'unknown' : 'failed', undefined, message);
          return { ok: false, outcome: unknown ? 'unknown' : 'failed', error: message, instruction: unknown ? '检查外部软件实际状态；不要自动重复写入或渲染。' : '调用未完成，请根据错误处理。' };
        }
      },
    });
  });
}
