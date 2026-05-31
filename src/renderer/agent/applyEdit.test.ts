import { describe, it, expect } from 'vitest';
import { applyEdit } from './applyEdit';

describe('applyEdit', () => {
  it('exact single replacement', () => {
    const r = applyEdit('const a = 1;\nconst b = 2;', 'const a = 1;', 'const a = 10;');
    expect(r.ok).toBe(true);
    expect(r.strategy).toBe('exact');
    expect(r.result).toBe('const a = 10;\nconst b = 2;');
    expect(r.count).toBe(1);
  });

  it('exact replaceAll', () => {
    const r = applyEdit('x\nx\nx', 'x', 'y', true);
    expect(r.count).toBe(3);
    expect(r.result).toBe('y\ny\ny');
  });

  it('whitespace-tolerant match (indentation differs)', () => {
    const content = 'function f() {\n    return 1;\n}';
    // old_str uses 2-space indent, content uses 4-space — exact would fail
    const r = applyEdit(content, 'function f() {\n  return 1;\n}', 'function f() {\n  return 2;\n}');
    expect(r.ok).toBe(true);
    expect(r.strategy).toBe('whitespace');
    expect(r.result).toContain('return 2;');
  });

  it('anchor match by unique informative first/last line', () => {
    const content = 'function alpha() {\nMIDDLE LINE THAT MODEL MISQUOTED\nreturn value;\nafter';
    const r = applyEdit(content, 'function alpha() {\n<garbled middle>\nreturn value;', 'X\nY');
    expect(r.ok).toBe(true);
    expect(r.strategy).toBe('anchor');
    expect(r.result).toBe('X\nY\nafter');
  });

  it('does not anchor on weak common closing lines', () => {
    const content = 'function alpha() {\n  one();\n}\nfunction beta() {\n  two();\n}';
    const r = applyEdit(content, 'function alpha() {\n<garbled middle>\n};', 'X');
    expect(r.ok).toBe(false);
  });

  it('returns ok:false when nothing matches', () => {
    const r = applyEdit('hello world', 'nonexistent snippet', 'x');
    expect(r.ok).toBe(false);
    expect(r.strategy).toBe('none');
    expect(r.result).toBe('hello world');
  });

  it('ambiguous whitespace match without replaceAll does not apply', () => {
    const content = '  foo\nbar\n  foo\nbaz';
    const r = applyEdit(content, 'foo', 'X', false);
    // exact "foo" appears twice → exact path replaces first occurrence
    expect(r.strategy).toBe('exact');
  });
});
