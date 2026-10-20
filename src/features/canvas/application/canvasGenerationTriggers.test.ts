import { afterEach, describe, expect, it, vi } from 'vitest';
import { InMemoryCanvasEventBus } from './eventBus';
import { CANVAS_NODE_TYPES } from '../domain/canvasNodes';
import { requestCanvasGenerationTrigger, subscribeCanvasGenerationTrigger, getPendingGenerationTriggerCount } from './canvasGenerationTriggers';

afterEach(() => { vi.useRealTimers(); });
describe('generation triggers across virtualized mounts', () => {
  it('delivers an offscreen trigger exactly once when the target mounts', async () => {
    const bus = new InMemoryCanvasEventBus();
    const trigger = vi.fn();
    requestCanvasGenerationTrigger(bus, 'offscreen');
    requestCanvasGenerationTrigger(bus, 'offscreen');
    expect(getPendingGenerationTriggerCount()).toBe(1);
    const unsubscribe = subscribeCanvasGenerationTrigger(bus, CANVAS_NODE_TYPES.imageEdit, 'offscreen', trigger);
    await Promise.resolve();
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(getPendingGenerationTriggerCount()).toBe(0);
    unsubscribe();
    const remount = subscribeCanvasGenerationTrigger(bus, CANVAS_NODE_TYPES.imageEdit, 'offscreen', trigger);
    await Promise.resolve();
    expect(trigger).toHaveBeenCalledTimes(1);
    remount();
  });
  it('does not lose a queued trigger during StrictMode effect cleanup', async () => {
    const bus = new InMemoryCanvasEventBus();
    const trigger = vi.fn();
    requestCanvasGenerationTrigger(bus, 'strict-node');
    subscribeCanvasGenerationTrigger(bus, CANVAS_NODE_TYPES.aiVideo, 'strict-node', trigger)();
    const cleanup = subscribeCanvasGenerationTrigger(bus, CANVAS_NODE_TYPES.aiVideo, 'strict-node', trigger);
    await Promise.resolve();
    expect(trigger).toHaveBeenCalledTimes(1);
    cleanup();
  });
  it('expires undeliverable triggers instead of holding the entire canvas mounted forever', () => {
    vi.useFakeTimers();
    requestCanvasGenerationTrigger(new InMemoryCanvasEventBus(), 'deleted-node');
    expect(getPendingGenerationTriggerCount()).toBe(1);
    vi.advanceTimersByTime(15_000);
    expect(getPendingGenerationTriggerCount()).toBe(0);
  });
});

it('keeps an async request mounted without replaying it when the effect re-subscribes', async () => {
  const bus = new InMemoryCanvasEventBus();
  let finish!: () => void;
  const trigger = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
  requestCanvasGenerationTrigger(bus, 'async-node');
  const cleanup = subscribeCanvasGenerationTrigger(bus, CANVAS_NODE_TYPES.imageEdit, 'async-node', trigger);
  await Promise.resolve();
  expect(getPendingGenerationTriggerCount()).toBe(1);
  cleanup();
  const nextCleanup = subscribeCanvasGenerationTrigger(bus, CANVAS_NODE_TYPES.imageEdit, 'async-node', trigger);
  await Promise.resolve();
  expect(trigger).toHaveBeenCalledTimes(1);
  finish();
  await Promise.resolve();
  expect(getPendingGenerationTriggerCount()).toBe(0);
  nextCleanup();
});
