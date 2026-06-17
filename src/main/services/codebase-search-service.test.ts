import { describe, it, expect, vi } from 'vitest';
import { CodebaseSearchService } from './codebase-search-service';

const hit = { file: 'a.ts', line: 1, kind: 'function', name: 'foo', score: 1 };

function makeService(ai: any) {
  const index = {
    ensureIndex: vi.fn(async () => undefined),
    search: vi.fn(() => [hit, { ...hit, file: 'b.ts', name: 'bar', score: 0.5 }]),
  };
  const files = {
    searchFiles: vi.fn(async () => []),
    readFile: vi.fn(async () => 'function foo() {}'),
  };
  const store = {
    get: vi.fn((key: string) => key === 'rerankConfig' ? { providerId: 'p', model: 'm' } : undefined),
  };
  const svc = new CodebaseSearchService(index as any, ai, files as any, store as any);
  return { svc, index, files, store };
}

describe('CodebaseSearchService rerank fallback', () => {
  it('short-circuits rerank for a minute after provider failure', async () => {
    const ai = { chat: vi.fn(async () => { throw new Error('bad provider'); }) };
    const { svc } = makeService(ai);

    const first = await svc.search('/repo', 'foo', 2);
    const second = await svc.search('/repo', 'foo', 2);

    expect(first.mode).toBe('symbol');
    expect(second.mode).toBe('symbol');
    expect(ai.chat).toHaveBeenCalledTimes(1);
  });
});
