import { describe, expect, it } from 'vitest';
import { getEdgeSelectionFocus } from './edgeSelectionFocus';

describe('edge selection focus', () => {
  it('highlights direct incoming edges and dims outgoing and unrelated edges', () => {
    const nodes = [{ id: 'source' }, { id: 'selected', selected: true }, { id: 'downstream' }];
    expect(getEdgeSelectionFocus(nodes, 'selected')).toBe('upstream');
    expect(getEdgeSelectionFocus(nodes, 'downstream')).toBe('dimmed');
    expect(getEdgeSelectionFocus(nodes, 'source')).toBe('dimmed');
  });

  it('combines the incoming edges of a multi-selection', () => {
    const nodes = [{ id: 'a', selected: true }, { id: 'b', selected: true }, { id: 'other' }];
    expect(getEdgeSelectionFocus(nodes, 'a')).toBe('upstream');
    expect(getEdgeSelectionFocus(nodes, 'b')).toBe('upstream');
    expect(getEdgeSelectionFocus(nodes, 'other')).toBe('dimmed');
  });

  it('restores default appearance when selection is cleared, including after a cached read', () => {
    const selected = [{ id: 'a', selected: true }];
    expect(getEdgeSelectionFocus(selected, 'a')).toBe('upstream');
    const cleared = selected.map((node) => ({ ...node, selected: false }));
    expect(getEdgeSelectionFocus(cleared, 'a')).toBe('default');
    expect(getEdgeSelectionFocus(cleared, 'unrelated')).toBe('default');
  });

  it('ignores hidden selected nodes and handles an empty canvas', () => {
    expect(getEdgeSelectionFocus([{ id: 'hidden', selected: true, hidden: true }], 'other')).toBe('default');
    expect(getEdgeSelectionFocus([], 'other')).toBe('default');
  });
});
