import { describe, it, expect, vi } from 'vitest';
import {
  loadConversations,
  createConversationPersister,
  INDEX_KEY,
  LEGACY_KEY,
  convKey,
  type StoreBackend,
} from './conversationStore';
import type { Conversation } from '@shared/types';

/** In-memory store backend for tests. */
function makeBackend(initial: Record<string, unknown> = {}) {
  const data = new Map<string, unknown>(Object.entries(initial));
  const set = vi.fn(async (k: string, v: unknown) => {
    if (v === null) data.delete(k);
    else data.set(k, v);
  });
  const get = vi.fn(async (k: string) => data.get(k));
  return { backend: { get, set } as StoreBackend, data, set, get };
}

const mkConv = (id: string, title = id): Conversation => ({
  id,
  title,
  messages: [],
  providerId: 'p',
  model: 'm',
  createdAt: 1,
  updatedAt: 1,
});

describe('loadConversations', () => {
  it('migrates legacy blob to per-conversation keys', async () => {
    const legacy = [mkConv('a'), mkConv('b')];
    const { backend, data } = makeBackend({ [LEGACY_KEY]: legacy });
    const out = await loadConversations(backend);
    expect(out.map((c) => c.id)).toEqual(['a', 'b']);
    // migrated into per-conversation keys + index
    expect(data.get(INDEX_KEY)).toEqual(['a', 'b']);
    expect(data.get(convKey('a'))).toMatchObject({ id: 'a' });
  });

  it('loads from per-conversation keys in index order', async () => {
    const { backend } = makeBackend({
      [INDEX_KEY]: ['x', 'y'],
      [convKey('x')]: mkConv('x'),
      [convKey('y')]: mkConv('y'),
    });
    const out = await loadConversations(backend);
    expect(out.map((c) => c.id)).toEqual(['x', 'y']);
  });

  it('returns empty when nothing stored', async () => {
    const { backend } = makeBackend();
    expect(await loadConversations(backend)).toEqual([]);
  });
});

describe('createConversationPersister', () => {
  it('debounces writes and only persists changed conversations', async () => {
    const { backend, set } = makeBackend();
    const p = createConversationPersister(backend, 10);
    p.save(mkConv('a'));
    p.save(mkConv('a', 'a2')); // same id again before flush
    await p.flush();
    // one write for conv:a (latest), not two
    const aWrites = set.mock.calls.filter((c) => c[0] === convKey('a'));
    expect(aWrites).toHaveLength(1);
    expect(aWrites[0][1]).toMatchObject({ title: 'a2' });
  });

  it('removes a conversation by nulling its key', async () => {
    const { backend, set } = makeBackend({ [convKey('a')]: mkConv('a') });
    const p = createConversationPersister(backend, 10);
    p.remove('a');
    await p.flush();
    expect(set).toHaveBeenCalledWith(convKey('a'), null);
  });

  it('persists order via the index key', async () => {
    const { backend, set } = makeBackend();
    const p = createConversationPersister(backend, 10);
    p.setOrder(['b', 'a']);
    await p.flush();
    expect(set).toHaveBeenCalledWith(INDEX_KEY, ['b', 'a']);
  });

  it('save then remove of same id results in removal only', async () => {
    const { backend, set } = makeBackend();
    const p = createConversationPersister(backend, 10);
    p.save(mkConv('a'));
    p.remove('a');
    await p.flush();
    const aWrites = set.mock.calls.filter((c) => c[0] === convKey('a'));
    expect(aWrites).toEqual([[convKey('a'), null]]);
  });
});
