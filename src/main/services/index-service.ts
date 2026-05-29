/**
 * Lightweight codebase index for semantic-ish search.
 *
 * This is intentionally dependency-free: it does NOT compute embeddings. Instead
 * it builds a symbol table (functions, classes, interfaces, types, exports) plus
 * a per-file token set, then ranks locations by relevance to a query. It is a
 * pragmatic middle ground between a raw grep and a full vector index — good
 * enough to answer "where is X handled?" without an external embedding API.
 */

import fs from 'fs/promises';
import path from 'path';

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.cache',
  'release',
  '__pycache__',
  '.svn',
  'coverage',
]);

const CODE_EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.java', '.rb', '.php', '.c', '.h',
  '.cpp', '.cc', '.cs', '.swift', '.kt', '.scala', '.vue', '.svelte',
]);

interface SymbolEntry {
  name: string;
  kind: string;
  file: string;
  line: number;
  /** Lower-cased name split into word parts for matching */
  tokens: string[];
}

interface FileEntry {
  file: string;
  /** Lower-cased path words, for path-based matching */
  pathTokens: string[];
}

export interface CodebaseSearchHit {
  file: string;
  line: number;
  kind: string;
  name: string;
  score: number;
}

const SYMBOL_PATTERNS: { re: RegExp; kind: string; group: number }[] = [
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

/** Split an identifier or phrase into lowercase word tokens (camelCase, snake_case, kebab). */
function tokenize(s: string): string[] {
  return s
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length > 1);
}

export class IndexService {
  private symbols: SymbolEntry[] = [];
  private files: FileEntry[] = [];
  private indexedRoot: string | null = null;
  private indexedAt = 0;
  private building: Promise<void> | null = null;

  /** Build (or rebuild) the index for a workspace root. Cached for 60s. */
  async ensureIndex(root: string): Promise<void> {
    const fresh = this.indexedRoot === root && Date.now() - this.indexedAt < 60_000;
    if (fresh) return;
    if (this.building) return this.building;
    this.building = this.build(root).finally(() => {
      this.building = null;
    });
    return this.building;
  }

  private async build(root: string): Promise<void> {
    const symbols: SymbolEntry[] = [];
    const files: FileEntry[] = [];
    let fileCount = 0;

    const walk = async (dir: string): Promise<void> => {
      if (fileCount > 5000) return; // hard cap to stay responsive
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (CODE_EXTS.has(path.extname(entry.name))) {
          fileCount++;
          const rel = path.relative(root, full);
          files.push({ file: rel, pathTokens: tokenize(rel) });
          try {
            const stat = await fs.stat(full);
            if (stat.size > 512 * 1024) continue; // skip huge files for symbol scan
            const content = await fs.readFile(full, 'utf-8');
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
              for (const { re, kind, group } of SYMBOL_PATTERNS) {
                const m = lines[i].match(re);
                if (m && m[group]) {
                  const name = m[group];
                  symbols.push({ name, kind, file: rel, line: i + 1, tokens: tokenize(name) });
                  break;
                }
              }
            }
          } catch {
            // skip unreadable files
          }
        }
      }
    };

    await walk(root);
    this.symbols = symbols;
    this.files = files;
    this.indexedRoot = root;
    this.indexedAt = Date.now();
  }

  /**
   * Rank symbols + files by relevance to the query. Scoring favors exact and
   * prefix matches on symbol names, then partial token overlap, then path hits.
   */
  search(query: string, limit = 10): CodebaseSearchHit[] {
    const qTokens = tokenize(query);
    if (qTokens.length === 0) return [];
    const qLower = query.toLowerCase();

    const hits: CodebaseSearchHit[] = [];

    for (const sym of this.symbols) {
      const nameLower = sym.name.toLowerCase();
      let score = 0;

      // Strong signals on the symbol name itself.
      if (nameLower === qLower) score += 100;
      else if (qLower.includes(nameLower) || nameLower.includes(qLower)) score += 40;

      // Token overlap between query and symbol name.
      let overlap = 0;
      for (const qt of qTokens) {
        if (sym.tokens.includes(qt)) overlap += 1;
        else if (sym.tokens.some((t) => t.startsWith(qt) || qt.startsWith(t))) overlap += 0.5;
      }
      score += (overlap / qTokens.length) * 50;

      // Mild boost when the file path also matches the query intent.
      const pathTokens = tokenize(sym.file);
      const pathOverlap = qTokens.filter((qt) => pathTokens.includes(qt)).length;
      score += pathOverlap * 5;

      if (score > 0) {
        hits.push({ file: sym.file, line: sym.line, kind: sym.kind, name: sym.name, score });
      }
    }

    // File-path level matches (covers files with no extracted symbols).
    for (const f of this.files) {
      const overlap = qTokens.filter((qt) => f.pathTokens.includes(qt)).length;
      if (overlap > 0) {
        hits.push({
          file: f.file,
          line: 1,
          kind: 'file',
          name: path.basename(f.file),
          score: overlap * 8,
        });
      }
    }

    hits.sort((a, b) => b.score - a.score);

    // De-duplicate by file+line, keep highest score.
    const seen = new Set<string>();
    const deduped: CodebaseSearchHit[] = [];
    for (const h of hits) {
      const key = `${h.file}:${h.line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(h);
      if (deduped.length >= limit) break;
    }
    return deduped;
  }

  /** True when the current index has any symbol/file hits for the query. */
  hasResults(query: string): boolean {
    return this.search(query, 1).length > 0;
  }
}
