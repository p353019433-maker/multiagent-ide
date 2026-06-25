import Store from 'electron-store';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class StoreService {
  private store: any;
  // Serializes writes so concurrent `set` calls (e.g. two agents saving
  // context at once) don't interleave a read-modify-write and lose data.
  // The queue is per-instance; writes run strictly in arrival order.
  private writeChain: Promise<void> = Promise.resolve();

  constructor() {
    this.store = new Store({
      name: 'ai-code-ide-config',
      defaults: {
        providers: [],
        conversations: [],
        activeProviderId: null,
        activeModel: null,
      },
    });
  }

  get(key: string): unknown {
    return this.store.get(key);
  }

  set(key: string, value: unknown): void {
    this.enqueue(() => this.store.set(key, value));
  }

  delete(key: string): void {
    this.enqueue(() => this.store.delete(key));
  }

  has(key: string): boolean {
    return this.store.has(key);
  }

  /**
   * Run an atomic read-modify-write against the store. The `mutator` reads the
   * current value and returns the new one; the write is enqueued so concurrent
   * transactions serialize and never drop an update. Resolves once written.
   */
  async transaction<T>(key: string, mutator: (current: unknown) => T): Promise<T> {
    let result: T;
    await this.enqueue(() => {
      result = mutator(this.store.get(key));
      this.store.set(key, result);
    });
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return result!;
  }

  private enqueue(work: () => void): Promise<void> {
    this.writeChain = this.writeChain.then(() => {
      try {
        work();
      } catch (e) {
        // Swallow inside the chain so one failed write doesn't reject every
        // subsequent write; the caller of `set` (fire-and-forget) never sees it.
        // Transactions propagate errors via their own await.
        console.error('[store-service] write failed:', e);
      }
    });
    return this.writeChain;
  }
}