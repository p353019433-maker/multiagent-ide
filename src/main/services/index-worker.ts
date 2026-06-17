/**
 * Worker-thread entry point for codebase scanning and heavy math.
 *
 * Runs the CPU-heavy file walk + symbol regex / chunk windowing off the main
 * thread so indexing a large project never stalls the main process event loop
 * (and with it, IPC handling for file ops and AI calls). Pure data in, pure
 * data out — see index-scan.ts for the actual logic.
 *
 * Also handles 'cosine' mode for offloading cosine-similarity search on large
 * vector indices (>2 000 chunks) so the main thread stays responsive.
 */

import { parentPort, workerData } from 'worker_threads';
import { scanSymbols, scanChunks } from './index-scan';

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

async function run(): Promise<void> {
  const { root, mode, cosinePayload } = workerData as {
    root: string;
    mode: 'symbols' | 'chunks' | 'cosine';
    cosinePayload?: {
      queryVector: number[];
      vectors: { file: string; startLine: number; endLine: number; vector: number[] }[];
      limit: number;
    };
  };

  if (mode === 'symbols') {
    const { symbols, files } = await scanSymbols(root);
    parentPort!.postMessage({ ok: true, symbols, files });
  } else if (mode === 'chunks') {
    const chunks = await scanChunks(root);
    parentPort!.postMessage({ ok: true, chunks });
  } else if (mode === 'cosine' && cosinePayload) {
    const { queryVector, vectors, limit } = cosinePayload;
    const scored = vectors.map((v) => ({
      file: v.file,
      startLine: v.startLine,
      endLine: v.endLine,
      score: cosineSimilarity(queryVector, v.vector),
    }));
    scored.sort((a, b) => b.score - a.score);
    const hits = scored.slice(0, limit).map(({ file, startLine, endLine, score }) => ({
      file,
      line: startLine,
      kind: 'chunk',
      name: `${startLine}-${endLine}`,
      score,
    }));
    parentPort!.postMessage({ ok: true, hits });
  }
}

run().catch((e: unknown) => {
  parentPort!.postMessage({ ok: false, error: e instanceof Error ? e.message : String(e) });
});
