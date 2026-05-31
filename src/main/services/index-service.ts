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
import { Worker } from 'worker_threads';
import {
  tokenize,
  scanSymbols,
  scanChunks,
  type SymbolEntry,
  type FileEntry,
  type RawChunk,
} from './index-scan';

export interface CodebaseSearchHit {
  file: string;
  line: number;
  kind: string;
  name: string;
  score: number;
}

export class IndexService {
  private symbols: SymbolEntry[] = [];
  private files: FileEntry[] = [];
  private indexedRoot: string | null = null;
  private indexedAt = 0;
  private buildingSymbols = new Map<string, Promise<void>>();

  /** Build (or rebuild) the index for a workspace root. Cached for 60s. */
  async ensureIndex(root: string): Promise<void> {
    const fresh = this.indexedRoot === root && Date.now() - this.indexedAt < 60_000;
    if (fresh) return;
    let promise = this.buildingSymbols.get(root);
    if (promise) return promise;
    promise = this.build(root).finally(() => {
      this.buildingSymbols.delete(root);
    });
    this.buildingSymbols.set(root, promise);
    return promise;
  }

  private async build(root: string): Promise<void> {
    // Run the heavy walk + regex off the main thread; fall back to inline if the
    // worker can't be spawned (e.g. unit tests, or a packaging mishap).
    const { symbols, files } = await this.scanOffThread<{ symbols: SymbolEntry[]; files: FileEntry[] }>(
      'symbols',
      root,
      () => scanSymbols(root)
    );
    this.symbols = symbols;
    this.files = files;
    this.indexedRoot = root;
    this.indexedAt = Date.now();
  }

  /**
   * Run a scan in a worker thread, resolving with its plain-data result. If the
   * worker fails to start or errors, transparently fall back to running the
   * same scan inline so indexing degrades gracefully instead of breaking.
   */
  private async scanOffThread<R>(
    mode: 'symbols' | 'chunks',
    root: string,
    inline: () => Promise<R>
  ): Promise<R> {
    try {
      return await new Promise<R>((resolve, reject) => {
        const worker = new Worker(path.join(__dirname, 'index-worker.js'), {
          workerData: { root, mode },
        });
        worker.once('message', (msg: any) => {
          void worker.terminate();
          if (msg?.ok) {
            resolve((mode === 'symbols' ? { symbols: msg.symbols, files: msg.files } : msg.chunks) as R);
          } else {
            reject(new Error(msg?.error || 'index worker failed'));
          }
        });
        worker.once('error', (err) => {
          void worker.terminate();
          reject(err);
        });
      });
    } catch {
      return inline();
    }
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

  /**
   * Find declaration sites of a symbol by exact name (go-to-definition,
   * approximated via the symbol table). Returns all matching declarations.
   */
  findDefinition(name: string): CodebaseSearchHit[] {
    return this.symbols
      .filter((s) => s.name === name)
      .map((s) => ({ file: s.file, line: s.line, kind: s.kind, name: s.name, score: 1 }));
  }

  // ─── Embedding (vector) index ────────────────────────────────────────────

  private vectors: ChunkVector[] = [];
  private embeddedRoot: string | null = null;
  private buildingEmbeds = new Map<string, Promise<void>>();

  /**
   * Build (or incrementally update) the embedding index for a workspace.
   * Chunks every code file into overlapping line windows, embeds only chunks
   * whose content hash isn't already cached, and persists vectors to disk so a
   * restart doesn't re-embed unchanged code.
   *
   * @param embed  batched embedding callback (provider-agnostic)
   * @param cacheFile  absolute path to persist/restore the vector cache
   */
  async ensureEmbeddingIndex(
    root: string,
    embed: (texts: string[]) => Promise<number[][]>,
    cacheFile: string
  ): Promise<void> {
    let promise = this.buildingEmbeds.get(root);
    if (promise) return promise;
    promise = this.buildEmbeddings(root, embed, cacheFile).finally(() => {
      this.buildingEmbeds.delete(root);
    });
    this.buildingEmbeds.set(root, promise);
    return promise;
  }

  private async buildEmbeddings(
    root: string,
    embed: (texts: string[]) => Promise<number[][]>,
    cacheFile: string
  ): Promise<void> {
    // Restore cache (keyed by chunk content hash) on first use for this root.
    if (this.embeddedRoot !== root) {
      this.vectors = await this.loadVectorCache(cacheFile);
      this.embeddedRoot = root;
    }
    const cached = new Map(this.vectors.map((v) => [v.hash, v]));

    // Collect chunks across the workspace (off-thread, with inline fallback).
    const chunks = await this.scanOffThread<RawChunk[]>('chunks', root, () => scanChunks(root));

    // Figure out which chunks are new (not in cache).
    const pending = chunks.filter((c) => !cached.has(c.hash));
    const next: ChunkVector[] = [];

    // Re-use cached vectors for chunks that still exist.
    const liveHashes = new Set(chunks.map((c) => c.hash));
    for (const v of this.vectors) {
      if (liveHashes.has(v.hash)) next.push(v);
    }

    // Embed new chunks in batches with backoff to avoid rate limits.
    const BATCH = 32;
    const BASE_DELAY_MS = 200;
    for (let i = 0; i < pending.length; i += BATCH) {
      const batch = pending.slice(i, i + BATCH);
      let vecs: number[][] | undefined;
      let attempt = 0;
      const MAX_RETRIES = 3;
      while (attempt < MAX_RETRIES) {
        try {
          vecs = await embed(batch.map((c) => c.text));
          break;
        } catch (err: any) {
          attempt++;
          const isRateLimit = /rate.?limit|429|too many/i.test(err?.message || '');
          if (!isRateLimit || attempt >= MAX_RETRIES) {
            // Non-rate-limit error or exhausted retries — abort gracefully.
            vecs = undefined as any;
            break;
          }
          // Exponential backoff: 1s, 2s, 4s
          await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
        }
      }
      if (!vecs) break;
      for (let j = 0; j < batch.length; j++) {
        if (!vecs[j]) continue;
        next.push({
          file: batch[j].file,
          startLine: batch[j].startLine,
          endLine: batch[j].endLine,
          hash: batch[j].hash,
          vector: vecs[j],
        });
      }
      // Small delay between batches to stay under API rate limits.
      if (i + BATCH < pending.length) {
        await new Promise((r) => setTimeout(r, BASE_DELAY_MS));
      }
    }

    this.vectors = next;
    await this.saveVectorCache(cacheFile, next);
  }

  /** Cosine-similarity search over the embedding index. */
  semanticSearch(queryVector: number[], limit = 10): CodebaseSearchHit[] {
    if (this.vectors.length === 0) return [];
    const scored = this.vectors.map((v) => ({
      v,
      score: cosineSimilarity(queryVector, v.vector),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map(({ v, score }) => ({
      file: v.file,
      line: v.startLine,
      kind: 'chunk',
      name: `${v.startLine}-${v.endLine}`,
      score,
    }));
  }

  hasEmbeddings(): boolean {
    return this.vectors.length > 0;
  }

  private async loadVectorCache(cacheFile: string): Promise<ChunkVector[]> {
    try {
      const raw = await fs.readFile(cacheFile, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // no cache yet
    }
    return [];
  }

  private async saveVectorCache(cacheFile: string, vectors: ChunkVector[]): Promise<void> {
    try {
      await fs.mkdir(path.dirname(cacheFile), { recursive: true });
      await fs.writeFile(cacheFile, JSON.stringify(vectors), 'utf-8');
    } catch {
      // best-effort cache
    }
  }
}

interface ChunkVector {
  file: string;
  startLine: number;
  endLine: number;
  hash: string;
  vector: number[];
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
