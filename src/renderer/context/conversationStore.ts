/**
 * Conversation persistence — per-conversation, debounced writes.
 *
 * The original AIContext wrote the ENTIRE conversations array to the store on
 * every state change (every streamed message, tool result, etc.). With long
 * sessions that means re-serializing hundreds of messages on every keystroke of
 * agent output — O(all) writes at high frequency.
 *
 * This module fixes both axes:
 *  - frequency: writes are debounced, collapsing a turn's storm into one flush
 *  - size: each conversation is stored under its own key `conv:<id>`, so only
 *    the conversation that actually changed is rewritten; a tiny `conversationIndex`
 *    (ordered id list) tracks order/membership
 *
 * The persister is backend-injected so it can be unit-tested without Electron.
 */

import type { Conversation } from '@shared/types';

export interface StoreBackend {
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: unknown) => Promise<void>;
}

export const INDEX_KEY = 'conversationIndex';
export const LEGACY_KEY = 'conversations';
export const convKey = (id: string) => `conv:${id}`;

/**
 * Load all conversations, migrating from the legacy single-blob format the first
 * time. Returns conversations in stored order.
 */
export async function loadConversations(backend: StoreBackend): Promise<Conversation[]> {
  const index = (await backend.get(INDEX_KEY)) as string[] | undefined;

  // ── Migration: legacy single `conversations` array → per-conversation keys ──
  if (!index) {
    const legacy = (await backend.get(LEGACY_KEY)) as Conversation[] | undefined;
    if (legacy?.length) {
      const ids = legacy.map((c) => c.id);
      await Promise.all(legacy.map((c) => backend.set(convKey(c.id), c)));
      await backend.set(INDEX_KEY, ids);
      return legacy;
    }
    return [];
  }

  const convs: Conversation[] = [];
  for (const id of index) {
    const c = (await backend.get(convKey(id))) as Conversation | undefined;
    if (c) convs.push(c);
  }
  return convs;
}

/**
 * Create a debounced, per-conversation persister. `save`/`remove`/`setOrder`
 * mark work as pending; the actual store writes happen on a trailing debounce or
 * an explicit `flush()`.
 */
export function createConversationPersister(backend: StoreBackend, delayMs = 400) {
  const dirty = new Map<string, Conversation>();
  const removed = new Set<string>();
  let pendingOrder: string[] | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const schedule = () => {
    if (timer) return;
    timer = setTimeout(() => {
      void flush();
    }, delayMs);
  };

  async function flush(): Promise<void> {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const writes: Promise<void>[] = [];
    for (const id of removed) {
      writes.push(backend.set(convKey(id), null));
    }
    for (const [id, conv] of dirty) {
      writes.push(backend.set(convKey(id), conv));
    }
    if (pendingOrder) {
      writes.push(backend.set(INDEX_KEY, pendingOrder));
    }
    dirty.clear();
    removed.clear();
    pendingOrder = null;
    await Promise.all(writes);
  }

  return {
    /** Mark a conversation changed; it will be written on the next flush. */
    save(conv: Conversation) {
      removed.delete(conv.id);
      dirty.set(conv.id, conv);
      schedule();
    },
    /** Mark a conversation removed; its key will be cleared on the next flush. */
    remove(id: string) {
      dirty.delete(id);
      removed.add(id);
      schedule();
    },
    /** Record the current ordered id list (membership + order). */
    setOrder(ids: string[]) {
      pendingOrder = ids;
      schedule();
    },
    /** Write everything pending immediately (e.g. on app close). */
    flush,
  };
}

export type ConversationPersister = ReturnType<typeof createConversationPersister>;
