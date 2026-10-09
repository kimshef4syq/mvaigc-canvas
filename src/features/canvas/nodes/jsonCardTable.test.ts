import { describe, expect, it } from 'vitest';

import { createAutoDisplayFields, resolveStructuredTableGroups } from './JsonCardNode';

function tableFor(parsed: unknown) {
  const fields = createAutoDisplayFields(parsed);
  const groups = resolveStructuredTableGroups(parsed, fields);
  return { fields, groups };
}

describe('json card auto table (regression: auto columns)', () => {
  it('top-level array of objects → table rows with columns', () => {
    const parsed = [
      { 序号: 1, 时长: '2秒', 画面: '男孩助跑' },
      { 序号: 2, 时长: '3秒', 画面: '起脚射门' },
    ];
    const { fields, groups } = tableFor(parsed);
    console.log('TOP-LEVEL ARRAY fields=', JSON.stringify(fields), 'groups=', JSON.stringify(groups));
    expect(groups.length).toBeGreaterThan(0);
    expect(groups[0].rows.length).toBe(2);
    expect(groups[0].fields.map((f) => f.label)).toEqual(['序号', '时长', '画面']);
  });

  it('object with a nested array of objects → table', () => {
    const parsed = {
      分镜: [
        { 分镜序号: 1, 分镜时长: '2秒', 画面: '男孩助跑' },
        { 分镜序号: 2, 分镜时长: '3秒', 画面: '起脚射门' },
      ],
    };
    const { fields, groups } = tableFor(parsed);
    console.log('NESTED fields=', JSON.stringify(fields), 'groups=', JSON.stringify(groups));
    expect(groups.length).toBeGreaterThan(0);
    expect(groups[0].fields.map((f) => f.label)).toEqual(['分镜序号', '分镜时长', '画面']);
  });

  it('flat object → field blocks, no table', () => {
    const parsed = { 标题: '踢球的男孩', 时长: 5, 比例: '16:9' };
    const { fields, groups } = tableFor(parsed);
    console.log('FLAT fields=', JSON.stringify(fields), 'groups=', JSON.stringify(groups));
    expect(groups.length).toBe(0);
    expect(fields.length).toBe(3);
  });
});
