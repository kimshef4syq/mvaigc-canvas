import { describe, expect, it } from 'vitest';

import { isPointerInsideNodeUi } from './nodePopoverGuard';

interface FakeElement {
  dataset?: { id?: string };
  contains?: (node: unknown) => boolean;
  closest?: (selector: string) => FakeElement | null;
}

/** Test doubles stand in for DOM nodes; the guard only uses these members. */
const asTarget = (value: FakeElement | null) => value as unknown as EventTarget | null;
const asRoot = (value: FakeElement | null) =>
  value as unknown as { contains: (node: Node | null) => boolean } | null;

function nodeRoot(contains: boolean): FakeElement {
  return { contains: () => contains };
}

function target(closestToolbar: FakeElement | null): FakeElement {
  return { closest: () => closestToolbar };
}

describe('isPointerInsideNodeUi', () => {
  it('counts a click inside the node body as inside', () => {
    expect(isPointerInsideNodeUi(asTarget(target(null)), asRoot(nodeRoot(true)), 'node-1')).toBe(true);
  });

  it('counts a click inside this node’s portalled toolbar as inside', () => {
    // The control panel renders through NodeToolbar, which portals it into
    // `.react-flow__renderer` — outside the node root. Without this the
    // popover unmounts on mousedown and its buttons never receive a click.
    const toolbar: FakeElement = { dataset: { id: 'node-1' } };
    expect(isPointerInsideNodeUi(asTarget(target(toolbar)), asRoot(nodeRoot(false)), 'node-1')).toBe(true);
  });

  it('counts a click in another node’s toolbar as outside', () => {
    const otherToolbar: FakeElement = { dataset: { id: 'node-2 node-3' } };
    expect(isPointerInsideNodeUi(asTarget(target(otherToolbar)), asRoot(nodeRoot(false)), 'node-1')).toBe(false);
  });

  it('counts a click on the canvas as outside', () => {
    expect(isPointerInsideNodeUi(asTarget(target(null)), asRoot(nodeRoot(false)), 'node-1')).toBe(false);
  });

  it('counts a missing target as outside', () => {
    expect(isPointerInsideNodeUi(asTarget(null), asRoot(nodeRoot(false)), 'node-1')).toBe(false);
  });
});
