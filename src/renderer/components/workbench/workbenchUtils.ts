import type { TaskToolExecution } from '@shared/types';

/**
 * Dependency-free helpers for the workbench UI (no React / no Monaco imports),
 * so they can be unit-tested without pulling the editor bundle into vitest.
 */

/** Derive a 元技能/项目 tag from the skill name (SkillMeta has no kind field). */
export function skillTag(name: string): string {
  return /^(darwin|meta|skill-)/i.test(name) || name.endsWith('-skill') ? '元技能' : '项目';
}

/** +N −N from a unified diff (skip the +++/--- file headers). */
export function diffStat(diff?: string): { add: number; del: number } {
  if (!diff) return { add: 0, del: 0 };
  let add = 0;
  let del = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) add++;
    else if (line.startsWith('-') && !line.startsWith('---')) del++;
  }
  return { add, del };
}

const WRITE_TOOLS = new Set(['write_file', 'replace_in_file', 'search_and_replace', 'create_file', 'apply_patch']);

/** Changed files from this turn's write-type tool executions (dedup, last wins). */
export function changedFiles(execs: TaskToolExecution[]): { file: string; tool: string }[] {
  const seen = new Map<string, string>();
  for (const e of execs) {
    if (!WRITE_TOOLS.has(e.name)) continue;
    const a = e.arguments as Record<string, unknown>;
    const f = (a.path || a.file || a.filePath || a.file_path) as string | undefined;
    if (f) seen.set(f, e.name);
  }
  return [...seen.entries()].map(([file, tool]) => ({ file, tool }));
}
