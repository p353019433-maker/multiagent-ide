import { describe, it, expect } from 'vitest';
import { languageFromPath } from './language';

describe('languageFromPath', () => {
  it('maps known extensions to language ids', () => {
    expect(languageFromPath('src/a.ts')).toBe('typescript');
    expect(languageFromPath('a.tsx')).toBe('typescript');
    expect(languageFromPath('a.py')).toBe('python');
    expect(languageFromPath('Main.RS')).toBe('rust'); // case-insensitive
    expect(languageFromPath('deep/dir/notes.md')).toBe('markdown');
  });
  it('falls back to plaintext for unknown / extensionless paths', () => {
    expect(languageFromPath('a.unknownext')).toBe('plaintext');
    expect(languageFromPath('Makefile')).toBe('plaintext');
  });
});
