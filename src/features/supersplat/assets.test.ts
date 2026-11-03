import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { gaussianAssets } from './assets';

describe('local Gaussian assets', () => {
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
