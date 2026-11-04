import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { gaussianAssets, gaussianSourceName } from './assets';

describe('local Gaussian assets', () => {
  it('retains the original filename when a legacy asset is renamed', async () => {
    const id = crypto.randomUUID();
    const source = new File(['model'], 'scene.ply');
    await gaussianAssets.put({ id, name: 'scene.ply', source, updatedAt: 1 });
    const renamed = (await gaussianAssets.get(id))!;
    expect(gaussianSourceName(renamed)).toBe('scene.ply');
    await gaussianAssets.put({ ...renamed, name: '新名字', sourceName: gaussianSourceName(renamed) });
    expect(gaussianSourceName((await gaussianAssets.get(id))!)).toBe('scene.ply');
    expect(await (await gaussianAssets.get(id))!.source.text()).toBe('model');
    await gaussianAssets.remove(id);
  });

  it('recovers a filename from a File when available', () => {
    expect(gaussianSourceName({ id: '1', name: '模型', source: new File(['model'], 'scene.ply'), updatedAt: 1 })).toBe('scene.ply');
  });

  it('prefers the explicit source filename for generated or folder assets', () => {
    expect(gaussianSourceName({ id: '1', name: '模型', sourceName: 'scene.lcc2', source: new Blob(), updatedAt: 1 })).toBe('scene.lcc2');
  });

  it('persists source and edited document across independent reads', async () => {
    const id = crypto.randomUUID();
    const source = new File(['model'], 'scene.ply');
    await gaussianAssets.put({ id, name: source.name, source, updatedAt: 1 });
    const loaded = await gaussianAssets.get(id);
    expect(loaded?.name).toBe('scene.ply');
    expect(loaded?.source.size).toBe(5);
    await gaussianAssets.put({ ...loaded!, document: new Blob(['edited']), updatedAt: 2 });
    expect((await gaussianAssets.get(id))?.document?.size).toBe(6);
    expect((await gaussianAssets.list()).some(asset => asset.id === id)).toBe(true);
    await gaussianAssets.remove(id);
    expect(await gaussianAssets.get(id)).toBeUndefined();
  });
});
