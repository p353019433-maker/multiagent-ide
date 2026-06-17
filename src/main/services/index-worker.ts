/**
 * Worker-thread entry point for codebase scanning.
 *
 * Runs the CPU-heavy file walk + symbol regex / chunk windowing off the main
 * thread so indexing a large project never stalls the main process event loop
 * (and with it, IPC handling for file ops and AI calls). Pure data in, pure
 * data out — see index-scan.ts for the actual logic.
 */

import { parentPort, workerData } from 'worker_threads';
import { scanSymbols, scanChunks } from './index-scan';

async function run(): Promise<void> {
  const { root, mode } = workerData as { root: string; mode: 'symbols' | 'chunks' };
  if (mode === 'symbols') {
    const { symbols, files } = await scanSymbols(root);
    parentPort!.postMessage({ ok: true, symbols, files });
  } else {
    const chunks = await scanChunks(root);
    parentPort!.postMessage({ ok: true, chunks });
  }
}

run().catch((e: unknown) => {
  parentPort!.postMessage({ ok: false, error: e instanceof Error ? e.message : String(e) });
});
