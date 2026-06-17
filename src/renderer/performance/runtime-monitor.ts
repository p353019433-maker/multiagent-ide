type PerformanceSnapshot = {
  inputSamples: number;
  inputP95Ms: number | null;
  longTaskCount: number;
  worstLongTaskMs: number;
  frameSamples: number;
  droppedFrameRate: number | null;
};

declare global {
  interface Window {
    __IDE_PERF__?: {
      snapshot: () => PerformanceSnapshot;
      reset: () => void;
    };
  }
}

const MAX_INPUT_SAMPLES = 240;
const FRAME_BUDGET_MS = 1000 / 60;
const DROPPED_FRAME_THRESHOLD_MS = FRAME_BUDGET_MS * 1.5;

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1);
  return sorted[index];
}

/**
 * Lightweight renderer telemetry for development and manual QA.
 *
 * It measures three budgets that previously had no evidence at all:
 * - keydown-to-next-paint latency
 * - long tasks over one 60 Hz frame budget
 * - dropped-frame ratio inferred from requestAnimationFrame gaps
 *
 * Data stays in memory and is exposed through `window.__IDE_PERF__.snapshot()`.
 */
export function installRuntimePerformanceMonitor(): () => void {
  const inputLatencies: number[] = [];
  let longTaskCount = 0;
  let worstLongTaskMs = 0;
  let frameSamples = 0;
  let droppedFrames = 0;
  let rafId = 0;
  let previousFrame = performance.now();

  const recordInput = (event: KeyboardEvent) => {
    if (event.isComposing || event.repeat) return;
    const startedAt = performance.now();
    requestAnimationFrame(() => {
      const latency = performance.now() - startedAt;
      inputLatencies.push(latency);
      if (inputLatencies.length > MAX_INPUT_SAMPLES) inputLatencies.shift();
      if (latency > 50) {
        console.warn(`[performance] keydown-to-paint ${latency.toFixed(1)}ms (>50ms hard fail)`);
      }
    });
  };

  const measureFrame = (now: number) => {
    const delta = now - previousFrame;
    previousFrame = now;
    frameSamples += 1;
    if (delta > DROPPED_FRAME_THRESHOLD_MS) droppedFrames += 1;
    rafId = requestAnimationFrame(measureFrame);
  };

  let longTaskObserver: PerformanceObserver | null = null;
  if (
    typeof PerformanceObserver !== 'undefined' &&
    PerformanceObserver.supportedEntryTypes?.includes('longtask')
  ) {
    longTaskObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        longTaskCount += 1;
        worstLongTaskMs = Math.max(worstLongTaskMs, entry.duration);
        if (entry.duration > FRAME_BUDGET_MS) {
          console.warn(`[performance] long task ${entry.duration.toFixed(1)}ms`);
        }
      }
    });
    longTaskObserver.observe({ entryTypes: ['longtask'] });
  }

  const snapshot = (): PerformanceSnapshot => ({
    inputSamples: inputLatencies.length,
    inputP95Ms: percentile(inputLatencies, 0.95),
    longTaskCount,
    worstLongTaskMs,
    frameSamples,
    droppedFrameRate: frameSamples === 0 ? null : droppedFrames / frameSamples,
  });

  const reset = () => {
    inputLatencies.length = 0;
    longTaskCount = 0;
    worstLongTaskMs = 0;
    frameSamples = 0;
    droppedFrames = 0;
    previousFrame = performance.now();
  };

  window.addEventListener('keydown', recordInput, { capture: true, passive: true });
  rafId = requestAnimationFrame(measureFrame);
  window.__IDE_PERF__ = { snapshot, reset };

  return () => {
    window.removeEventListener('keydown', recordInput, { capture: true });
    cancelAnimationFrame(rafId);
    longTaskObserver?.disconnect();
    delete window.__IDE_PERF__;
  };
}

export {};
