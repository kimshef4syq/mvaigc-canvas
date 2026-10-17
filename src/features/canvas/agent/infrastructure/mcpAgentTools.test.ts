import { describe, expect, it, vi } from 'vitest';
import { RunContext } from '@openai/agents';
import { callMcpTool } from '@/commands/mcpClient';
import { createMcpAgentTools } from './mcpAgentTools';
import { createCanvasAgent, createStoryboardAgentRuntime, normalizeStoryboardAgentToolCalls } from './sdkRuntime';
import { parseInstalledSkill } from '../application/installedSkills';
import { readSkillResource } from '@/commands/extensions';
import { canvasAgentApprovalStore, createAgentRequestFingerprint, createApprovalId, createApprovalRecord } from '../application/agentApproval';

vi.mock('@/commands/mcpClient', () => ({ callMcpTool: vi.fn() }));
vi.mock('@/commands/extensions', () => ({ readSkillResource: vi.fn(), listInstalledSkills: vi.fn().mockResolvedValue([]) }));

const definition = { agentName: 'mcp_editor_fixture', serverId: 'editor', revision: 'revision-one', tool: { name: 'timeline.create', description: 'Create timeline', inputSchema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'], additionalProperties: false } } };

describe('MCP agent tools', () => {
  const runtime = () => createStoryboardAgentRuntime({ resolveModel: () => ({ catalogId: 'test', providerId: 'test', modelId: 'test', label: 'Test', usable: true, capabilities: { protocol: 'openai-chat-completions', tools: true, stream: false, vision: false, reasoningSummary: false, toolSearch: false } }) });
  it('provides exact canvas command schemas without requiring a matching skill', async () => {
    const agent = createCanvasAgent({ runtime: runtime(), context: { projectId: 'project', runId: 'schema-query' }, skillContext: { text: '把这两张图放过去', installedSkills: [] } });
    const lookup = agent.tools.find((item) => item.name === 'canvas_command_schema');
    if (lookup?.type !== 'function') throw new Error('Missing schema lookup');
    expect(await lookup.invoke(new RunContext(), JSON.stringify({ type: 'viewport.focus' }))).toMatchObject({ type: 'viewport.focus', inputSchema: { required: ['nodeIds'] } });
    expect(await lookup.invoke(new RunContext(), JSON.stringify({ type: 'viewbox.delete' }))).toMatchObject({ ok: false });
  });
  it('loads large MCP toolboxes on demand instead of sending all schemas immediately', async () => {
    const agent = createCanvasAgent({ runtime: runtime(), context: { projectId: 'project', runId: 'discover' }, skillContext: { text: '你好', installedSkills: [] }, mcpTools: Array.from({ length: 12 }, (_, i) => ({ ...definition, agentName: `mcp_editor_${i}`, tool: { ...definition.tool, name: `operation${i}` } })) });
    expect(agent.tools.some((item) => item.name.startsWith('mcp_editor_'))).toBe(false);
    const discovery = agent.tools.find((item) => item.name === 'mcp_tools');
    if (discovery?.type !== 'function') throw new Error('Missing MCP discovery tool');
    await discovery.invoke(new RunContext(), JSON.stringify({ query: 'editor' }));
    expect(agent.tools.filter((item) => item.name.startsWith('mcp_editor_'))).toHaveLength(8);
  });
  it('inspects every catalog page without running or loading external tools', async () => {
    const agent = createCanvasAgent({ runtime: runtime(), context: { projectId: 'project', runId: 'inspect' }, skillContext: { text: '检查全部 MCP 工具', installedSkills: [] }, mcpTools: Array.from({ length: 14 }, (_, i) => ({ ...definition, agentName: `mcp_editor_${i}`, tool: { ...definition.tool, name: `operation${i}` } })) });
    const inspector = agent.tools.find((item) => item.name === 'mcp_tools');
    if (inspector?.type !== 'function') throw new Error('Missing inspector');
    const page1 = await inspector.invoke(new RunContext(), JSON.stringify({ query: '', mode: 'inspect' }));
    const page2 = await inspector.invoke(new RunContext(), JSON.stringify({ query: '', mode: 'inspect', offset: 8 }));
    expect(page1).toMatchObject({ totalMatches: 14, nextOffset: 8 });
    expect(page2).toMatchObject({ totalMatches: 14, nextOffset: null });
    expect(agent.tools.filter((item) => item.name.startsWith('mcp_editor_'))).toHaveLength(0);
  });
  it('binds diagnostics approval to original parameters before schema parsing strips extra fields', async () => {
    const runId = 'diagnostic-original-args';
    const raw = { operation: 'classify-error', error: 'HTTP 429', extraField: 'ignored by schema' };
    const agent = createCanvasAgent({ runtime: runtime(), context: { projectId: 'project', runId, getActiveProjectId: () => 'project' }, skillContext: { text: '诊断错误', installedSkills: [] } });
    const diagnostic = agent.tools.find((item) => item.name === 'diagnostics');
    if (diagnostic?.type !== 'function') throw new Error('Missing diagnostics');
    const callId = 'diagnostic-call';
    const record = createApprovalRecord({ id: createApprovalId(runId, 'diagnostics', callId), runId, projectId: 'project', interruptionId: callId, toolName: 'diagnostics', arguments: raw, requestFingerprint: await createAgentRequestFingerprint('diagnostics', raw), baseRevision: 0, impact: { effect: 'read', title: 'Diagnostics', summary: 'Read only', affectedNodeCount: 0, affectedEdgeCount: 0, externalSideEffect: false } });
    canvasAgentApprovalStore.put(record);
    canvasAgentApprovalStore.update(record.id, { status: 'approved' });
    await diagnostic.invoke(new RunContext(), JSON.stringify(raw), { toolCall: { type: 'function_call', name: 'diagnostics', callId, arguments: JSON.stringify(raw) } });
    expect(canvasAgentApprovalStore.get(record.id)?.status).toBe('succeeded');
  });
  it('keeps the canvas entry point and loads vision access when reading an installed skill', async () => {
    const skill = parseInstalledSkill({ id: 'filmmaker', markdown: '---\nname: filmmaker\ndescription: Plan a film\n---\nRead the story and create nodes.', enabled: true, revision: 'one', resources: ['references/shots.md'] });
    vi.mocked(readSkillResource).mockResolvedValue('Read the story and create nodes.');
    const agent = createCanvasAgent({ runtime: runtime(), context: { projectId: 'project', runId: 'skill-discover' }, supportsVision: true, skillContext: { text: '你好', installedSkills: [skill] } });
    expect(agent.tools.some((item) => item.name === 'canvas_command')).toBe(true);
    expect(agent.tools.some((item) => item.name === 'asset_read')).toBe(false);
    const reader = agent.tools.find((item) => item.name === 'skill_read');
    if (reader?.type !== 'function') throw new Error('Missing skill reader');
    await reader.invoke(new RunContext(), JSON.stringify({ skillId: 'installed:filmmaker' }));
    expect(agent.tools.some((item) => item.name === 'canvas_command')).toBe(true);
    expect(agent.tools.filter((item) => item.name === 'canvas_command')).toHaveLength(1);
    expect(agent.tools.some((item) => item.name === 'asset_read')).toBe(true);
    expect(readSkillResource).toHaveBeenCalledWith('filmmaker', 'SKILL.md', 'one');
  });
  it('preserves only actually registered dynamic tool calls through model response normalization', () => {
    const calls = [{ callId: '1', name: 'mcp_editor_0', arguments: '{}' }, { callId: '2', name: 'mcp_unknown_0', arguments: '{}' }, { callId: '3', name: 'skill_read', arguments: '{}' }];
    expect(normalizeStoryboardAgentToolCalls(calls, ['mcp_editor_0', 'skill_read']).map((call) => call.name)).toEqual(['mcp_editor_0', 'skill_read']);
  });
  async function prepared(runId: string) {
    const args = { title: 'Film' };
    const tool = createMcpAgentTools([definition], { projectId: 'project', runId, getActiveProjectId: () => 'project' })[0];
    const callId = 'call-1';
    const record = createApprovalRecord({
      id: createApprovalId(runId, tool.name, callId), runId, projectId: 'project', interruptionId: callId,
      toolName: tool.name, arguments: args, requestFingerprint: await createAgentRequestFingerprint(tool.name, args), baseRevision: 0,
      impact: { effect: 'external-submit', title: tool.name, summary: 'External write', affectedNodeCount: 0, affectedEdgeCount: 0, externalSideEffect: true },
    });
    canvasAgentApprovalStore.put(record);
    const invoke = () => tool.invoke(new RunContext(), JSON.stringify(args), { toolCall: { type: 'function_call', name: tool.name, callId, arguments: JSON.stringify(args) } });
    return { record, invoke };
  }
  it('requires approval, then executes a remote write exactly once for the same call ID', async () => {
    vi.mocked(callMcpTool).mockReset().mockResolvedValue({ content: [{ type: 'text', text: 'done' }] });
    const { record, invoke } = await prepared('mcp-success');
    await invoke();
    expect(callMcpTool).not.toHaveBeenCalled();
    canvasAgentApprovalStore.update(record.id, { status: 'approved' });
    await invoke(); await invoke();
    expect(callMcpTool).toHaveBeenCalledTimes(1);
    expect(callMcpTool).toHaveBeenCalledWith('editor', 'timeline.create', 'revision-one', { title: 'Film' });
  });
  it('does not resend an external write after a connection failure with unknown outcome', async () => {
    vi.mocked(callMcpTool).mockReset().mockRejectedValue(new Error('connection lost'));
    const { record, invoke } = await prepared('mcp-unknown');
    canvasAgentApprovalStore.update(record.id, { status: 'approved' });
    await invoke(); await invoke();
    expect(callMcpTool).toHaveBeenCalledTimes(1);
    expect(canvasAgentApprovalStore.get(record.id)?.status).toBe('unknown');
  });
});
