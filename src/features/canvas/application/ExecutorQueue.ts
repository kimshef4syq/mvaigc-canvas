/** FIFO sliding window for long-running provider jobs. A slot is held until
 * the provider reaches a terminal result, then the next queued job starts. */
export class ExecutorQueue {
  private active = 0;
  private pending: Array<() => void> = [];

  constructor(readonly maxConcurrent: number) {
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
      throw new Error('maxConcurrent must be a positive integer');
    }
  }

  get activeCount(): number { return this.active; }
  get pendingCount(): number { return this.pending.length; }

  enqueue(work: () => Promise<void>, onError: (error: unknown) => void): void {
    const start = () => {
      this.active += 1;
      void Promise.resolve().then(work).catch(onError).finally(() => {
        this.active -= 1;
        this.pending.shift()?.();
      });
    };
    if (this.active < this.maxConcurrent) start();
    else this.pending.push(start);
  }
}

export const minimaxH3ExecutorQueue = new ExecutorQueue(10);
