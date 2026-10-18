import { describe, expect, it, vi } from 'vitest';
import { ExecutorQueue } from './ExecutorQueue';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('ExecutorQueue', () => {
  it('holds a slot until completion and starts the next job in FIFO order', async () => {
    const queue = new ExecutorQueue(2);
    const first = deferred();
    const second = deferred();
    const started: number[] = [];
    const onError = vi.fn();
    queue.enqueue(async () => { started.push(1); await first.promise; }, onError);
    queue.enqueue(async () => { started.push(2); await second.promise; }, onError);
    queue.enqueue(async () => { started.push(3); }, onError);
    await Promise.resolve();
    expect(started).toEqual([1, 2]);
    expect(queue.activeCount).toBe(2);
    expect(queue.pendingCount).toBe(1);
    first.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toEqual([1, 2, 3]);
    second.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(queue.activeCount).toBe(0);
    expect(onError).not.toHaveBeenCalled();
  });
});
