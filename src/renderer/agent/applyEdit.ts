/**
 * Apply Model — robust edit application.
 *
 * `replace_in_file` originally required a byte-exact match of `old_str`, which
 * fails whenever the model's quoted snippet differs in whitespace/indentation
 * (a very common, frustrating failure). This module applies an edit through a
 * cascade of increasingly tolerant strategies, returning which one matched so
 * the result stays transparent. Pure & deterministic — no model call needed.
 */

export type ApplyStrategy = 'exact' | 'whitespace' | 'anchor' | 'none';

export interface ApplyResult {
  ok: boolean;
  result: string;
  strategy: ApplyStrategy;
  /** Number of replacements made (exact/whitespace with replaceAll). */
  count: number;
}

/** Collapse runs of whitespace and trim — for tolerant line comparison. */
function normalizeLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Try to apply an edit. Strategies, in order:
 *  1. exact      — byte-exact substring (fast path, preserves current behavior)
 *  2. whitespace — match a contiguous run of lines ignoring indentation/spacing
 *  3. anchor     — match by unique first+last line of the snippet, replace span
 */
export function applyEdit(
  content: string,
  oldStr: string,
  newStr: string,
  replaceAll = false
): ApplyResult {
  // ── 1. Exact ──
  const exactCount = oldStr ? content.split(oldStr).length - 1 : 0;
  if (exactCount > 0) {
    if (replaceAll) {
      return { ok: true, result: content.split(oldStr).join(newStr), strategy: 'exact', count: exactCount };
    }
    return { ok: true, result: content.replace(oldStr, newStr), strategy: 'exact', count: 1 };
  }

  const contentLines = content.split('\n');
  const oldLines = oldStr.split('\n');
  const oldNorm = oldLines.map(normalizeLine);
  // Drop leading/trailing blank lines from the snippet for matching.
  let lo = 0;
  let hi = oldNorm.length;
  while (lo < hi && oldNorm[lo] === '') lo++;
  while (hi > lo && oldNorm[hi - 1] === '') hi--;
  const oldCore = oldNorm.slice(lo, hi);

  // ── 2. Whitespace-tolerant contiguous line run ──
  if (oldCore.length > 0) {
    const matches: number[] = [];
    for (let i = 0; i + oldCore.length <= contentLines.length; i++) {
      let hit = true;
      for (let j = 0; j < oldCore.length; j++) {
        if (normalizeLine(contentLines[i + j]) !== oldCore[j]) {
          hit = false;
          break;
        }
      }
      if (hit) matches.push(i);
    }

    if (matches.length === 1 || (matches.length > 1 && replaceAll)) {
      const targets = replaceAll ? matches : [matches[0]];
      // Replace from last to first so earlier indices stay valid.
      let lines = [...contentLines];
      for (const start of [...targets].reverse()) {
        lines = [
          ...lines.slice(0, start),
          ...newStr.split('\n'),
          ...lines.slice(start + oldCore.length),
        ];
      }
      return { ok: true, result: lines.join('\n'), strategy: 'whitespace', count: targets.length };
    }
  }

  // ── 3. Anchor: unique first & last line ──
  if (oldCore.length >= 2) {
    const first = oldCore[0];
    const last = oldCore[oldCore.length - 1];
    const firstIdxs: number[] = [];
    for (let i = 0; i < contentLines.length; i++) {
      if (normalizeLine(contentLines[i]) === first) firstIdxs.push(i);
    }
    if (firstIdxs.length === 1) {
      const start = firstIdxs[0];
      let end = -1;
      for (let i = start + 1; i < contentLines.length; i++) {
        if (normalizeLine(contentLines[i]) === last) {
          end = i;
          break;
        }
      }
      if (end > start) {
        const lines = [
          ...contentLines.slice(0, start),
          ...newStr.split('\n'),
          ...contentLines.slice(end + 1),
        ];
        return { ok: true, result: lines.join('\n'), strategy: 'anchor', count: 1 };
      }
    }
  }

  return { ok: false, result: content, strategy: 'none', count: 0 };
}
