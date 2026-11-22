/** Serialize shared persistence while allowing independent model calls to overlap. */
export class Mutex {
  private tail: Promise<void> = Promise.resolve();
  async acquire() {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    return release;
  }
}

export class Pool {
  private active = 0;
  private waiting: (() => void)[] = [];
  constructor(private limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw Error('Invalid concurrency limit');
  }
  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>(resolve => this.waiting.push(resolve));
    else this.active++;
    try { return await task(); }
    finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
}

/** Drain already started work before propagating a failure; never orphan paid calls. */
export async function allSettledOrThrow<T>(tasks: Promise<T>[]): Promise<T[]> {
  const results = await Promise.allSettled(tasks);
  const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failed) throw failed.reason;
  return results.map(r => (r as PromiseFulfilledResult<T>).value);
}
