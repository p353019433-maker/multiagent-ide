/**
 * Unit tests for the shared codebase scan primitives. Uses a real temp dir
 * (no git) to exercise the DFS fallback path of enumerateFiles plus symbol /
 * chunk extraction.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { tokenize, hashString, enumerateFiles, scanSymbols, scanChunks } from './index-scan';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'idx-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function write(rel: string, content: string) {
  const full = path.join(dir, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, 'utf-8');
}

describe('tokenize', () => {
  it('splits camelCase / snake_case / kebab and lowercases', () => {
    expect(tokenize('runHeadlessAgent')).toEqual(['run', 'headless', 'agent']);
    expect(tokenize('my_func-name')).toEqual(['my', 'func', 'name']);
  });
  it('drops single-char tokens', () => {
    expect(tokenize('a.b.cc')).toEqual(['cc']);
  });
});

describe('hashString', () => {
  it('is stable and differs by content', () => {
    expect(hashString('abc')).toBe(hashString('abc'));
    expect(hashString('abc')).not.toBe(hashString('abd'));
  });
});

describe('enumerateFiles (DFS fallback, non-git)', () => {
  it('finds code files and skips ignored dirs + dotfiles', async () => {
    await write('src/a.ts', 'export const a = 1;');
    await write('src/nested/b.py', 'def f():\n  pass');
    await write('node_modules/pkg/index.js', 'module.exports = 1;');
    await write('dist/out.js', 'console.log(1)');
    await write('.hidden/secret.ts', 'export const s = 1;');
    await write('readme.md', '# not code');

    const rels = (await enumerateFiles(dir)).sort();
    expect(rels).toContain('src/a.ts');
    expect(rels).toContain(path.join('src', 'nested', 'b.py'));
    expect(rels.some((r) => r.includes('node_modules'))).toBe(false);
    expect(rels.some((r) => r.includes('dist'))).toBe(false);
    expect(rels.some((r) => r.includes('.hidden'))).toBe(false);
    expect(rels.some((r) => r.endsWith('.md'))).toBe(false);
  });
});

describe('scanSymbols', () => {
  it('extracts functions, classes, interfaces across languages', async () => {
    await write('a.ts', 'export function foo() {}\nexport class Bar {}\ninterface Baz {}');
    await write('b.py', 'def py_fn():\n  pass\nclass PyCls:\n  pass');

    const { symbols, files } = await scanSymbols(dir);
    const byName = (n: string) => symbols.find((s) => s.name === n);
    expect(byName('foo')?.kind).toBe('function');
    expect(byName('Bar')?.kind).toBe('class');
    expect(byName('Baz')?.kind).toBe('interface');
    expect(byName('py_fn')?.kind).toBe('function');
    expect(byName('PyCls')?.kind).toBe('class');
    expect(files.length).toBe(2);
    // line numbers are 1-based
    expect(byName('foo')?.line).toBe(1);
  });
});

describe('scanChunks', () => {
  it('produces path-prefixed overlapping windows', async () => {
    const body = Array.from({ length: 80 }, (_, i) => `const x${i} = ${i};`).join('\n');
    await write('big.ts', body);
    const chunks = await scanChunks(dir);
    expect(chunks.length).toBeGreaterThan(1); // 80 lines > 60-line window → multiple chunks
    expect(chunks[0].text.startsWith('// big.ts')).toBe(true);
    expect(chunks[0].startLine).toBe(1);
    // overlapping windows: second chunk starts before the first ends
    expect(chunks[1].startLine).toBeLessThan(chunks[0].endLine);
  });
});
