import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CANVAS_NODE_TYPES } from '../domain/canvasNodes';
import { useCanvasDefaultsStore, type CanvasGenerationDefaults } from '@/stores/canvasDefaultsStore';
import { useCanvasStore } from '@/stores/canvasStore';

const defaults: CanvasGenerationDefaults = {
  image: { entryId: 'custom:image-provider:image-model', ratio: '9:16', extraParams: { resolutionType: '4K' } },
  video: { entryId: 'custom:video-provider:video-model', aspectRatio: '16:9', resolution: '1080p', duration: '8', extraParams: {} },
};

beforeEach(() => {
  useCanvasDefaultsStore.setState({ image: undefined, video: undefined });
  useCanvasStore.setState({ nodes: [], edges: [], history: { past: [], future: [] }, revision: 0 });
});
afterEach(() => useCanvasDefaultsStore.setState({ image: undefined, video: undefined }));

describe('canvas generation defaults', () => {
  it('uses defaults for both individual and batch creation while respecting explicit node parameters', () => {
    useCanvasDefaultsStore.setState(defaults);
    const store = useCanvasStore.getState();
    store.addNode(CANVAS_NODE_TYPES.imageEdit, { x: 0, y: 0 });
    store.addNodesBatch([{ type: CANVAS_NODE_TYPES.aiVideo, position: { x: 100, y: 0 } }]);
    const explicit = { ...defaults.image!, ratio: '1:1' };
    store.addNode(CANVAS_NODE_TYPES.imageEdit, { x: 200, y: 0 }, { modelConfig: explicit });
    const nodes = useCanvasStore.getState().nodes;
    expect(nodes[0].data.modelConfig).toEqual(defaults.image);
    expect(nodes[1].data.modelConfig).toEqual(defaults.video);
    expect(nodes[2].data.modelConfig).toEqual(explicit);
  });

  it('applies settings atomically, preserves content, skips running nodes and supports undo', () => {
    const store = useCanvasStore.getState();
    store.addNode(CANVAS_NODE_TYPES.imageEdit, { x: 0, y: 0 }, { prompt: 'Keep this prompt', imageUrl: 'keep.png' });
    store.addNode(CANVAS_NODE_TYPES.aiVideo, { x: 100, y: 0 }, { isGenerating: true });
    store.addNode(CANVAS_NODE_TYPES.aiVideo, { x: 200, y: 0 });
    const before = useCanvasStore.getState();
    before.applyGenerationDefaults(defaults);
    const after = useCanvasStore.getState();
    expect(after.nodes[0].data).toMatchObject({ prompt: 'Keep this prompt', imageUrl: 'keep.png', modelConfig: defaults.image });
    expect(after.nodes[1]).toBe(before.nodes[1]);
    expect(after.nodes[2].data.modelConfig).toEqual(defaults.video);
    expect(after.history.past.length).toBe(before.history.past.length + 1);
    after.undo();
    expect(useCanvasStore.getState().nodes).toEqual(before.nodes);
  });
});
