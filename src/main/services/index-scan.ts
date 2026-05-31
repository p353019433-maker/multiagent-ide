/**
 * Pure, dependency-light codebase scanning primitives shared by the index
 * service and its worker thread.
 *
 * Two design goals drive this module:
 *
 *   1. **No silent file loss.** File enumeration is git-ignore aware via
 *      `git ls-files --exclude-standard` (tracked + untracked-but-not-ignored),
 *      so the whole project is seen instead of being truncated by an arbitrary
 *      file cap. A high SAFETY_CAP only guards against pathological repos.
 *   2. **Run anywhere.** Nothing here touches Electron or worker globals, so the
 *      same functions run inside a worker thread (the fast path) or inline on
 *      the main thread (the fallback / unit-test path).
 */

import { execFile } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import ts from 'typescript';

export const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.cache',
  'release', '__pycache__', '.svn', 'coverage',
]);

export const CODE_EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.java', '.rb', '.php', '.c', '.h',
  '.cpp', '.cc', '.cs', '.swift', '.kt', '.scala', '.vue', '.svelte',
]);

/** Runaway guard only — the git-ignore filter is the real bound. */
const SAFETY_CAP = 20_000;

export const SYMBOL_PATTERNS: { re: RegExp; kind: string; group: number }[] = [
  { re: /(?:export\s+)?(?:async\s+)?function\s+(\w+)/, kind: 'function', group: 1 },
  { re: /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(/, kind: 'function', group: 1 },
  { re: /(?:export\s+)?class\s+(\w+)/, kind: 'class', group: 1 },
  { re: /(?:export\s+)?interface\s+(\w+)/, kind: 'interface', group: 1 },
  { re: /(?:export\s+)?type\s+(\w+)/, kind: 'type', group: 1 },
  { re: /(?:export\s+)?enum\s+(\w+)/, kind: 'enum', group: 1 },
  // Python / Go / Rust style
  { re: /^\s*def\s+(\w+)/, kind: 'function', group: 1 },
  { re: /^\s*class\s+(\w+)/, kind: 'class', group: 1 },
  { re: /^\s*func\s+(?:\([^)]*\)\s*)?(\w+)/, kind: 'function', group: 1 },
  { re: /^\s*(?:pub\s+)?fn\s+(\w+)/, kind: 'function', group: 1 },
];

export interface SymbolEntry {
  name: string;
  kind: string;
  file: string;
  line: number;
  /** Lower-cased name split into word parts for matching */
  tokens: string[];
}

export interface FileEntry {
  file: string;
  /** Lower-cased path words, for path-based matching */
  pathTokens: string[];
}

export interface RawChunk {
  file: string;
  startLine: number;
  endLine: number;
  text: string;
  hash: string;
}

/** Extensions parsed with the TypeScript AST; everything else uses regex. */
const TS_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

function scriptKindFor(ext: string): ts.ScriptKind {
  switch (ext) {
    case '.tsx': return ts.ScriptKind.TSX;
    case '.jsx': return ts.ScriptKind.JSX;
    case '.js': case '.mjs': case '.cjs': return ts.ScriptKind.JS;
    default: return ts.ScriptKind.TS;
  }
}

/**
 * Extract symbols from a TS/JS file via the real AST. Unlike line-regex this
 * sees methods inside classes, nested functions, arrow-assigned functions, and
 * class heritage (extends/implements), with accurate kinds and line numbers.
 * Methods/nested names fold their container into `tokens` so a search like
 * "indexService search" still matches `IndexService.search`.
 */
function extractSymbolsTS(rel: string, content: string, ext: string): SymbolEntry[] {
  const out: SymbolEntry[] = [];
  const src = ts.createSourceFile(rel, content, ts.ScriptTarget.Latest, true, scriptKindFor(ext));
  const lineOf = (node: ts.Node): number => src.getLineAndCharacterOfPosition(node.getStart(src)).line + 1;

  const push = (name: string, kind: string, node: ts.Node, container?: string) => {
    const tokens = container ? [...tokenize(container), ...tokenize(name)] : tokenize(name);
    out.push({ name: container ? `${container}.${name}` : name, kind, file: rel, line: lineOf(node), tokens });
  };

  const visit = (node: ts.Node, container?: string): void => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      push(node.name.text, 'function', node);
    } else if (ts.isClassDeclaration(node) && node.name) {
      const cls = node.name.text;
      push(cls, 'class', node);
      // Methods + property-arrow functions become navigable Class.member symbols.
      for (const member of node.members) {
        if ((ts.isMethodDeclaration(member) || ts.isGetAccessor(member) || ts.isSetAccessor(member)) &&
            member.name && ts.isIdentifier(member.name)) {
          push(member.name.text, 'method', member, cls);
        } else if (ts.isPropertyDeclaration(member) && member.name && ts.isIdentifier(member.name) &&
                   member.initializer && (ts.isArrowFunction(member.initializer) || ts.isFunctionExpression(member.initializer))) {
          push(member.name.text, 'method', member, cls);
        }
      }
    } else if (ts.isInterfaceDeclaration(node)) {
      push(node.name.text, 'interface', node);
    } else if (ts.isTypeAliasDeclaration(node)) {
      push(node.name.text, 'type', node);
    } else if (ts.isEnumDeclaration(node)) {
      push(node.name.text, 'enum', node);
    } else if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer &&
            (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))) {
          push(decl.name.text, 'function', decl);
        }
      }
    }
    ts.forEachChild(node, (child) => visit(child, container));
  };

  visit(src);
  return out;
}

/** Line-regex extraction for languages without an AST parser here. */
function extractSymbolsRegex(rel: string, content: string): SymbolEntry[] {
  const out: SymbolEntry[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const { re, kind, group } of SYMBOL_PATTERNS) {
      const m = lines[i].match(re);
      if (m && m[group]) {
        out.push({ name: m[group], kind, file: rel, line: i + 1, tokens: tokenize(m[group]) });
        break;
      }
    }
  }
  return out;
}

/** Pick AST extraction for TS/JS, regex otherwise; AST failures fall back to regex. */
export function extractSymbols(rel: string, content: string): SymbolEntry[] {
  const ext = path.extname(rel);
  if (TS_EXTS.has(ext)) {
    try {
      return extractSymbolsTS(rel, content, ext);
    } catch {
      return extractSymbolsRegex(rel, content);
    }
  }
  return extractSymbolsRegex(rel, content);
}

/** Split an identifier or phrase into lowercase word tokens (camelCase, snake_case, kebab). */
export function tokenize(s: string): string[] {
  return s
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length > 1);
}

/** Stable non-crypto hash (FNV-1a) for chunk content keying. */
export function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/** A relative path is dropped if any path segment is an ignored directory. */
function inIgnoredDir(rel: string): boolean {
  return rel.split(/[\\/]/).some((seg) => IGNORED_DIRS.has(seg));
}

/** Ask git for the non-ignored file set. Returns null if not a git repo. */
function gitListFiles(root: string): Promise<string[] | null> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard'],
      { maxBuffer: 64 * 1024 * 1024, timeout: 30_000 },
      (err, stdout) => {
        if (err) return resolve(null);
        resolve(stdout.split('\n').map((s) => s.trim()).filter(Boolean));
      }
    );
  });
}

/** DFS fallback for non-git workspaces, respecting IGNORED_DIRS + dotfiles. */
async function walkFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    if (out.length >= SAFETY_CAP) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out.push(path.relative(root, full));
    }
  };
  await walk(root);
  return out;
}

/**
 * Enumerate candidate code files (relative paths) for a workspace, git-ignore
 * aware when possible. The result is bounded only by SAFETY_CAP.
 */
export async function enumerateFiles(root: string): Promise<string[]> {
  const fromGit = await gitListFiles(root);
  const rels = fromGit ?? (await walkFiles(root));
  return rels
    .filter((rel) => CODE_EXTS.has(path.extname(rel)) && !inIgnoredDir(rel))
    .slice(0, SAFETY_CAP);
}

/** Build the symbol table + file list (CPU-heavy: read + per-line regex). */
export async function scanSymbols(root: string): Promise<{ symbols: SymbolEntry[]; files: FileEntry[] }> {
  const rels = await enumerateFiles(root);
  const symbols: SymbolEntry[] = [];
  const files: FileEntry[] = [];

  for (const rel of rels) {
    files.push({ file: rel, pathTokens: tokenize(rel) });
    const full = path.join(root, rel);
    try {
      const stat = await fs.stat(full);
      if (stat.size > 512 * 1024) continue; // skip huge files for symbol scan
      const content = await fs.readFile(full, 'utf-8');
      for (const sym of extractSymbols(rel, content)) symbols.push(sym);
    } catch {
      // skip unreadable files
    }
  }
  return { symbols, files };
}

/** Chunk all code files into overlapping line windows for embedding. */
export async function scanChunks(root: string): Promise<RawChunk[]> {
  const WINDOW = 60;
  const OVERLAP = 12;
  const rels = await enumerateFiles(root);
  const chunks: RawChunk[] = [];

  for (const rel of rels) {
    const full = path.join(root, rel);
    try {
      const stat = await fs.stat(full);
      if (stat.size > 256 * 1024) continue;
      const content = await fs.readFile(full, 'utf-8');
      const lines = content.split('\n');
      for (let start = 0; start < lines.length; start += WINDOW - OVERLAP) {
        const slice = lines.slice(start, start + WINDOW);
        const text = slice.join('\n').trim();
        if (text.length < 20) continue;
        // Prefix with the path so the embedding captures file context.
        const payload = `// ${rel}\n${text}`;
        chunks.push({
          file: rel,
          startLine: start + 1,
          endLine: Math.min(start + WINDOW, lines.length),
          text: payload,
          hash: hashString(rel + ':' + start + ':' + payload),
        });
        if (start + WINDOW >= lines.length) break;
      }
    } catch {
      // skip unreadable
    }
  }
  return chunks;
}
