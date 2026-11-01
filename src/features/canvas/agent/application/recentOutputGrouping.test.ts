import { afterEach, describe, expect, it, vi } from 'vitest';
import { CANVAS_NODE_TYPES, type CanvasNode } from '@/features/canvas/domain/canvasNodes';
import { useCanvasStore } from '@/stores/canvasStore';
import { getCanvasNodeSize } from '@/features/canvas/application/canvasNodePlacement';
import { useProjectStore } from '@/stores/projectStore';
import {
  clearRecentOutputGrouping,
  groupRecentGeneratedOutputs,
  isEligibleForAutoGroup,
  recordComfyUiOutputs,
  recordExplicitGrouping,
  recordGeneratedOutputs,
  recordAgentCreatedNode,
} from './recentOutputGrouping';

const source = {
  id: 'source', type: CANVAS_NODE_TYPES.aiVideo, position: { x: 0, y: 0 },
  data: { prompt: '镜头', modelConfig: { entryId: 'custom:mvaigc-video:minimax_h3', duration: '4', resolution: '720p' } },
} as CanvasNode;
const video = (id: string, x: number, parentId?: string) => ({
  id, type: CANVAS_NODE_TYPES.video, position: { x, y: 100 },
  parentId,
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
    expect(isEligibleForAutoGroup('group-run', 'project')).toBe(true);
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

  it('exempts ComfyUI workflow outputs from auto-grouping (P201)', async () => {
    useCanvasStore.setState({ nodes: [source, video('one', 100), video('two', 800)], edges: [], revision: 0 });
    recordGeneratedOutputs('group-run', 'project', ['source'], ['one', 'two']);
    recordComfyUiOutputs('group-run', 'project');
    expect(isEligibleForAutoGroup('group-run', 'project')).toBe(false);
    expect(await groupRecentGeneratedOutputs('group-run', 'project')).toBe(false);
  });

  it('does not auto-group when only a single node is generated (P201)', async () => {
    useCanvasStore.setState({ nodes: [source, video('one', 100)], edges: [], revision: 0 });
    recordGeneratedOutputs('group-run', 'project', ['source'], ['one']);
    expect(isEligibleForAutoGroup('group-run', 'project')).toBe(false);
    expect(await groupRecentGeneratedOutputs('group-run', 'project')).toBe(false);
  });

  it('does not touch or regroup nodes that already belong to an existing group (A28)', async () => {
    useCanvasStore.setState({
      nodes: [
        source,
        video('one', 100, 'existing-group-id'),
        video('two', 800),
      ],
      edges: [],
      revision: 0,
    });
    recordGeneratedOutputs('group-run', 'project', ['source'], ['one', 'two']);
    // 'one' has parentId, so only 'two' is eligible -> less than 2 eligible nodes -> no grouping
    expect(isEligibleForAutoGroup('group-run', 'project')).toBe(false);
    expect(await groupRecentGeneratedOutputs('group-run', 'project')).toBe(false);
  });
  it('keeps new shot sources beside their results and clears existing content as one task', async () => {
    const old = { ...source, id: 'old', measured: { width: 1600, height: 1200 } } as CanvasNode;
    const first = { ...source, id: 'shot-1', position: { x: 100, y: 100 }, data: { ...source.data, shotNumber: 1 } } as CanvasNode;
    const second = { ...source, id: 'shot-2', position: { x: 9000, y: 8000 }, data: { ...source.data, shotNumber: 2 } } as CanvasNode;
    useCanvasStore.setState({ nodes: [old, first, second, video('one', 4000), video('two', 15000)], edges: [], revision: 0 });
    vi.spyOn(useProjectStore, 'getState').mockReturnValue({
      currentProjectId: 'project', saveCurrentProject: vi.fn(), waitForProjectPersistence: vi.fn(async () => undefined),
    } as unknown as ReturnType<typeof useProjectStore.getState>);
    recordAgentCreatedNode('group-run', 'project', 'shot-1');
    recordAgentCreatedNode('group-run', 'project', 'shot-2');
    recordGeneratedOutputs('group-run', 'project', ['shot-1'], ['one']);
    recordGeneratedOutputs('group-run', 'project', ['shot-2'], ['two']);
    expect(await groupRecentGeneratedOutputs('group-run', 'project')).toBe(true);
    const nodes = useCanvasStore.getState().nodes;
    const group = nodes.find((node) => node.type === CANVAS_NODE_TYPES.group)!;
    expect(nodes.find((node) => node.id === 'old')?.position).toEqual(old.position);
    expect(nodes.filter((node) => node.parentId === group.id)).toHaveLength(4);
    for (const [sourceId, resultId] of [['shot-1', 'one'], ['shot-2', 'two']]) {
      const shot = nodes.find((node) => node.id === sourceId)!;
      const result = nodes.find((node) => node.id === resultId)!;
      expect(result.position.y).toBe(shot.position.y);
      // 结果节点贴在源节点右侧：间距随源节点实际宽度变化（生成视频节点现为
      // 384×288，与「生成图片」同尺寸），所以按真实尺寸推导而不是写死。
      expect(result.position.x - shot.position.x).toBe(getCanvasNodeSize(shot).width + 48);
    }
    const width = Number(group.style?.width);
    const height = Number(group.style?.height);
    expect(group.position.x >= 1618 || group.position.x + width <= -18
      || group.position.y >= 1218 || group.position.y + height <= -18).toBe(true);
  });

  it('also arranges a single new generation node with its result', async () => {
    useCanvasStore.setState({ nodes: [source, video('one', 9000)], edges: [], revision: 0 });
    vi.spyOn(useProjectStore, 'getState').mockReturnValue({
      currentProjectId: 'project', saveCurrentProject: vi.fn(), waitForProjectPersistence: vi.fn(async () => undefined),
    } as unknown as ReturnType<typeof useProjectStore.getState>);
    recordAgentCreatedNode('group-run', 'project', source.id);
    recordGeneratedOutputs('group-run', 'project', [source.id], ['one']);
    expect(isEligibleForAutoGroup('group-run', 'project')).toBe(true);
    expect(await groupRecentGeneratedOutputs('group-run', 'project')).toBe(true);
    expect(useCanvasStore.getState().nodes.filter((node) => node.parentId)).toHaveLength(2);
  });

});
