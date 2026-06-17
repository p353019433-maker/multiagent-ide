import { describe, it, expect } from 'vitest';
import { parseChord, eventMatchesChord, type ParsedChord } from './keymap';

describe('parseChord', () => {
  it('parses simple modifier+key chords', () => {
    expect(parseChord('Cmd+P')).toEqual({ mod: true, shift: false, alt: false, key: 'p' });
    expect(parseChord('Cmd+Shift+P')).toEqual({ mod: true, shift: true, alt: false, key: 'p' });
    expect(parseChord('Cmd+`')).toEqual({ mod: true, shift: false, alt: false, key: '`' });
    expect(parseChord('Cmd+/')).toEqual({ mod: true, shift: false, alt: false, key: '/' });
  });

  it('parses special-key aliases', () => {
    expect(parseChord('Escape')).toEqual({ mod: false, shift: false, alt: false, key: 'escape' });
    expect(parseChord('Esc')).toEqual({ mod: false, shift: false, alt: false, key: 'escape' });
    expect(parseChord('Cmd+Enter')).toEqual({ mod: true, shift: false, alt: false, key: 'enter' });
    expect(parseChord('Cmd+ArrowDown')).toEqual({ mod: true, shift: false, alt: false, key: 'arrowdown' });
  });

  it('tolerates cross-platform synonyms', () => {
    expect(parseChord('Meta+Shift+F')).toEqual({ mod: true, shift: true, alt: false, key: 'f' });
    expect(parseChord('Ctrl+B')).toEqual({ mod: true, shift: false, alt: false, key: 'b' });
  });

  it('returns null for malformed input', () => {
    expect(parseChord('')).toBeNull();
    expect(parseChord('Cmd+')).toBeNull();
    expect(parseChord('Cmd+P+X')).toBeNull(); // two non-modifier parts
    expect(parseChord('NotAKey')).toBeNull(); // bare word, no key char
  });
});

describe('eventMatchesChord', () => {
  function makeEvent(over: Partial<KeyboardEvent>): KeyboardEvent {
    return {
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      key: '',
      isComposing: false,
      ...over,
    } as unknown as KeyboardEvent;
  }

  it('matches the expected chord on macOS', () => {
    // Simulate macOS platform
    const origPlatform = navigator.platform;
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
    try {
      const chord: ParsedChord = { mod: true, shift: true, alt: false, key: 'p' };
      const e = makeEvent({ metaKey: true, shiftKey: true, key: 'P' });
      expect(eventMatchesChord(e, chord)).toBe(true);
    } finally {
      Object.defineProperty(navigator, 'platform', { value: origPlatform, configurable: true });
    }
  });

  it('rejects mismatched modifiers', () => {
    const chord: ParsedChord = { mod: true, shift: false, alt: false, key: 'b' };
    expect(eventMatchesChord(makeEvent({ key: 'b' }), chord)).toBe(false); // no modifier
    expect(eventMatchesChord(makeEvent({ shiftKey: true, key: 'b' }), chord)).toBe(false); // wrong mod
  });

  it('rejects when key differs', () => {
    const chord: ParsedChord = { mod: true, shift: false, alt: false, key: 'b' };
    expect(eventMatchesChord(makeEvent({ metaKey: true, key: 'a' }), chord)).toBe(false);
  });
});
