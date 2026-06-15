/**
 * Codebase search service — orchestrates the search cascade and code navigation.
 *
 * Extracted from index.ts. Owns the embedding-config lookup, per-workspace cache
 * path, the three-tier search (embedding → symbol → full-text), reindex, and the
 * go-to-definition / find-references navigation.
 */

import path from 'path';
import { app } from 'electron';
import crypto from 'crypto';
import type { IndexService, CodebaseSearchHit } from './index-service';
import type { AIService } from './ai-service';
import type { FileService } from './file-service';
import type { StoreService } from './store-service';

export interface CodebaseSearchResult {
  hits: CodebaseSearchHit[];
  fellBack: boolean;
  mode: 'embedding' | 'symbol' | 'text';
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
    // Use sha-256 of the root as the cache key. The previous implementation
    // took a 40-char slice of base64(root) which collides for any two roots
    // that share the first ~30 base64 chars, leading to one workspace's
    // cached vectors being read for another.
    const key = crypto
      .createHash('sha256')
      .update(root)
      .digest('base64')
      .replace(/[/+=]/g, '');
    return path.join(app.getPath('userData'), 'codebase-index', `${key}.json`);
  }

  /** Three-tier search: embedding (if configured) → symbol index → full-text. */
  async search(root: string, query: string, limit = 10): Promise<CodebaseSearchResult> {
    const max = limit || 10;
    const embedCfg = this.getEmbeddingConfig();

    // 1. Real semantic search when an embedding provider is configured.
    if (embedCfg) {
      try {
        await this.index.ensureEmbeddingIndex(
          root,
          (texts) => this.ai.embed(embedCfg.providerId, embedCfg.model, texts),
          this.embedCacheFile(root)
        );
        if (this.index.hasEmbeddings()) {
          const [qVec] = await this.ai.embed(embedCfg.providerId, embedCfg.model, [query]);
          if (qVec) {
            const hits = this.index.semanticSearch(qVec, max);
            if (hits.length) return { hits, fellBack: false, mode: 'embedding' };
          }
        }
      } catch {
        // fall through to symbol/text search
      }
    }

    // 2. Symbol/path index.
    await this.index.ensureIndex(root);
    const hits = this.index.search(query, max);
    if (hits.length > 0) {
      return { hits, fellBack: false, mode: 'symbol' };
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
