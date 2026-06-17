/**
 * Quick Open / 命令面板共用的模糊匹配。
 * 纯函数、无依赖，便于单测（见 fuzzy.test.ts）。
 *
 * 评分规则（贪心子序列匹配）：
 * - 每个命中字符 +2，与上一命中相邻 +8（连续片段优先）
 * - 命中在词边界（开头、分隔符后、camelCase 大写）+10
 * - 大小写完全一致 +1
 * - 命中之间的间隔按 0.5/字符 扣分（每段最多扣 10）
 * - 首个命中越靠前越好、目标越短越好（小幅扣分）
 */

export interface FuzzyMatch {
  score: number;
  /** 命中字符在 target 中的下标（用于高亮） */
  positions: number[];
}

const SEPARATORS = new Set(['/', '\\', '_', '-', '.', ' ', ':']);

function isUpper(c: string): boolean {
  return c >= 'A' && c <= 'Z';
}
function isLower(c: string): boolean {
  return c >= 'a' && c <= 'z';
}
function isDigit(c: string): boolean {
  return c >= '0' && c <= '9';
}

function isBoundary(target: string, index: number): boolean {
  if (index === 0) return true;
  const prev = target[index - 1];
  if (SEPARATORS.has(prev)) return true;
  const cur = target[index];
  // camelCase：小写/数字后跟大写
  return isUpper(cur) && (isLower(prev) || isDigit(prev));
}

export function fuzzyMatch(query: string, target: string): FuzzyMatch | null {
  if (!query) return { score: 0, positions: [] };
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (q.length > t.length) return null;

  const positions: number[] = [];
  let score = 0;
  let ti = 0;
  let prevMatch = -2;

  for (let qi = 0; qi < q.length; qi++) {
    const qc = q[qi];
    let found = -1;
    while (ti < t.length) {
      if (t[ti] === qc) {
        found = ti;
        break;
      }
      ti++;
    }
    if (found === -1) return null;

    score += 2;
    if (found === prevMatch + 1) score += 8;
    if (isBoundary(target, found)) score += 10;
    if (target[found] === query[qi]) score += 1;
    if (prevMatch >= 0) {
      const gap = found - prevMatch - 1;
      if (gap > 0) score -= Math.min(10, gap * 0.5);
    }

    positions.push(found);
    prevMatch = found;
    ti = found + 1;
  }

  score -= Math.min(5, positions[0] * 0.1);
  score -= Math.min(5, (target.length - query.length) * 0.05);

  return { score, positions };
}

/**
 * 路径感知匹配：额外尝试只匹配文件名（最后一段），
 * 命中文件名比命中目录名权重更高（+4）。
 */
export function fuzzyMatchPath(query: string, target: string): FuzzyMatch | null {
  if (!query) return { score: 0, positions: [] };
  const full = fuzzyMatch(query, target);
  const lastSep = Math.max(target.lastIndexOf('/'), target.lastIndexOf('\\'));
  if (lastSep < 0) return full;

  const base = fuzzyMatch(query, target.slice(lastSep + 1));
  if (!base) return full;

  const offset = lastSep + 1;
  const baseResult: FuzzyMatch = {
    score: base.score + 4,
    positions: base.positions.map((p) => p + offset),
  };
  return !full || baseResult.score > full.score ? baseResult : full;
}

export interface FuzzyFilterResult<T> {
  item: T;
  score: number;
  positions: number[];
}

export function fuzzyFilter<T>(
  query: string,
  items: readonly T[],
  getText: (item: T) => string,
  options?: {
    limit?: number;
    matcher?: (query: string, target: string) => FuzzyMatch | null;
  }
): FuzzyFilterResult<T>[] {
  const matcher = options?.matcher ?? fuzzyMatch;
  const limit = options?.limit ?? Number.POSITIVE_INFINITY;

  const out: FuzzyFilterResult<T>[] = [];
  for (const item of items) {
    const m = matcher(query, getText(item));
    if (m) out.push({ item, score: m.score, positions: m.positions });
  }
  out.sort((a, b) => b.score - a.score || getText(a.item).localeCompare(getText(b.item)));
  return out.length > limit ? out.slice(0, limit) : out;
}
