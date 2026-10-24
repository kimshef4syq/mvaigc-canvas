import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import type { ExternalAgentEventV1 } from '@/commands/externalAgent';

const mocks = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  handler: null as ((event: ExternalAgentEventV1) => void) | null,
  dispose: vi.fn(),
  unsubscribeProject: vi.fn(),
  inspect: vi.fn(),
  replay: vi.fn(async () => 0),
  resolve: vi.fn(),
  prepare: vi.fn(),
  deliver: vi.fn(async () => undefined),
  projectId: 'project-1' as string | null,
}));
vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: (effect: () => void | (() => void)) => { mocks.effects.push(effect); },
}));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }));
vi.mock('@/stores/projectStore', () => ({
  useProjectStore: {
    getState: () => ({ currentProjectId: mocks.projectId }),
    subscribe: () => mocks.unsubscribeProject,
  },
}));
vi.mock('@/commands/externalAgent', () => ({
  inspectExternalAgentConnection: mocks.inspect,
  replayExternalAgentPendingToolCalls: mocks.replay,
  resolveExternalAgentToolCall: mocks.deliver,
  listenExternalAgentEvents: vi.fn(async (handler) => {
    mocks.handler = handler;
    return mocks.dispose;
  }),
}));
vi.mock('../application/externalAgentCanvasBridge', () => ({
  prepareExternalAgentToolRequest: mocks.prepare,
  resolveExternalAgentToolApproval: mocks.resolve,
}));

import {
  useExternalAgentApprovals,
  useExternalAgentApprovalStore,
  resolveExternalAgentApproval,
} from './useExternalAgentApprovals';
import { listenExternalAgentEvents } from '@/commands/externalAgent';

function Snapshot() {
  const state = useExternalAgentApprovals();
  return <span>{state.pendingApprovals.length}:{String(state.approvalBusy)}</span>;
}

it('shares one listener and queue between canvas and settings, and resolves each request once', async () => {
  mocks.inspect.mockResolvedValue({
    connectionId: 'connection-1',
    status: 'connected',
    project: { id: 'project-1' },
    expiresAt: Date.now() + 60_000,
    permissionMode: 'manual',
  });
  mocks.prepare.mockResolvedValue({ summary: 'Create a node', impact: { summary: 'One node' } });
  let complete: (() => void) | undefined;
  mocks.resolve.mockImplementation(() => new Promise((resolve) => {
    complete = () => resolve({ status: 'approved' });
  }));
  renderToStaticMarkup(<Snapshot />);
  renderToStaticMarkup(<Snapshot />);
  const effects = mocks.effects.splice(0);
  const cleanups = effects.map((effect) => effect());
  try {
    await vi.waitFor(() => expect(mocks.replay).toHaveBeenCalledTimes(1));
    expect(listenExternalAgentEvents).toHaveBeenCalledTimes(1);
    const event: ExternalAgentEventV1 = {
      schemaVersion: 1, sessionId: 'connection-1', runtime: 'claude', turnId: 'turn-1',
      kind: 'toolRequested', message: null, data: null,
      toolCall: { callId: 'call-1', name: 'canvas_command', input: {}, requiresApproval: true },
    };
    mocks.handler?.(event);
    mocks.handler?.(event);
    await vi.waitFor(() => expect(useExternalAgentApprovalStore.getState().pendingApprovals).toHaveLength(1));
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    const firstDecision = resolveExternalAgentApproval(true);
    await resolveExternalAgentApproval(true);
    expect(mocks.resolve).toHaveBeenCalledTimes(1);
    expect(useExternalAgentApprovalStore.getState().approvalBusy).toBe(true);
    complete?.();
    await firstDecision;
    expect(useExternalAgentApprovalStore.getState().pendingApprovals).toHaveLength(0);
    expect(useExternalAgentApprovalStore.getState().approvalBusy).toBe(false);
    cleanups[0]?.();
    expect(mocks.dispose).not.toHaveBeenCalled();
    cleanups[1]?.();
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
  } finally {
    // Cleanup callbacks are already consumed above on success.
    if (!mocks.dispose.mock.calls.length) cleanups.forEach((cleanup) => cleanup?.());
  }
});
