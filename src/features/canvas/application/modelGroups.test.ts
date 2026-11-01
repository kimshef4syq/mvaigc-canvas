import { describe, expect, it } from 'vitest';

import { groupModelsByBrand, type BrandedModel } from './modelGroups';

interface TestModel extends BrandedModel {
  id: string;
}

describe('groupModelsByBrand', () => {
  it('returns null when no model declares a vendor, so callers keep the flat list', () => {
    expect(groupModelsByBrand<TestModel>([
      { id: 'a' },
      { id: 'b' },
    ])).toBeNull();
  });

  it('groups by vendor and sorts groups by brand order', () => {
    const groups = groupModelsByBrand<TestModel>([
      { id: 'qwen', brand: 'Qwen', brandOrder: 3 },
      { id: 'gpt', brand: 'GPT', brandOrder: 0, brandTag: 'Recommend' },
      { id: 'nano', brand: 'Nano-Banana', brandOrder: 1, brandTag: 'New' },
      { id: 'wan', brand: 'Qwen', brandOrder: 3 },
    ])!;
    expect(groups.map((group) => group.brand)).toEqual(['GPT', 'Nano-Banana', 'Qwen']);
    expect(groups[0]).toMatchObject({ brand: 'GPT', tag: 'Recommend' });
    expect(groups[1]).toMatchObject({ brand: 'Nano-Banana', tag: 'New' });
    expect(groups[2].models.map((model) => model.id)).toEqual(['qwen', 'wan']);
    expect(groups[2].tag).toBeUndefined();
  });

  it('keeps the original order of models inside a vendor', () => {
    const groups = groupModelsByBrand<TestModel>([
      { id: 'c', brand: 'GPT', brandOrder: 0 },
      { id: 'a', brand: 'GPT', brandOrder: 0 },
      { id: 'b', brand: 'GPT', brandOrder: 0 },
    ])!;
    expect(groups[0].models.map((model) => model.id)).toEqual(['c', 'a', 'b']);
  });

  it('uses the first tagged model of a vendor as the vendor badge', () => {
    const groups = groupModelsByBrand<TestModel>([
      { id: 'a', brand: 'GPT', brandOrder: 0 },
      { id: 'b', brand: 'GPT', brandOrder: 0, brandTag: 'Recommend' },
    ])!;
    expect(groups[0].tag).toBe('Recommend');
  });
});
