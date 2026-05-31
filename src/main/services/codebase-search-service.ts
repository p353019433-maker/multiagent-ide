/**
 * Codebase search service — orchestrates the search cascade and code navigation.
 *
 * Extracted from index.ts. Owns the embedding-config lookup, per-workspace cache
 * path, the three-tier search (embedding → symbol → full-text), reindex, and the
 * go-to-definition / find-references navigation.
 */

import path from 'path';
import { app } from 'electron';
import type { IndexService, CodebaseSearchHit } from './index-service';
import type { AIService } from './ai-service';
import type { FileService } from './file-service';
import type { StoreService } from './store-service';
import { reciprocalRankFusion } from './hybrid';

export interface CodebaseSearchResult {
  hits: CodebaseSearchHit[];
  fellBack: boolean;
  mode: 'hybrid' | 'embedding' | 'symbol' | 'text';
}

export class CodebaseSearchService {
  constructor(
    private index: IndexService,
    private ai: AIService,
    private files: FileService,
    private store: StoreService
  ) {}

  /** Embedding config: { providerId, model } when configured, else null. */
  private getEmbeddingConfig(): { providerId: string; model: string } | null {
    const cfg = this.store.get('embeddingConfig') as
      | { providerId?: string; model?: string }
      | undefined;
    if (cfg?.providerId && cfg?.model) return { providerId: cfg.providerId, model: cfg.model };
    return null;
  }

  /** Per-workspace cache file for the embedding index. */
  private embedCacheFile(root: string): string {
    const key = Buffer.from(root).toString('base64').replace(/[/+=]/g, '').slice(0, 40);
    return path.join(app.getPath('userData'), 'codebase-index', `${key}.json`);
  }

  /**
   * Search cascade: hybrid (semantic ⊕ lexical via RRF) when an embedding
   * provider is configured and both signals fire → lexical-only symbol search →
   * full-text. Hybrid fusion means a file both modalities agree on rises to the
   * top, while either signal alone still surfaces results.
   */
  async search(root: string, query: string, limit = 10): Promise<CodebaseSearchResult> {
    const max = limit || 10;
    const embedCfg = this.getEmbeddingConfig();

    // Lexical (BM25) results are always cheap to compute and feed both the
    // hybrid fusion and the lexical-only fallback.
    await this.index.ensureIndex(root);
    const lexical = this.index.search(query, max * 3);

    // 1. Semantic + hybrid fusion when an embedding provider is configured.
    if (embedCfg) {
      try {
        await this.index.ensureEmbeddingIndex(
          root,
          (texts) => this.ai.embed(embedCfg.providerId, embedCfg.model, texts),
          this.embedCacheFile(root)
        );
        if (this.index.hasEmbeddings()) {
          const [qVec] = await this.ai.embed(embedCfg.providerId, embedCfg.model, [query]);
          const semantic = qVec ? this.index.semanticSearch(qVec, max * 3) : [];

          if (semantic.length && lexical.length) {
            // Fuse by file so cross-modal agreement is rewarded; represent each
            // file with its lexical symbol hit (navigable name) when available,
            // else the semantic chunk.
            const fused = reciprocalRankFusion<CodebaseSearchHit>([
              lexical.map((h) => ({ key: h.file, item: h })),
              semantic.map((h) => ({ key: h.file, item: h })),
            ]);
            const lexByFile = new Map(lexical.map((h) => [h.file, h]));
            const hits = fused.slice(0, max).map((f) => ({
              ...(lexByFile.get(f.key) ?? f.item),
              score: f.score,
            }));
            return { hits, fellBack: false, mode: 'hybrid' };
          }
          if (semantic.length) return { hits: semantic.slice(0, max), fellBack: false, mode: 'embedding' };
        }
      } catch {
        // fall through to lexical/text search
      }
    }

    // 2. Lexical-only symbol/path index.
    if (lexical.length > 0) {
      return { hits: lexical.slice(0, max), fellBack: false, mode: 'symbol' };
    }

    // 3. Full-text search.
    const text = await this.files.searchFiles(root, query);
    return {
      hits: text.slice(0, max).map((r) => ({
        file: path.relative(root, r.path),
        line: r.line,
        kind: 'text',
        name: r.preview.slice(0, 80),
        score: 1,
      })),
      fellBack: true,
      mode: 'text',
    };
  }

  /** Pre-build / refresh the embedding index on demand. */
  async reindex(root: string): Promise<{ ok: boolean; error?: string; chunks?: boolean }> {
    const embedCfg = this.getEmbeddingConfig();
    if (!embedCfg) return { ok: false, error: '未配置 embedding 模型' };
    try {
      await this.index.ensureEmbeddingIndex(
        root,
        (texts) => this.ai.embed(embedCfg.providerId, embedCfg.model, texts),
        this.embedCacheFile(root)
      );
      return { ok: true, chunks: this.index.hasEmbeddings() };
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
  }

  /** Go-to-definition (approximated via the symbol table). */
  async findDefinition(root: string, name: string): Promise<CodebaseSearchHit[]> {
    await this.index.ensureIndex(root);
    return this.index.findDefinition(name);
  }

  /** Find references: word-boundary matches of the identifier across the workspace. */
  async findReferences(
    root: string,
    name: string
  ): Promise<{ file: string; line: number; preview: string }[]> {
    const raw = await this.files.searchFiles(root, name);
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wordRe = new RegExp(`(^|[^A-Za-z0-9_$])${escaped}([^A-Za-z0-9_$]|$)`);
    return raw
      .filter((r) => wordRe.test(r.preview))
      .slice(0, 50)
      .map((r) => ({ file: path.relative(root, r.path), line: r.line, preview: r.preview.slice(0, 120) }));
  }
}
