/**
 * PATH repair for macOS GUI-launched Electron.
 *
 * When the app is launched from the Dock / `open` (and even from `electron .`
 * in some shells), the main process inherits a *GUI* PATH — typically just
 * `/usr/bin:/bin:/usr/sbin:/sbin` — which does NOT include Homebrew
 * (`/opt/homebrew/bin`), `~/.local/bin`, or anything the user adds in their
 * shell rc. As a result `spawn('claude', …)` / `spawn('codex', …)` /
 * `spawn('agy', …)` / `spawn('opencode', …)` throw ENOENT even though the
 * binaries are clearly on the
 * user's interactive PATH.
 *
 * This runs once, as early as possible (before `app.whenReady`), and:
 *   1. Merges a set of well-known macOS dev locations into `process.env.PATH`.
 *   2. Best-effort asks the user's *login* shell for its full PATH and merges
 *      that too. The login-shell probe is synchronous-ish via spawnSync so the
 *      fix is in place before any service (cliAgent in particular) runs.
 *
 * It's idempotent and safe: it only ever *adds* entries, never removes or
 * reorders existing ones, and any failure (no login shell, spawn errors) is
 * swallowed — the well-known paths alone usually cover Homebrew + ~/.local/bin.
 */

import { spawnSync } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs';

/** Well-known macOS dev-binary locations, appended if missing. */
const COMMON_MAC_PATHS = [
  '/usr/local/bin',
  '/opt/homebrew/bin',
  '/opt/homebrew/sbin',
  path.join(os.homedir(), '.local/bin'),
  path.join(os.homedir(), '.cargo/bin'), // rust-installed CLIs
];

function splitPath(p: string | undefined): string[] {
  if (!p) return [];
  return p.split(path.delimiter).filter((s) => s.length > 0);
}

/** Merge `extra` into `existing`, preserving order and dropping dupes. */
function mergePaths(existing: string[], extra: string[]): string {
  const seen = new Set(existing);
  const out = [...existing];
  for (const e of extra) {
    if (!e) continue;
    // Skip entries that don't exist on disk — keeps PATH lean and avoids
    // polluting it with speculative cargo/etc. dirs on machines that don't
    // have them. (We still keep existing PATH entries even if missing, since
    // those came from the environment, not from our guesses.)
    try {
      fs.statSync(e);
    } catch {
      continue;
    }
    if (seen.has(e)) continue;
    seen.add(e);
    out.push(e);
  }
  return out.join(path.delimiter);
}

/** Ask the user's login shell for its full PATH. Returns [] on any failure. */
function probeLoginShellPath(): string[] {
  // SHELL is set for most macOS users (e.g. /bin/zsh). Fall back to zsh.
  const shell = process.env.SHELL || '/bin/zsh';
  try {
    // `-i -l` = interactive + login, so rc files run and PATH gets populated
    // the same way it does in a real terminal. `--no-rcs` would defeat us.
    const res = spawnSync(shell, ['-i', '-l', '-c', 'echo $PATH'], {
      encoding: 'utf-8',
      timeout: 4000,
    });
    if (res.error || res.status !== 0) return [];
    const out = (res.stdout || '').trim();
    return splitPath(out);
  } catch {
    return [];
  }
}

/**
 * Repair `process.env.PATH` in place. Call exactly once, as early as possible
 * in the main process entrypoint (before services that spawn binaries run).
 */
export function repairPath(): void {
  const existing = splitPath(process.env.PATH);
  const probed = probeLoginShellPath();
  const merged = mergePaths(existing, [...probed, ...COMMON_MAC_PATHS]);
  process.env.PATH = merged;
}
