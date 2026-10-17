import { beforeEach, describe, expect, it, vi } from 'vitest';

const { upsertProjectRecord } = vi.hoisted(() => ({
  upsertProjectRecord: vi.fn(),
}));

vi.mock('@/commands/projectState', () => ({
  deleteProjectRecord: vi.fn(async () => {}),
  getProjectRecord: vi.fn(async () => null),
  listProjectSummaries: vi.fn(async () => []),
  renameProjectRecord: vi.fn(async () => {}),
  updateProjectViewportRecord: vi.fn(async () => {}),
  upsertProjectRecord,
}));

import { useProjectStore } from './projectStore';
import { useCanvasStore } from './canvasStore';

describe('project persistence failure propagation', () => {
  beforeEach(() => {
    upsertProjectRecord.mockReset();
    useProjectStore.setState({
      projects: [],
      currentProjectId: null,
      currentProject: null,
      isHydrated: true,
      isOpeningProject: false,
    });
  });

  it('rejects the persistence checkpoint when the project record write fails', async () => {
    upsertProjectRecord.mockRejectedValueOnce(new Error('disk unavailable'));
    const projectId = useProjectStore.getState().createProject('Failure case');

    await expect(
      useProjectStore.getState().waitForProjectPersistence(projectId),
    ).rejects.toThrow('disk unavailable');
  });

  it('clears an earlier failure after a later successful write', async () => {
    upsertProjectRecord.mockRejectedValueOnce(new Error('temporary failure'));
    const failedProjectId = useProjectStore.getState().createProject('Failed once');
    await expect(
      useProjectStore.getState().waitForProjectPersistence(failedProjectId),
    ).rejects.toThrow('temporary failure');

    upsertProjectRecord.mockResolvedValueOnce(undefined);
    const recoveredProjectId = useProjectStore.getState().createProject('Recovered');
    await expect(
      useProjectStore.getState().waitForProjectPersistence(recoveredProjectId),
    ).resolves.toBeUndefined();
  });

  it('preserves stored nodes when save or close sees a fresh unhydrated canvas', async () => {
    upsertProjectRecord.mockResolvedValue(undefined);
    const nodes = [{ id: 'saved-image', type: 'uploadNode' as const, position: { x: 0, y: 0 }, data: { imageUrl: '/tmp/original.png', aspectRatio: '16:9' } }];
    const project = { id: 'unhydrated-project', name: 'Saved project', nodes, edges: [], nodeCount: 1, createdAt: 1, updatedAt: 1, viewport: { x: 0, y: 0, zoom: 1 }, history: { past: [], future: [] } };
    useProjectStore.setState({ currentProjectId: project.id, currentProject: project });
    useCanvasStore.setState({ nodes: [], edges: [], revision: 0, history: { past: [], future: [] } });
    useProjectStore.getState().saveCurrentProject([], []);
    expect(useProjectStore.getState().currentProject?.nodes).toHaveLength(1);
    expect(upsertProjectRecord).not.toHaveBeenCalled();
    useProjectStore.getState().closeProject();
    await useProjectStore.getState().waitForProjectPersistence(project.id);
    expect(JSON.parse(upsertProjectRecord.mock.calls[0][0].nodesJson)).toHaveLength(1);
  });

  it('still saves a deliberate clear of a loaded canvas', async () => {
    upsertProjectRecord.mockResolvedValue(undefined);
    const nodes = [{ id: 'saved-image', type: 'uploadNode' as const, position: { x: 0, y: 0 }, data: { imageUrl: '/tmp/original.png', aspectRatio: '16:9' } }];
    const project = { id: 'cleared-project', name: 'Saved project', nodes, edges: [], nodeCount: 1, createdAt: 1, updatedAt: 1, viewport: { x: 0, y: 0, zoom: 1 }, history: { past: [], future: [] } };
    useProjectStore.setState({ currentProjectId: project.id, currentProject: project });
    useCanvasStore.getState().setCanvasData(nodes, []);
    useCanvasStore.getState().clearCanvas();
    useProjectStore.getState().saveCurrentProject([], []);
    useProjectStore.getState().closeProject();
    await useProjectStore.getState().waitForProjectPersistence(project.id);
    const calls = upsertProjectRecord.mock.calls;
    expect(JSON.parse(calls[calls.length - 1][0].nodesJson)).toEqual([]);
  });
});
