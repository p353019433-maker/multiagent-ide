/**
 * Cursor position event bus.
 *
 * Why a separate bus instead of EditorContext state?
 * The editor fires cursor-position changes on every keystroke. Pushing that
 * through React context would force every context consumer (TitleBar, tabs,
 * chat panel) to re-render on every keystroke — exactly the kind of main-
 * thread thrash the evaluation framework warns against. A leaf-only pub/sub
 * lets just the StatusBar subscribe.
 */

export interface CursorState {
  filePath: string | null;
  lineNumber: number;
  column: number;
  selectionLength: number;
  language: string;
}

export const DEFAULT_CURSOR: CursorState = {
  filePath: null,
  lineNumber: 1,
  column: 1,
  selectionLength: 0,
  language: 'plaintext',
};

type Listener = (s: CursorState) => void;

let _state: CursorState = DEFAULT_CURSOR;
const _listeners = new Set<Listener>();

export function setCursorState(s: CursorState): void {
  _state = s;
  _listeners.forEach((l) => l(s));
}

export function getCursorState(): CursorState {
  return _state;
}

export function subscribeCursor(l: Listener): () => void {
  _listeners.add(l);
  return () => {
    _listeners.delete(l);
  };
}
