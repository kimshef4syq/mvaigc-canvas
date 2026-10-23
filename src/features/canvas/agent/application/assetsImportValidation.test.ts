import { beforeEach, describe, expect, it, vi } from 'vitest';

const inspectImportMediaPaths = vi.fn();
const prepareNodeImage = vi.fn();
vi.mock('@/commands/image', () => ({
  inspectImportMediaPaths: (...a: unknown[]) => inspectImportMediaPaths(...a),
}));
vi.mock('@/features/canvas/application/imageData', () => ({
  prepareNodeImage: (...a: unknown[]) => prepareNodeImage(...a),
}));
vi.mock('@/stores/canvasStore', () => ({ useCanvasStore: { getState: () => ({ nodes: [] }) } }));
vi.mock('@/stores/projectStore', () => ({
  useProjectStore: { getState: () => ({ currentProjectId: 'p1' }) },
}));

import { validateImportFilesForTest } from './externalAgentCanvasBridge';

beforeEach(() => {
  inspectImportMediaPaths.mockReset().mockResolvedValue([
    { path: '/a.mp4', exists: true, isFile: true, bytes: 1024 },
  ]);
  prepareNodeImage.mockReset();
});

describe('assets_import validation precedes side effects', () => {
  it('refuses a symlink or directory before preparing any media', async () => {
    inspectImportMediaPaths.mockResolvedValue([{ path: '/dir', exists: true, isFile: false, bytes: 0 }]);
    await expect(validateImportFilesForTest([{ path: '/dir', kind: 'video' }])).rejects.toThrow(/symlink|regular file/i);
    expect(prepareNodeImage).not.toHaveBeenCalled();
  });

  it('refuses a path that does not exist', async () => {
    inspectImportMediaPaths.mockResolvedValue([{ path: '/gone.mp4', exists: false, isFile: false, bytes: 0 }]);
    await expect(validateImportFilesForTest([{ path: '/gone.mp4', kind: 'video' }])).rejects.toThrow(/does not exist/i);
  });

  it('refuses a file over the kind size limit', async () => {
    inspectImportMediaPaths.mockResolvedValue([
      { path: '/big.png', exists: true, isFile: true, bytes: 65 * 1024 * 1024 },
    ]);
    await expect(validateImportFilesForTest([{ path: '/big.png', kind: 'image' }])).rejects.toThrow(/size limit/i);
  });
});

describe('assets_import kind matches the file extension', () => {
  it('refuses an explicit kind that contradicts the extension', async () => {
    inspectImportMediaPaths.mockResolvedValue([
      { path: '/x/still.png', exists: true, isFile: true, bytes: 2048 },
    ]);
    await expect(validateImportFilesForTest([{ path: '/x/still.png', kind: 'video' }]))
      .rejects.toThrow(/kind|extension/i);
  });

  it('accepts an explicit kind that agrees with the extension', async () => {
    inspectImportMediaPaths.mockResolvedValue([
      { path: '/x/clip.mp4', exists: true, isFile: true, bytes: 2048 },
    ]);
    await expect(validateImportFilesForTest([{ path: '/x/clip.mp4', kind: 'video' }])).resolves.toBeUndefined();
  });
});
