import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentModelTurnRequest, AgentModelTurnResponse } from '../domain/agentModel';
import type { ChatCatalogEntry } from '../../application/chatModelCatalog';
import { useProjectStore } from '@/stores/projectStore';
import { runCanvasAgentTurn } from './canvasAgentController';
import { callMcpTool } from '@/commands/mcpClient';
import { prepareExternalImageSource, prepareExternalVideoSource } from '@/commands/image';
import { useCanvasStore } from '@/stores/canvasStore';
import { CANVAS_NODE_TYPES } from '../../domain/canvasNodes';

const fixture = vi.hoisted(() => ({ respond: vi.fn<(request: AgentModelTurnRequest) => Promise<AgentModelTurnResponse>>() }));
vi.mock('@/commands/mcpClient', () => ({
  listMcpAgentTools: vi.fn().mockResolvedValue([{ agentName: 'mcp_fixture_script', serverId: 'fixture', revision: 'v1', tool: { name: 'run_script', description: 'Fixture only', inputSchema: { type: 'object', properties: { script: { type: 'string' } }, required: ['script'] } } }]),
  callMcpTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] }),
  listMcpServers: vi.fn().mockResolvedValue([{ config: { id: 'fixture', transport: 'stdio', command: '/Applications/ResolveMCP', allowedTools: ['run_script'] }, connected: true }]),
  connectMcpServer: vi.fn(),
}));
vi.mock('@/commands/image', () => ({ prepareExternalVideoSource: vi.fn().mockResolvedValue({ path: '/tmp/fixture-video.mp4', bytes: 1234 }), prepareExternalImageSource: vi.fn().mockResolvedValue({ path: '/tmp/fixture-original.png', width: 100, height: 100, bytes: 1234 }) }));
vi.mock('./agentRuntimeLoader', () => ({
  loadCanvasAgentSdkRuntime: async () => {
    const runtime = await import('../infrastructure/sdkRuntime');
    return { ...runtime, createStoryboardAgentRuntime: (options: Parameters<typeof runtime.createStoryboardAgentRuntime>[0]) => runtime.createStoryboardAgentRuntime({ ...options, transport: { getResponse: fixture.respond, async *getStreamedResponse() { throw new Error('unused'); } } }) };
  },
}));

describe('MCP automatic approval orchestration', () => {
  beforeEach(() => {
    vi.mocked(callMcpTool).mockReset().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
    vi.mocked(prepareExternalImageSource).mockClear();
    vi.mocked(prepareExternalVideoSource).mockClear();
  });
  it.each(['image', 'video'] as const)('finishes asset discovery and current-timeline %s handoff through the real SDK approval loop', async (kind) => {
    const toolName = `mcp_davinci_append_${kind}s`;
    const source = kind === 'image' ? 'https://media.example/original.png' : '/media/generated.mp4';
    const previousProject = useProjectStore.getState().currentProjectId;
    const previousNodes = useCanvasStore.getState().nodes;
    useProjectStore.setState({ currentProjectId: 'image-handoff' });
    useCanvasStore.setState({ nodes: [{ id: 'result-image', type: kind === 'image' ? CANVAS_NODE_TYPES.imageEdit : CANVAS_NODE_TYPES.video, position: { x: 0, y: 0 }, data: { ...(kind === 'image' ? { imageUrl: source } : { videoUrl: source, sourcePrompt: 'Generated shot' }), aspectRatio: '16:9' } }] });
    vi.mocked(callMcpTool).mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify({ result: { [`canvas_append_${kind}s`]: true, ok: true, stage: 'timeline-append', outcome: 'succeeded', imported: 1, requested: 1, appended: 1, timeline: 'Current timeline' } }) }] });
    let round = 0;
    fixture.respond.mockImplementation(async (request) => {
      expect(request.tools.some((tool) => tool.name === toolName)).toBe(true);
      const i = round++;
      return { responseId: `images-${i}`, text: i === 2 ? '已追加 1 张图片到当前时间线' : undefined, toolCalls: i === 0 ? [{ name: 'canvas_command', callId: 'find-images', arguments: JSON.stringify({ type: 'asset.list', input: { kind, generatedOnly: true } }) }] : i === 1 ? [{ name: toolName, callId: 'append-images', arguments: JSON.stringify({ serverId: 'fixture', assetIds: [`result-image:${kind}`] }) }] : [], usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
    });
    const model: ChatCatalogEntry = { id: 'fixture', providerId: 'fixture', providerLabel: 'Fixture', modelId: 'fixture', modelLabel: 'Fixture', supportsTools: true, supportsMultimodal: false, supportsStreaming: false, supportsReasoningSummary: false, supportsToolSearch: false, agentProtocol: 'openai-chat-completions', usable: true };
    try {
      const result = await runCanvasAgentTurn({ projectId: 'image-handoff', model, message: '把画布上的图放到达芬奇当前时间线', executionMode: 'auto' });
      expect(result.status).toBe('completed');
      expect(kind === 'image' ? prepareExternalImageSource : prepareExternalVideoSource).toHaveBeenCalledWith(source);
      expect(callMcpTool).toHaveBeenCalledTimes(1);
      expect(round).toBe(3);
    } finally {
      useProjectStore.setState({ currentProjectId: previousProject });
      useCanvasStore.setState({ nodes: previousNodes });
    }
  });
  it('can read canvas state and then invoke MCP without matching any canvas skill keywords', async () => {
    const previous = useProjectStore.getState().currentProjectId;
    useProjectStore.setState({ currentProjectId: 'canvas-mcp-handoff' });
    let round = 0;
    fixture.respond.mockImplementation(async (request) => {
      expect(request.tools.some((tool) => tool.name === 'canvas_command')).toBe(true);
      const i = round++;
      return { responseId: `handoff-${i}`, text: i === 2 ? '素材读取后已交给外部工具' : undefined, toolCalls: i === 0 ? [{ name: 'canvas_command', callId: 'read-selected', arguments: JSON.stringify({ type: 'canvas.query', input: { scope: 'selection' } }) }] : i === 1 ? [{ name: 'mcp_fixture_script', callId: 'handoff-call', arguments: JSON.stringify({ script: 'result = 1' }) }] : [], usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
    });
    const model: ChatCatalogEntry = { id: 'fixture', providerId: 'fixture', providerLabel: 'Fixture', modelId: 'fixture', modelLabel: 'Fixture', supportsTools: true, supportsMultimodal: false, supportsStreaming: false, supportsReasoningSummary: false, supportsToolSearch: false, agentProtocol: 'openai-chat-completions', usable: true };
    try {
      const result = await runCanvasAgentTurn({ projectId: 'canvas-mcp-handoff', model, message: '把这两张图放到达芬奇里面去', executionMode: 'auto' });
      expect(result.status).toBe('completed');
      expect(callMcpTool).toHaveBeenCalledTimes(1);
      expect(round).toBe(3);
    } finally { useProjectStore.setState({ currentProjectId: previous }); }
  });
  it('keeps original arguments across consecutive calls when the second preview is redacted', async () => {
    const previous = useProjectStore.getState().currentProjectId;
    useProjectStore.setState({ currentProjectId: 'mcp-auto-fixture' });
    const scripts = ['result = 1', 'result = {"path": "/Users/example/movie.mov"}'];
    let round = 0;
    fixture.respond.mockImplementation(async () => {
      const i = round++;
      return { responseId: `response-${i}`, text: i === 2 ? '检查完成' : undefined, toolCalls: i < 2 ? [{ name: 'mcp_fixture_script', callId: `call-${i}`, arguments: JSON.stringify({ script: scripts[i] }) }] : [], usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
    });
    const model: ChatCatalogEntry = { id: 'fixture', providerId: 'fixture', providerLabel: 'Fixture', modelId: 'fixture', modelLabel: 'Fixture', supportsTools: true, supportsMultimodal: false, supportsStreaming: false, supportsReasoningSummary: false, supportsToolSearch: false, agentProtocol: 'openai-chat-completions', usable: true };
    try {
      const result = await runCanvasAgentTurn({ projectId: 'mcp-auto-fixture', model, message: '诊断 MCP 连接', executionMode: 'auto' });
      expect(result.status).toBe('completed');
      expect(result.finalText).toBe('检查完成');
      expect(vi.mocked(callMcpTool).mock.calls.map((args) => args[3])).toEqual(scripts.map((script) => ({ script })));
    } finally { useProjectStore.setState({ currentProjectId: previous }); }
  });
});
