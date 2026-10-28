import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { destination?: string }) => options?.destination ? `${key}:${options.destination}` : key,
    i18n: { language: 'en' },
  }),
}));

vi.mock('@/commands/externalAgent', () => ({
  createExternalAgentConnection: vi.fn(),
  inspectExternalAgentConnection: vi.fn(() => new Promise(() => undefined)),
  listenExternalAgentEvents: vi.fn(() => new Promise(() => undefined)),
  replayExternalAgentPendingToolCalls: vi.fn(),
  resolveExternalAgentToolCall: vi.fn(),
  revokeExternalAgentConnection: vi.fn(),
}));

vi.mock('../application/externalAgentCanvasBridge', () => ({
  prepareExternalAgentToolRequest: vi.fn(),
  resolveExternalAgentToolApproval: vi.fn(),
}));

import { ExternalAgentConnectionPanel } from './ExternalAgentConnectionPanel';
import { useExternalAgentApprovalStore } from './useExternalAgentApprovals';

describe('ExternalAgentConnectionPanel', () => {
  beforeEach(() => useExternalAgentApprovalStore.setState({ connection: null, pendingApprovals: [], automaticReads: [], approvalBusy: false }));
  it('explains the external process and explicit permission modes', () => {
    const markup = renderToStaticMarkup(React.createElement(ExternalAgentConnectionPanel, {
      projectId: 'project-1',
      projectName: 'Opening sequence',
      tools: [{
        name: 'canvas_command',
        description: 'Canvas only',
        inputSchema: { type: 'object' },
        requiresApproval: true,
      }],
    }));
    expect(markup).toContain('canvasAgent.externalMcp.title');
    expect(markup).toContain('canvasAgent.externalMcp.description');
    expect(markup).toContain('canvasAgent.externalMcp.permissionLabel');
    expect(markup).toContain('canvasAgent.externalMcp.modeHints.analysis');
    expect(markup).toContain('canvasAgent.externalMcp.modes.collaboration');
    expect(markup).toContain('canvasAgent.externalMcp.modes.manual');
    expect(markup).not.toContain('启动 Codex');
    expect(markup).not.toContain('启动 Claude');
  });
  it('offers the project terminal entry before manual connection setup', () => {
    const markup = renderToStaticMarkup(React.createElement(ExternalAgentConnectionPanel, { projectId: 'project-1', projectName: 'Project', tools: [] }));
    expect(markup).toContain('videoAgentLaunch.fromProject');
    expect(markup).toContain('canvasAgent.externalMcp.status.disconnected');
  });

});
