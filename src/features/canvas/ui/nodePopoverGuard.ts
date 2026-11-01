const NODE_TOOLBAR_SELECTOR = '.react-flow__node-toolbar';

/**
 * Whether a pointer event landed on this node's own UI.
 *
 * A node's control panel renders inside `<NodeToolbar>`, which portals its
 * children into `.react-flow__renderer` — so it sits *outside* the node root
 * element. An outside-click guard that only tests the root would treat every
 * mousedown inside the panel as an outside click, unmounting the popover
 * before its buttons can receive a click.
 */
export function isPointerInsideNodeUi(
  eventTarget: EventTarget | null,
  nodeRoot: { contains: (node: Node | null) => boolean } | null | undefined,
  nodeId: string,
): boolean {
  if (!eventTarget) return false;
  if (nodeRoot?.contains(eventTarget as Node)) return true;

  const element = eventTarget as Element;
  if (typeof element.closest !== 'function') return false;
  const toolbar = element.closest(NODE_TOOLBAR_SELECTOR) as HTMLElement | null;
  const ids = toolbar?.dataset.id;
  return Boolean(ids && ids.split(/\s+/).includes(nodeId));
}
