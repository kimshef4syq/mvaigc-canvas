import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(), submit: vi.fn(), poll: vi.fn(), put: vi.fn(), get: vi.fn(), update: vi.fn(),
  nodes: [{ id: 'g', data: {} }],
  providers: [{ id: 'p', apiStyle: 'comfyui', mediaType: 'gaussian', models: ['workflow'] }],
}));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: mocks.invoke }));
vi.mock('@/stores/canvasStore', () => ({ useCanvasStore: { getState: () => ({ nodes: mocks.nodes, updateNodeData: mocks.update }) } }));
vi.mock('@/stores/customProvidersStore', () => ({ useCustomProvidersStore: { getState: () => ({ providers: mocks.providers }) }, customProviderMediaType: () => 'gaussian' }));
vi.mock('@/features/supersplat/assets', () => ({ gaussianAssets: { put: mocks.put, get: mocks.get } }));
vi.mock('../infrastructure/customProviderGateway', () => ({ createComfyUITransport: () => ({}), comfyUIModelDownloadRequest: () => ({ url: 'http://server/view', headers: {} }) }));
vi.mock('../infrastructure/comfyuiGateway', () => ({ parseComfyUIConfig: () => ({}), submitComfyUIWorkflow: mocks.submit, pollComfyUIWorkflow: mocks.poll }));
vi.mock('./imageData', () => ({ imageUrlToDataUrl: async () => 'data:image/png;base64,AAAA' }));
import { generateGaussian } from './gaussianGeneration';
describe('Gaussian generation materialization', () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.nodes = [{ id: 'g', data: {} }];
    mocks.submit.mockResolvedValue({ prompt_id: 'prompt' });
    mocks.poll.mockResolvedValue('http://server/view?filename=idol.ply');
    mocks.invoke.mockResolvedValue(btoa('ply\n'));
    mocks.get.mockResolvedValue(undefined);
  });
  it('selects the asset only after storage succeeds', async () => {
    await generateGaussian('g', 'p', 'image');
    expect(mocks.put).toHaveBeenCalledWith(expect.objectContaining({ sourceName: 'idol.ply', source: expect.any(Blob) }));
    expect(mocks.update).toHaveBeenCalledWith('g', expect.objectContaining({ assetId: expect.stringContaining('generated-') }));
    expect(mocks.update.mock.lastCall?.[1]).toMatchObject({ gaussianGeneration: { phase: 'succeeded' } });
  });
  it('retries downloads without submitting or polling again and preserves old asset on failure', async () => {
    mocks.invoke.mockRejectedValue(new Error('download failed'));
    await generateGaussian('g', 'p', undefined, { id: 'stable', providerId: 'p', promptId: 'prompt', resultUrl: 'http://server/view', startedAt: 1, phase: 'failed' });
    expect(mocks.submit).not.toHaveBeenCalled(); expect(mocks.poll).not.toHaveBeenCalled(); expect(mocks.put).not.toHaveBeenCalled();
    expect(mocks.update.mock.calls.every(call => !('assetId' in call[1]))).toBe(true);
    expect(mocks.update.mock.lastCall?.[1]).toMatchObject({ gaussianGeneration: { phase: 'failed', error: 'download failed' } });
  });
  it('does not restore a deleted node when its task finishes', async () => {
    mocks.invoke.mockImplementation(async () => { mocks.nodes = []; return btoa('ply\n'); });
    await generateGaussian('g', 'p', 'image');
    expect(mocks.update.mock.calls.every(call => !('assetId' in call[1]))).toBe(true);
  });
});
