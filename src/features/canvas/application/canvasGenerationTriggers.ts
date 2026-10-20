import {
  CANVAS_NODE_TYPES,
  type CanvasNodeType,
} from '../domain/canvasNodes';
import type { CanvasEventBus } from './ports';

export const CANVAS_GENERATION_TRIGGER_NODE_TYPES = [
  CANVAS_NODE_TYPES.imageEdit,
  CANVAS_NODE_TYPES.aiVideo,
  CANVAS_NODE_TYPES.aiText,
  CANVAS_NODE_TYPES.aiAudio,
  CANVAS_NODE_TYPES.storyboardGen,
  CANVAS_NODE_TYPES.panorama,
] as const satisfies readonly CanvasNodeType[];

const GENERATION_TRIGGER_NODE_TYPE_SET = new Set<CanvasNodeType>(
  CANVAS_GENERATION_TRIGGER_NODE_TYPES,
);

export function supportsCanvasGenerationTrigger(nodeType: CanvasNodeType): boolean {
  return GENERATION_TRIGGER_NODE_TYPE_SET.has(nodeType);
}

export function subscribeCanvasGenerationTrigger(
  eventBus: CanvasEventBus,
  nodeType: CanvasNodeType,
  nodeId: string,
  trigger: () => void | Promise<void>,
): () => void {
  if (!supportsCanvasGenerationTrigger(nodeType)) {
    throw new Error(`Node type ${nodeType} has no registered generation trigger strategy.`);
  }
  let subscribed = true;
  const deliver = () => {
    if (!subscribed) return;
    const pending = pendingTriggers.get(nodeId);
    if (pending?.delivered) return;
    if (pending) pending.delivered = true;
    try {
      const task = trigger();
      if (task && typeof task.then === 'function') {
        void task.then(() => clearPendingTrigger(nodeId), (error) => {
          clearPendingTrigger(nodeId);
          console.error('Generation trigger failed', error);
        });
      } else {
        clearPendingTrigger(nodeId);
      }
    } catch (error) {
      clearPendingTrigger(nodeId);
      throw error;
    }
  };
  const unsubscribe = eventBus.subscribe('generation-node/trigger', ({ nodeId: requestedNodeId }) => {
    if (requestedNodeId === nodeId) deliver();
  });
  if (pendingTriggers.get(nodeId)?.bus === eventBus) {
    queueMicrotask(() => {
      if (pendingTriggers.get(nodeId)?.bus === eventBus && !pendingTriggers.get(nodeId)?.delivered) deliver();
    });
  }
  return () => { subscribed = false; unsubscribe(); };
}

// A trigger can arrive before React mounts an off-screen node. Keep it until
// that exact node subscribes; never replay a trigger that was already delivered.
const pendingTriggers = new Map<string, { bus: CanvasEventBus; timer: ReturnType<typeof setTimeout>; delivered: boolean }>();
const pendingListeners = new Set<() => void>();
export const getPendingGenerationTriggerCount = () => pendingTriggers.size;
export function subscribePendingGenerationTriggers(listener: () => void): () => void {
  pendingListeners.add(listener);
  return () => { pendingListeners.delete(listener); };
}
function clearPendingTrigger(nodeId: string): void {
  const pending = pendingTriggers.get(nodeId);
  if (!pending) return;
  clearTimeout(pending.timer);
  pendingTriggers.delete(nodeId);
  pendingListeners.forEach((listener) => listener());
}
export function requestCanvasGenerationTrigger(bus: CanvasEventBus, nodeId: string): void {
  if (pendingTriggers.has(nodeId)) return;
  const timer = setTimeout(() => clearPendingTrigger(nodeId), 15_000);
  pendingTriggers.set(nodeId, { bus, timer, delivered: false });
  pendingListeners.forEach((listener) => listener());
  bus.publish('generation-node/trigger', { nodeId });
}
