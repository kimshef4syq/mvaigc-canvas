import { afterEach, describe, expect, it, vi } from 'vitest';
import { CANVAS_NODE_TYPES, type CanvasNode } from '@/features/canvas/domain/canvasNodes';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';
import {
  clearRecentOutputGrouping,
  groupRecentGeneratedOutputs,
  recordExplicitGrouping,
  recordGeneratedOutputs,
} from './recentOutputGrouping';

const source = {
  id: 'source', type: CANVAS_NODE_TYPES.aiVideo, position: { x: 0, y: 0 },
  data: { prompt: '镜头', modelConfig: { entryId: 'custom:mvaigc-video:minimax_h3', duration: '4', resolution: '720p' } },
} as CanvasNode;
const video = (id: string, x: number) => ({
  id, type: CANVAS_NODE_TYPES.video, position: { x, y: 100 },
  data: { videoUrl: `/tmp/${id}.mp4` },
}) as CanvasNode;

afterEach(() => {
  clearRecentOutputGrouping('group-run');
  vi.restoreAllMocks();
});

describe('current-turn generated output grouping', () => {
  it('lays out and groups two generated result nodes once', async () => {
    useCanvasStore.setState({ nodes: [source, video('one', 100), video('two', 800)], edges: [], revision: 0 });
    vi.spyOn(useProjectStore, 'getState').mockReturnValue({
      currentProjectId: 'project',
      saveCurrentProject: vi.fn(),
      waitForProjectPersistence: vi.fn(async () => undefined),
    } as unknown as ReturnType<typeof useProjectStore.getState>);
    recordGeneratedOutputs('group-run', 'project', ['source'], ['one', 'two']);
    expect(await groupRecentGeneratedOutputs('group-run', 'project')).toBe(true);
    const nodes = useCanvasStore.getState().nodes;
    const group = nodes.find((node) => node.type === CANVAS_NODE_TYPES.group);
    expect(group).toBeDefined();
    expect(nodes.filter((node) => node.parentId === group?.id).map((node) => node.id)).toEqual(['one', 'two']);
    expect(await groupRecentGeneratedOutputs('group-run', 'project')).toBe(false);
  });

  it('groups image generation results from an image source', async () => {
    const imageSource = { ...source, type: CANVAS_NODE_TYPES.imageEdit } as CanvasNode;
    const image = (id: string) => ({ id, type: CANVAS_NODE_TYPES.exportImage, position: { x: 0, y: 100 }, data: { imageUrl: `/tmp/${id}.png` } }) as CanvasNode;
    useCanvasStore.setState({ nodes: [imageSource, image('one'), image('two')], edges: [], revision: 0 });
    vi.spyOn(useProjectStore, 'getState').mockReturnValue({
      currentProjectId: 'project', saveCurrentProject: vi.fn(), waitForProjectPersistence: vi.fn(async () => undefined),
    } as unknown as ReturnType<typeof useProjectStore.getState>);
    recordGeneratedOutputs('group-run', 'project', ['source'], ['one', 'two']);
    expect(await groupRecentGeneratedOutputs('group-run', 'project')).toBe(true);
  });

  it('respects explicit grouping in the same run', async () => {
    useCanvasStore.setState({ nodes: [source, video('one', 100), video('two', 800)], edges: [], revision: 0 });
    recordGeneratedOutputs('group-run', 'project', ['source'], ['one', 'two']);
    recordExplicitGrouping('group-run', 'project');
    expect(await groupRecentGeneratedOutputs('group-run', 'project')).toBe(false);
  });
});
