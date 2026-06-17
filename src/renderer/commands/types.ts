/**
 * Central command registry types and contracts.
 *
 * Every user-invokable action the IDE exposes goes through a Command entry
 * so it can be reached from:
 *   - The Command Palette (Cmd+Shift+P)
 *   - Keyboard shortcuts (registered alongside the command)
 *   - Future menus / buttons
 *
 * This file deliberately has no React imports so it can be unit-tested and
 * reused outside the palette (e.g. from a future quick-open overlay).
 */

/** A single IDE command, registered in the central registry. */
export interface Command {
  /** Unique id, e.g. "view.toggleSidebar". */
  id: string;
  /** Human label shown in the palette (Chinese by convention for this project). */
  label: string;
  /** Optional category used to group commands in the palette. */
  category?: string;
  /** Display-only shortcut hint, e.g. "Cmd+B". Not enforced here — see keymap. */
  shortcut?: string;
  /** Extra keywords that the fuzzy matcher should also match against. */
  keywords?: string[];
  /** The action to run. May be async. Errors should be handled inside. */
  action: () => void | Promise<void>;
  /**
   * If present, the command is only available when this returns true.
   * The palette greys out and skips unavailable commands.
   */
  when?: () => boolean;
}

/** A single command result with a score (higher = better match). */
export interface CommandMatch {
  command: Command;
  /** 0–1 confidence, used for ordering. Ties are broken by category then label. */
  score: number;
  /** Which label position(s) contributed to the match, for highlighting. */
  highlight: number[];
}
