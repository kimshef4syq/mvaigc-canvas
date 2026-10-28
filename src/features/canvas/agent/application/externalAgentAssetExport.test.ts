import { beforeEach, describe, expect, it, vi } from 'vitest';

const saveImageSourceToPath = vi.fn();
const saveVideoSourceToPath = vi.fn();
const saveAudioSourceToPath = vi.fn();

vi.mock('@/commands/image', () => ({
  saveImageSourceToPath: (...args: unknown[]) => saveImageSourceToPath(...args),
  saveVideoSourceToPath: (...args: unknown[]) => saveVideoSourceToPath(...args),
  saveAudioSourceToPath: (...args: unknown[]) => saveAudioSourceToPath(...args),
}));

vi.mock('@/stores/canvasStore', () => ({ useCanvasStore: { getState: () => ({ nodes: [] }) } }));
vi.mock('@/features/canvas/application/canvasAssetCatalog', () => ({
  buildCanvasAssetCatalog: () => [{
    id: 'asset-1', nodeId: 'n1', kind: 'video', title: 't', sourceLabel: 's', order: 0,
    url: '/abs/originals/clip.mp4',
  }],
}));

import { exportCanvasAsset } from './externalAgentAssetExport';

beforeEach(() => {
  saveImageSourceToPath.mockReset().mockResolvedValue('/hypit/imports/asset-1.png');
  saveVideoSourceToPath.mockReset().mockResolvedValue('/hypit/imports/asset-1.mp4');
  saveAudioSourceToPath.mockReset().mockResolvedValue('/hypit/imports/asset-1.wav');
});

describe('exportCanvasAsset', () => {
  it('copies the original bytes and never touches the preview url', async () => {
    const result = await exportCanvasAsset('asset-1', '/hypit');
    expect(result).toEqual({ assetId: 'asset-1', kind: 'video', path: '/hypit/imports/asset-1.mp4' });
    expect(saveVideoSourceToPath).toHaveBeenCalledWith('/abs/originals/clip.mp4', '/hypit/imports/asset-1.mp4');
  });

  it('explains a missing Hypit project directory instead of building a null path', async () => {
    await expect(exportCanvasAsset('asset-1', null)).rejects.toThrow(/Hypit project/i);
    expect(saveVideoSourceToPath).not.toHaveBeenCalled();
  });

  it('rejects an unknown asset id', async () => {
    await expect(exportCanvasAsset('missing', '/hypit')).rejects.toThrow(/no longer exists/i);
  });
});

describe('exported paths survive result redaction', () => {
  it('keeps the imports/ path the bridge itself produced', async () => {
    const { redactSensitiveValue } = await import('./agentRedaction');
    const exported = '/Users/me/Library/Application Support/app/hypit-projects/p-abcdef01/imports/asset-1.mp4';
    expect(redactSensitiveValue({ assetId: 'asset-1', kind: 'video', path: exported }))
      .toEqual({ assetId: 'asset-1', kind: 'video', path: exported });
  });

  it('still redacts an arbitrary absolute path', async () => {
    const { redactSensitiveValue } = await import('./agentRedaction');
    expect(redactSensitiveValue('/Users/me/Documents/private/secret.png')).toBe('[redacted-path]');
  });
});
