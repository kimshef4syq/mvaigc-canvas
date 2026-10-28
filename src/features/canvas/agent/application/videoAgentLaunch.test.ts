import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  const connection = { connectionId: 'c1', project: { id: 'p1' }, status: 'ready', expiresAt: Date.now() + 100000,
    hypitProjectDir: '/project one', scope: ['canvas_command', 'asset_read', 'diagnostics', 'assets_import'] };
  return {
    project: { currentProjectId: 'p1', currentProject: { id: 'p1', name: 'Project' } },
    nodes: [{ id: 'n1', type: 'videoNode', data: { videoUrl: '/source/version-one.mp4' } }],
    connection, inspect: vi.fn(), create: vi.fn(), launch: vi.fn(), save: vi.fn(), invoke: vi.fn(), setConnection: vi.fn(),
  };
});
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@/commands/externalAgent', () => ({ inspectExternalAgentConnection: mocks.inspect,
  createExternalAgentConnection: mocks.create, revokeExternalAgentConnection: vi.fn().mockResolvedValue(undefined), launchVideoAgent: mocks.launch }));
vi.mock('@/commands/image', () => ({ saveVideoSourceToPath: mocks.save }));
vi.mock('@/stores/projectStore', () => ({ useProjectStore: { getState: () => mocks.project, subscribe: () => () => {} } }));
vi.mock('@/stores/canvasStore', () => ({ useCanvasStore: { getState: () => ({ nodes: mocks.nodes }) } }));
vi.mock('@/stores/settingsStore', () => ({ useSettingsStore: { getState: () => ({ mvaigcAccount: 'a', mvaigcPassword: 'p', mvaigcPort: 9090 }) } }));
vi.mock('../ui/useExternalAgentApprovals', () => ({ setExternalAgentConnection: mocks.setConnection }));
import { openVideoAgent } from './videoAgentLaunch';

describe('video agent launch orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.project.currentProjectId = 'p1';
    mocks.nodes[0] = { id: 'n1', type: 'videoNode', data: { videoUrl: '/source/version-one.mp4' } };
    mocks.inspect.mockResolvedValue(mocks.connection);
    mocks.create.mockResolvedValue(mocks.connection);
    mocks.save.mockImplementation(async (_source: string, path: string) => path);
    mocks.launch.mockResolvedValue({ launchId: 'l1' });
    mocks.invoke.mockResolvedValue(undefined);
  });
  it('passes the selected reference and runtime without global CLI configuration', async () => {
    await openVideoAgent({ nodeId: 'n1', runtime: 'codex' });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.save.mock.calls[0][0]).toBe('/source/version-one.mp4');
    expect(mocks.launch).toHaveBeenCalledWith(expect.objectContaining({ connectionId: 'c1', projectId: 'p1', runtime: 'codex', assetId: 'n1:video', nodeId: 'n1' }));
    expect(mocks.launch.mock.calls[0][0].referencePath).toMatch(/^\/project one\/imports\/n1%3Avideo-[a-f0-9]+\.mp4$/);
  });
  it('snapshots the displayed video before asynchronous preparation', async () => {
    mocks.invoke.mockImplementation(async () => { mocks.nodes[0].data.videoUrl = '/source/version-two.mp4'; });
    await openVideoAgent({ nodeId: 'n1', runtime: 'claude' });
    expect(mocks.save.mock.calls[0][0]).toBe('/source/version-one.mp4');
  });
  it('aborts if the user switches projects during preparation', async () => {
    mocks.invoke.mockImplementation(async () => { mocks.project.currentProjectId = 'p2'; });
    await expect(openVideoAgent({ nodeId: 'n1', runtime: 'codex' })).rejects.toThrow('画布已切换');
    expect(mocks.launch).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('does not export or launch a missing reference', async () => {
    await expect(openVideoAgent({ nodeId: 'gone', runtime: 'claude' })).rejects.toThrow('尚未就绪');
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it('creates a connection with automatic reads and confirmed imports only when needed', async () => {
    mocks.inspect.mockResolvedValue({ status: 'expired' });
    await openVideoAgent({ nodeId: 'n1', runtime: 'claude' });
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p1', permissionMode: 'collaboration' }));
    expect(mocks.create.mock.calls[0][0].tools.map((tool: { name: string }) => tool.name)).toContain('assets_import');
  });
  it('exports the displayed history entry even when legacy top-level localVideoUrl is stale', async () => {
    mocks.nodes[0].type = 'aiVideoNode';
    Object.assign(mocks.nodes[0].data, {
      localVideoUrl: '/source/stale-version.mp4', mainVideoIndex: 0,
      videos: [{ id: 'current', videoUrl: '/source/current.mp4', localVideoUrl: '/source/current.mp4', thumbnailUrl: null, aspectRatio: '16:9', createdAt: 1 }],
    });
    await openVideoAgent({ nodeId: 'n1', runtime: 'codex' });
    expect(mocks.save.mock.calls[0][0]).toBe('/source/current.mp4');
  });

});
