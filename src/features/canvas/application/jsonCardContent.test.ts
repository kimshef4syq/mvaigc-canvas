import { describe, expect, it } from 'vitest';

import { applyJsonCardTextPatch } from './jsonCardContent';

describe('applyJsonCardTextPatch', () => {
  it('parses a JSON object into parsedJson', () => {
    const patch = applyJsonCardTextPatch('{"a":1}');
    expect(patch).toMatchObject({ rawContent: '{"a":1}', parseError: null });
    expect(patch?.parsedJson).toEqual({ a: 1 });
  });

  it('parses a JSON array', () => {
    expect(applyJsonCardTextPatch('[{"n":1}]')?.parsedJson).toEqual([{ n: 1 }]);
  });

  it('keeps non-JSON text as raw content and flags the parse error', () => {
    const patch = applyJsonCardTextPatch('这就是一段普通文字');
    expect(patch).toEqual({
      rawContent: '这就是一段普通文字',
      parsedJson: null,
      parseError: '内容不是合法 JSON',
    });
  });

  it('returns null for blank content so the card is left untouched', () => {
    expect(applyJsonCardTextPatch('')).toBeNull();
    expect(applyJsonCardTextPatch('   \n  ')).toBeNull();
  });
});
