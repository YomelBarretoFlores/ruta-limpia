/**
 * Serializes asynchronous work per key inside one process: work for the same key runs strictly one
 * after another, in call order, while different keys run concurrently. Idle keys are released.
 */
export class KeyedMutex {
  private readonly tails = new Map<string, Promise<void>>();

  async runExclusive<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.tails.set(key, tail);

    await previous;
    try {
      return await work();
    } finally {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }

  /** Number of keys with work running or queued (for tests and diagnostics). */
  get activeKeys(): number {
    return this.tails.size;
  }
}
