import Store from 'electron-store';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class StoreService {
  private store: any;

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
    this.store.set(key, value);
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  has(key: string): boolean {
    return this.store.has(key);
  }
}