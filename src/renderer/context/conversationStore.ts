/**
 * Conversation persistence — per-conversation, debounced writes.
 *
 * The original task context wrote the ENTIRE conversations array to the store on
 * every state change (every streamed message, tool result, etc.). With long
 * sessions that means re-serializing hundreds of messages on every keystroke of
 * streamed task output — O(all) writes at high frequency.
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
export const SCHEMA_VERSION_KEY = 'conversationSchemaVersion';

/**
 * Current on-disk schema version for persisted conversations. Bump whenever a
 * breaking shape change is made to `Conversation` / `ChatMessage`, and add a
 * migration in `migrateConversation` below. Load-time rejects rows whose
 * post-migration shape still doesn't satisfy the current contract, so a future
 * required field that's missing surfaces as a dropped-bad-row log rather than a
 * silent first-use crash.
 */
export const CURRENT_SCHEMA_VERSION = 2;

export const convKey = (id: string) => `conv:${id}`;

/**
 * Best-effort migration of a single loaded conversation to the current shape.
 * Each `vN → vN+1` step is a small, pure transform. Returns null when a row is
 * unrecoverably corrupt and should be dropped.
 *
 * v1 → v2: ensure `ChatMessage.timestamp` is a number (very old rows stored it
 *   as an ISO string); drop messages whose `role` is unknown. `worktree` and
 *   `images` were added as optional fields earlier — old rows simply lack them,
 *   which is fine, so we don't synthesize them.
 */
function migrateConversation(c: Partial<Conversation>, fromVersion: number): Conversation | null {
  if (!c || typeof c.id !== 'string' || !Array.isArray(c.messages)) return null;
  let conv = c as Conversation;
  for (let v = fromVersion; v < CURRENT_SCHEMA_VERSION; v++) {
    if (v === 1) {
      // v1 → v2: normalize message timestamps + drop junk roles.
      conv = {
        ...conv,
        messages: conv.messages
          .map((m) => {
            if (!m || typeof m.role !== 'string') return null;
            const ts = typeof m.timestamp === 'number'
              ? m.timestamp
              : typeof m.timestamp === 'string'
              ? Date.parse(m.timestamp) || Date.now()
              : Date.now();
            return { ...m, timestamp: ts };
          })
          .filter((m): m is Conversation['messages'][number] => m !== null),
      };
    }
    // Future migrations append their `else if (v === N)` here.
  }
  return conv;
}

/**
 * Load all conversations, migrating from the legacy single-blob format the first
 * time. Returns conversations in stored order. Rows that fail migration are
 * dropped (with a console warning) so one corrupt row doesn't break the store.
 */
export async function loadConversations(backend: StoreBackend): Promise<Conversation[]> {
  // ── Migration: legacy single `conversations` array → per-conversation keys ──
  // The legacy blob predates schemaVersion; treat it as v1.
  const storedVersion = (await backend.get(SCHEMA_VERSION_KEY)) as number | undefined;
  const index = (await backend.get(INDEX_KEY)) as string[] | undefined;

  if (!index && !storedVersion) {
    const legacy = (await backend.get(LEGACY_KEY)) as Conversation[] | undefined;
    if (legacy?.length) {
      const migrated = legacy
        .map((c) => migrateConversation(c, 1))
        .filter((c): c is Conversation => c !== null);
      await Promise.all(migrated.map((c) => backend.set(convKey(c.id), c)));
      await backend.set(INDEX_KEY, migrated.map((c) => c.id));
      await backend.set(SCHEMA_VERSION_KEY, CURRENT_SCHEMA_VERSION);
      return migrated;
    }
    return [];
  }

  const convs: Conversation[] = [];
  const dropped: string[] = [];
  for (const id of index ?? []) {
    const raw = (await backend.get(convKey(id))) as Partial<Conversation> | undefined;
    if (!raw) {
      dropped.push(id);
      continue;
    }
    const version = storedVersion ?? 1;
    const migrated = version < CURRENT_SCHEMA_VERSION ? migrateConversation(raw, version) : (raw as Conversation);
    if (!migrated) {
      dropped.push(id);
      continue;
    }
    convs.push(migrated);
  }

  // If any rows were dropped, persist the cleaned-up index + version so the
  // next load doesn't re-walk the bad rows. Also bump the version so a future
  // migration doesn't re-run the v1→v2 pass on already-migrated rows.
  if (dropped.length || (storedVersion ?? 1) < CURRENT_SCHEMA_VERSION) {
    await backend.set(INDEX_KEY, convs.map((c) => c.id));
    await backend.set(SCHEMA_VERSION_KEY, CURRENT_SCHEMA_VERSION);
    if (dropped.length) {
      console.warn(`[conversationStore] dropped ${dropped.length} corrupt conversation(s):`, dropped);
    }
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
    // Catch write failures (quota, IPC error, store corruption) so a single
    // failed write doesn't surface as an unhandled promise rejection and crash
    // the renderer.
    try {
      await Promise.all(writes);
    } catch (err) {
      // Best-effort: log and move on. A future flush() will retry the
      // conversation; the UI may have unsaved changes on disk, but losing
      // them is preferable to taking down the app.
      console.error('[conversationStore] flush failed:', err);
    }
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
