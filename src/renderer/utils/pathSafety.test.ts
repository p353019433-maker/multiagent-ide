import { describe, it, expect } from 'vitest';
import { isSafeName } from './pathSafety';

describe('isSafeName', () => {
  it('accepts normal names', () => {
    expect(isSafeName('foo')).toBe(true);
    expect(isSafeName('foo.txt')).toBe(true);
    expect(isSafeName('foo bar.txt')).toBe(true);
    expect(isSafeName('中文文件名')).toBe(true);
    expect(isSafeName('a-b_c.d.e')).toBe(true);
  });
  it('rejects empty / whitespace', () => {
    expect(isSafeName('')).toBe(false);
    expect(isSafeName(' ')).toBe(false);
    expect(isSafeName('  foo  ')).toBe(false);
  });
  it('rejects path separators', () => {
    expect(isSafeName('a/b')).toBe(false);
    expect(isSafeName('a\\b')).toBe(false);
    expect(isSafeName('/etc/passwd')).toBe(false);
  });
  it('rejects parent-dir references', () => {
    expect(isSafeName('.')).toBe(false);
    expect(isSafeName('..')).toBe(false);
    expect(isSafeName('../foo')).toBe(false);
  });
  it('rejects control characters', () => {
    expect(isSafeName('foo\u0000bar')).toBe(false);
    expect(isSafeName('foo\nbar')).toBe(false);
    expect(isSafeName('foo\rbar')).toBe(false);
    expect(isSafeName('foo\tbar')).toBe(false);
  });
});
