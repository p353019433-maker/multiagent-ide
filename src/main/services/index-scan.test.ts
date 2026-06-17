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
    expect(tokenize('runHeadlessTask')).toEqual(['run', 'headless', 'task']);
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

describe('scanSymbols — AST (TS/JS)', () => {
  it('extracts class methods as Class.method and arrow-const functions', async () => {
    await write(
      'svc.ts',
      [
        'export class IndexService {',
        '  async search(q: string) { return q; }',
        '  build = () => 1;',
        '}',
        'export const helper = () => 42;',
        'function plain() {}',
      ].join('\n')
    );
    const { symbols } = await scanSymbols(dir);
    const names = symbols.map((s) => s.name);
    expect(names).toContain('IndexService');
    expect(names).toContain('IndexService.search');
    expect(names).toContain('IndexService.build');
    expect(names).toContain('helper');
    expect(names).toContain('plain');

    const method = symbols.find((s) => s.name === 'IndexService.search')!;
    expect(method.kind).toBe('method');
    // container folded into tokens so "index service search" matches the method
    expect(method.tokens).toEqual(expect.arrayContaining(['index', 'service', 'search']));
  });

  it('parses TSX and records interfaces/types/enums', async () => {
    await write(
      'comp.tsx',
      [
        'interface Props { id: number }',
        'type Id = string;',
        'enum Color { Red, Blue }',
        'export const View = () => <div>hi</div>;',
      ].join('\n')
    );
    const { symbols } = await scanSymbols(dir);
    const kindOf = (n: string) => symbols.find((s) => s.name === n)?.kind;
    expect(kindOf('Props')).toBe('interface');
    expect(kindOf('Id')).toBe('type');
    expect(kindOf('Color')).toBe('enum');
    expect(kindOf('View')).toBe('function');
  });

});

describe('scanSymbols — structural (Python/Go/Rust)', () => {
  it('nests Python methods under their class via indentation', async () => {
    await write('m.py', ['class Animal:', '    def speak(self):', '        pass', '', 'def top():', '    pass'].join('\n'));
    const { symbols } = await scanSymbols(dir);
    const kindOf = (n: string) => symbols.find((s) => s.name === n)?.kind;
    expect(kindOf('Animal')).toBe('class');
    expect(kindOf('Animal.speak')).toBe('method');
    expect(kindOf('top')).toBe('function'); // dedented back to top level
  });

  it('maps Go receiver methods to RecvType.Method', async () => {
    await write('m.go', ['type Server struct {}', 'func (s *Server) Start() {}', 'func Helper() {}'].join('\n'));
    const { symbols } = await scanSymbols(dir);
    const kindOf = (n: string) => symbols.find((s) => s.name === n)?.kind;
    expect(kindOf('Server')).toBe('class');
    expect(kindOf('Server.Start')).toBe('method');
    expect(kindOf('Helper')).toBe('function');
  });

  it('tracks Rust impl blocks so fns become Type.method', async () => {
    await write('m.rs', ['struct Point { x: i32 }', 'impl Point {', '    pub fn new() -> Self { Point { x: 0 } }', '}', 'fn free() {}'].join('\n'));
    const { symbols } = await scanSymbols(dir);
    const kindOf = (n: string) => symbols.find((s) => s.name === n)?.kind;
    expect(kindOf('Point')).toBe('class');
    expect(kindOf('Point.new')).toBe('method');
    expect(kindOf('free')).toBe('function'); // outside the impl block
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
