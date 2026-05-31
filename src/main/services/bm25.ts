/**
 * Minimal BM25 ranking over token documents — the lexical half of hybrid search.
 *
 * Dependency-free and pure: the caller supplies each document's pre-tokenized
 * terms (symbol name + path words, etc.) and queries with token arrays. Scores
 * are the standard Okapi BM25 with the usual k1/b defaults.
 */

export interface Bm25Doc {
  /** Opaque caller id (e.g. an index into the symbol table). */
  id: number;
  tokens: string[];
}

const K1 = 1.5;
const B = 0.75;

export class Bm25Index {
  private docs: Bm25Doc[] = [];
  private df = new Map<string, number>(); // term -> # docs containing it
  private termFreq: Map<string, number>[] = []; // per-doc term frequencies
  private avgLen = 0;

  constructor(docs: Bm25Doc[]) {
    this.docs = docs;
    let totalLen = 0;
    for (const doc of docs) {
      totalLen += doc.tokens.length;
      const tf = new Map<string, number>();
      for (const t of doc.tokens) tf.set(t, (tf.get(t) || 0) + 1);
      this.termFreq.push(tf);
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) || 0) + 1);
    }
    this.avgLen = docs.length ? totalLen / docs.length : 0;
  }

  private idf(term: string): number {
    const n = this.df.get(term) || 0;
    const N = this.docs.length;
    // Standard BM25 idf with +1 smoothing so it never goes negative.
    return Math.log(1 + (N - n + 0.5) / (n + 0.5));
  }

  /** Score documents against query tokens; returns ranked {id, score} desc. */
  search(queryTokens: string[], limit = 50): { id: number; score: number }[] {
    if (this.docs.length === 0 || queryTokens.length === 0) return [];
    const uniqueQ = Array.from(new Set(queryTokens));
    const scored: { id: number; score: number }[] = [];

    for (let i = 0; i < this.docs.length; i++) {
      const tf = this.termFreq[i];
      const len = this.docs[i].tokens.length;
      let score = 0;
      for (const term of uniqueQ) {
        const f = tf.get(term);
        if (!f) continue;
        const denom = f + K1 * (1 - B + (B * len) / (this.avgLen || 1));
        score += this.idf(term) * ((f * (K1 + 1)) / denom);
      }
      if (score > 0) scored.push({ id: this.docs[i].id, score });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }
}
