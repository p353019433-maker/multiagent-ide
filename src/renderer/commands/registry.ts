import { useEffect, useState, useCallback } from 'react';
import type { Command } from './types';

/**
 * Lightweight pub-sub for the Command Palette's open/close state.
 *
 * Components anywhere in the tree (the host layout, a future menu, the
 * title bar) call openPalette() to request the palette. The palette itself
 * subscribes via usePaletteState(). This keeps the palette free of
 * prop-drilling and lets a new entry point (e.g. a help menu) come online
 * without touching MainLayout.
 */
type Listener = (open: boolean, initial?: string) => void;

let _open = false;
let _initial = '';
const _listeners = new Set<Listener>();

export function openPalette(initial: string = ''): void {
  _open = true;
  _initial = initial;
  _listeners.forEach((l) => l(_open, _initial));
}

export function closePalette(): void {
  _open = false;
  _initial = '';
  _listeners.forEach((l) => l(_open, _initial));
}

export function togglePalette(): void {
  if (_open) closePalette();
  else openPalette();
}

export function usePaletteState(): { open: boolean; initial: string } {
  const [state, setState] = useState({ open: _open, initial: _initial });
  useEffect(() => {
    const l: Listener = (open, initial = '') => setState({ open, initial });
    _listeners.add(l);
    return () => {
      _listeners.delete(l);
    };
  }, []);
  return state;
}

/** A static list of commands; consumers spread into a Command[] for matching. */
let _commands: Command[] = [];

/** Replace the entire command list (used when contexts change). */
export function setCommands(cmds: Command[]): void {
  _commands = cmds;
  _listeners.forEach((l) => l(_open, _initial));
}

export function getCommands(): Command[] {
  return _commands.filter((c) => (c.when ? c.when() : true));
}

/** Run a command by id, returning true if found (and ran). */
export function runCommandById(id: string): boolean {
  const cmd = _commands.find((c) => c.id === id && (c.when ? c.when() : true));
  if (!cmd) return false;
  void cmd.action();
  return true;
}

/**
 * Hook: stable getter for the current (filtered) command list, re-rendering
 * when commands or their `when()` dependencies change.
 */
export function useCommandList(): Command[] {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((t) => t + 1);
    _listeners.add(l);
    return () => {
      _listeners.delete(l);
    };
  }, []);
  // tick is read so React tracks the dependency
  void tick;
  return getCommands();
}

/** Imperative API to trigger a refresh of the command list (e.g. when an `when` predicate depends on something reactive). */
export function refreshCommands(): void {
  _listeners.forEach((l) => l(_open, _initial));
}

/** Tiny helper to build commands without a `when` predicate. */
export function cmd(
  id: string,
  label: string,
  action: () => void | Promise<void>,
  opts: { category?: string; shortcut?: string; keywords?: string[]; when?: () => boolean } = {}
): Command {
  return { id, label, action, ...opts };
}

/** Suppress the lint warning about unused param — keep the API stable. */
export const _useCallback = useCallback;
