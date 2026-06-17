/**
 * Global keymap dispatcher.
 *
 * The IDE standardizes on chords like "Cmd+Shift+P" in command metadata
 * (see `Command.shortcut`). At startup we walk the command registry and
 * attach a single `window.keydown` listener that matches the chord and
 * dispatches the command's `action()`.
 *
 * Why a single listener rather than one per command:
 *  - One match-loop is O(N) per event; with ~10 commands it's negligible,
 *    and we never need to install/uninstall individual listeners as the
 *    registry mutates.
 *  - Centralizing here means new commands only need a `shortcut` string
 *    to become reachable; no separate keymap file to keep in sync.
 *
 * Monaco-bound shortcuts (Cmd+S save, Cmd+/ comment) are registered via
 * `editor.addCommand` in EditorArea and take priority when the editor
 * is focused; the Monaco listener stops propagation in that case so the
 * window-level keymap does not double-fire.
 */

import { getCommands } from './registry';

export interface ParsedChord {
  /** Cmd on macOS / Ctrl elsewhere. */
  mod: boolean;
  shift: boolean;
  alt: boolean;
  /** Lowercased key; "" means chord didn't include a key part. */
  key: string;
}

const KEY_ALIASES: Record<string, string> = {
  esc: 'escape',
  escape: 'escape',
  space: ' ',
  tab: 'tab',
  enter: 'enter',
  return: 'enter',
  up: 'arrowup',
  arrowup: 'arrowup',
  down: 'arrowdown',
  arrowdown: 'arrowdown',
  left: 'arrowleft',
  arrowleft: 'arrowleft',
  right: 'arrowright',
  arrowright: 'arrowright',
  pageup: 'pageup',
  pagedown: 'pagedown',
  home: 'home',
  end: 'end',
};

/**
 * Parse a human chord like "Cmd+Shift+P" into a structured form.
 * Returns null on unrecognized input — callers should treat that as
 * "no binding" rather than "bind to nothing".
 */
export function parseChord(chord: string): ParsedChord | null {
  if (!chord) return null;
  const parts = chord
    .split('+')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (parts.length === 0) return null;

  const result: ParsedChord = { mod: false, shift: false, alt: false, key: '' };
  for (const p of parts) {
    if (p === 'cmd' || p === 'meta' || p === 'command') result.mod = true;
    else if (p === 'ctrl' || p === 'control') result.mod = true; // tolerate cross-platform specs
    else if (p === 'shift') result.shift = true;
    else if (p === 'alt' || p === 'option') result.alt = true;
    else if (p in KEY_ALIASES) {
      if (result.key) return null; // two non-modifier parts is malformed
      result.key = KEY_ALIASES[p]!;
    } else if (p.length === 1) {
      if (result.key) return null;
      result.key = p;
    } else {
      return null;
    }
  }
  return result.key ? result : null;
}

/**
 * Test whether a KeyboardEvent matches a parsed chord.
 *
 * On macOS we treat `metaKey` as the modifier; on Windows/Linux we treat
 * `ctrlKey` as the modifier. A spec like "Cmd+B" is honored on both
 * platforms via this auto-detection so commands stay portable.
 */
export function eventMatchesChord(e: KeyboardEvent, chord: ParsedChord): boolean {
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  const modPressed = isMac ? e.metaKey : e.ctrlKey;
  // Treat "Cmd" and "Ctrl" in the spec as the same intent — accept EITHER
  // physical key. This keeps cross-platform chords working without the
  // author having to think about it.
  const wantsMod = chord.mod;
  const modOk = wantsMod
    ? modPressed || (!isMac && e.metaKey) || (isMac && e.ctrlKey)
    : !modPressed && !(isMac ? e.ctrlKey : e.metaKey);
  if (!modOk) return false;
  if (chord.shift !== e.shiftKey) return false;
  if (chord.alt !== e.altKey) return false;
  return e.key.toLowerCase() === chord.key;
}

/**
 * Attach the global keydown listener. Returns a teardown that removes it.
 * Safe to call multiple times — each call installs an independent listener.
 */
export function installKeymap(): () => void {
  const handler = (e: KeyboardEvent) => {
    // Don't intercept while IME composition is active.
    if (e.isComposing) return;
    // Don't intercept editable-element keys (typing in inputs/textareas).
    // The input itself handles Escape/Enter, and Cmd-chords bubble fine.
    const target = e.target as HTMLElement | null;
    if (target && (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
      // Only allow modifier chords; let plain keys pass.
      if (!(e.metaKey || e.ctrlKey || e.altKey)) return;
    }
    const cmds = getCommands();
    for (const c of cmds) {
      if (!c.shortcut) continue;
      const chord = parseChord(c.shortcut);
      if (!chord) continue;
      if (!eventMatchesChord(e, chord)) continue;
      if (c.when && !c.when()) continue;
      e.preventDefault();
      // Defer to next tick so React state updates don't fight the keydown.
      setTimeout(() => {
        try {
          void c.action();
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[keymap] action threw:', err);
        }
      }, 0);
      return;
    }
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}
