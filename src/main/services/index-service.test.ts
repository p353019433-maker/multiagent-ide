/**
 * Behavioral test for IndexService.invalidate() — the hook the file watcher
 * calls so codebase_search reflects on-disk edits instead of waiting out the
 * 60s freshness TTL. Uses a real temp dir (inline scan fallback, no worker).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { IndexService } from './index-service';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'idxsvc-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('IndexService.invalidate', () => {
  it('forces ensureIndex to rebuild so edits are visible before the 60s TTL', async () => {
    const file = path.join(dir, 'a.ts');
    await fs.writeFile(file, 'export function foo() {}', 'utf-8');

    const svc = new IndexService();
    await svc.ensureIndex(dir);
    expect(svc.findDefinition('foo').length).toBeGreaterThan(0);
    expect(svc.findDefinition('bar').length).toBe(0);

    // Add a symbol on disk. Without invalidation, ensureIndex is a no-op within
    // the 60s TTL, so the new symbol stays invisible — the bug this fixes.
    await fs.writeFile(file, 'export function foo() {}\nexport function bar() {}', 'utf-8');
    await svc.ensureIndex(dir);
    expect(svc.findDefinition('bar').length).toBe(0); // stale (documents the bug)

    // invalidate() resets freshness so the next ensureIndex rebuilds.
    svc.invalidate();
    await svc.ensureIndex(dir);
    expect(svc.findDefinition('bar').length).toBeGreaterThan(0);
  });
});
