import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';
import { canvasAgentApprovalStore, createApprovalId } from './agentApproval';
import {
  prepareExternalAgentToolRequest,
  resolveExternalAgentToolApproval,
} from './externalAgentCanvasBridge';
import type { ExternalAgentToolRequest } from '../domain/agentModel';

const commandMocks = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock('@/commands/externalAgent', () => ({ resolveExternalAgentToolCall: commandMocks.resolve }));

function request(): ExternalAgentToolRequest {
  return {
    version: 1,
    runtime: 'codex',
    sessionId: 'session-1',
    turnId: 'turn-1',
    callId: 'call-1',
    toolName: 'canvas_command',
    arguments: { type: 'node.delete', input: { nodeIds: ['node-1'] } },
  };
}

function assetReadRequest(): ExternalAgentToolRequest {
  return {
    ...request(),
    callId: 'asset-call-1',
    toolName: 'asset_read',
    arguments: { assetId: 'node-1:image' },
  };
}

function deterministicToolRequest(): ExternalAgentToolRequest {
  return {
    ...request(),
    callId: 'deterministic-tool-call',
    arguments: { type: 'node.tool.run', input: { nodeId: 'node-1', toolType: 'crop' } },
  };
}

function recoveryRequest(): ExternalAgentToolRequest {
  return {
    ...request(),
    callId: 'recover-call-1',
    arguments: { type: 'generation.recover', input: { jobId: 'job-1', nodeIds: ['node-1'] } },
  };
}

describe('external Agent Canvas approval bridge', () => {
  beforeEach(() => {
    commandMocks.resolve.mockReset().mockResolvedValue(undefined);
    canvasAgentApprovalStore.deleteRun('turn-1');
    useProjectStore.setState({ currentProjectId: 'project-1' });
    useCanvasStore.setState((state) => ({
      ...state,
      nodes: [{
        id: 'node-1',
        type: 'tagNode',
        position: { x: 0, y: 0 },
        data: { displayName: 'Reference' },
      } as any],
      edges: [],
      selectedNodeId: null,
      revision: 0,
      history: { past: [], future: [] },
    }));
  });

  it('creates the same persisted approval card used by the built-in Agent', async () => {
    const view = await prepareExternalAgentToolRequest({ projectId: 'project-1', request: request() });
    expect(view).toMatchObject({ id: 'call-1', toolName: 'canvas_command' });
    expect(canvasAgentApprovalStore.get(createApprovalId('turn-1', 'canvas_command', 'call-1')))
      .toMatchObject({ projectId: 'project-1', status: 'awaiting-approval' });
  });

  it('classifies deterministic tool workflows as persisted canvas writes', async () => {
    const toolRequest = deterministicToolRequest();
    await prepareExternalAgentToolRequest({ projectId: 'project-1', request: toolRequest });
    expect(canvasAgentApprovalStore.get(createApprovalId('turn-1', 'canvas_command', toolRequest.callId)))
      .toMatchObject({ impact: { effect: 'canvas-write', externalSideEffect: false } });
  });

  it('describes result recovery as a canvas write without a new paid submission', async () => {
    const toolRequest = recoveryRequest();
    const view = await prepareExternalAgentToolRequest({ projectId: 'project-1', request: toolRequest });
    expect(view).toMatchObject({ impact: { effect: 'canvas-write', externalSideEffect: false } });
    expect(view.summary).toContain('不会提交生成 POST');
    expect(view.summary).toContain('不会产生新的生成费用');
  });

  it('returns a typed denial without changing canvas revision or history', async () => {
    const toolRequest = request();
    await prepareExternalAgentToolRequest({ projectId: 'project-1', request: toolRequest });
    const before = useCanvasStore.getState();
    const result = await resolveExternalAgentToolApproval({
      projectId: 'project-1',
      request: toolRequest,
      approve: false,
    });
    const after = useCanvasStore.getState();

    expect(result.status).toBe('denied');
    expect(after.revision).toBe(before.revision);
    expect(after.history).toEqual(before.history);
    expect(after.nodes).toEqual(before.nodes);
    expect(commandMocks.resolve).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      callId: 'call-1',
      resolution: expect.objectContaining({ outcome: 'denied', errorCode: 'user_denied' }),
    }));
  });

  it('returns a terminal error after application failure without changing canvas state', async () => {
    const toolRequest = assetReadRequest();
    await prepareExternalAgentToolRequest({ projectId: 'project-1', request: toolRequest });
    const before = useCanvasStore.getState();
    const revisionBefore = before.revision;
    const historyBefore = structuredClone(before.history);
    const nodesBefore = structuredClone(before.nodes);

    const result = await resolveExternalAgentToolApproval({
      projectId: 'project-1',
      request: toolRequest,
      approve: true,
    });

    expect(result).toMatchObject({
      status: 'error',
      error: expect.stringMatching(/The requested canvas image no longer exists|temporary resource/i),
    });
    expect(commandMocks.resolve).toHaveBeenLastCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      callId: 'asset-call-1',
      resolution: expect.objectContaining({ outcome: 'error', errorCode: 'canvas_tool_failed' }),
    }));
    const after = useCanvasStore.getState();
    expect(after.revision).toBe(revisionBefore);
    expect(after.history).toEqual(historyBefore);
    expect(after.nodes).toEqual(nodesBefore);

    commandMocks.resolve.mockRejectedValueOnce(new Error('native tool call already resolved'));
    await expect(resolveExternalAgentToolApproval({
      projectId: 'project-1',
      request: toolRequest,
      approve: true,
    })).rejects.toThrow(/already resolved/i);
    expect(useCanvasStore.getState()).toMatchObject({
      revision: revisionBefore,
      history: historyBefore,
      nodes: nodesBefore,
    });
  });

  it('throws when the terminal resolution cannot be delivered to the native session', async () => {
    const toolRequest = request();
    await prepareExternalAgentToolRequest({ projectId: 'project-1', request: toolRequest });
    commandMocks.resolve.mockRejectedValueOnce(new Error('native session closed'));

    await expect(resolveExternalAgentToolApproval({
      projectId: 'project-1',
      request: toolRequest,
      approve: false,
    })).rejects.toThrow(/native session closed/i);
    expect(useCanvasStore.getState()).toMatchObject({ revision: 0, history: { past: [], future: [] } });
  });

  it('allows external agents to query profile knowledge via profile_search', async () => {
    const toolRequest: ExternalAgentToolRequest = {
      version: 1,
      runtime: 'claude',
      sessionId: 'session-2',
      turnId: 'turn-2',
      callId: 'profile-search-1',
      toolName: 'profile_search',
      arguments: { query: 'minimax', limit: 3 },
    };

    const approvalView = await prepareExternalAgentToolRequest({
      projectId: 'project-1',
      request: toolRequest,
    });
    expect(approvalView.toolName).toBe('profile_search');

    const result = await resolveExternalAgentToolApproval({
      projectId: 'project-1',
      request: toolRequest,
      approve: true,
    });

    expect(result.status).toBe('approved');
    expect(result.output).toBeDefined();
    const searchOutput = result.output as { items: unknown[]; total: number };
    expect(searchOutput.items.length).toBeGreaterThan(0);
  });

  it('allows external agents to manage production plans via production_plan', async () => {
    const toolRequest: ExternalAgentToolRequest = {
      version: 1,
      runtime: 'codex',
      sessionId: 'session-3',
      turnId: 'turn-3',
      callId: 'plan-create-1',
      toolName: 'production_plan',
      arguments: {
        action: 'create',
        createInput: {
          title: 'External Agent TVC Plan',
          workflow: { id: 'general_video' },
          scope: { deliverables: ['tvc_preview'] },
          stageOutline: [
            { id: 'script', order: 1, name: 'Script breakdown', role: 'scriptwriter', promptPackageIds: [] },
          ],
        },
      },
    };

    const approvalView = await prepareExternalAgentToolRequest({
      projectId: 'project-1',
      request: toolRequest,
    });
    expect(approvalView.toolName).toBe('production_plan');

    const result = await resolveExternalAgentToolApproval({
      projectId: 'project-1',
      request: toolRequest,
      approve: true,
    });

    if (result.status === 'error') {
      throw new Error(`Production plan failed: ${result.error}`);
    }
    expect(result.status).toBe('approved');
    const plan = result.output as { id: string; workflow: { id: string }; revision: number };
    expect(plan.id).toBeDefined();
    expect(plan.workflow.id).toBe('general_video');
    expect(plan.revision).toBe(1);
  });
});
