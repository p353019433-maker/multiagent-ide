/**
 * Integration tests for the task tool executor.
 *
 * Drives executeSingleTool end-to-end against an in-memory filesystem and a real
 * ToolContext (resolvePath / gateAction / writeFileTracked), exercising the
 * dispatch, the approval interplay, and Apply Model — not just pure helpers.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { executeSingleTool, type ToolContext } from './toolExecutor';
import { resolveWorkspacePath } from './taskUtils';
import type { ToolCall, PlanStep } from '@shared/types';

const ROOT = '/workspace';

// In-memory filesystem shared by the fake window.api and writeFileTracked.
let files: Map<string, string>;

/** Build a fake window.api backed by the in-memory fs (only what tools touch). */
function installFakeApi() {
  const fs = {
    readFile: vi.fn(async (p: string) => {
      if (!files.has(p)) throw new Error(`ENOENT: ${p}`);
      return files.get(p)!;
    }),
    writeFile: vi.fn(async (p: string, c: string) => {
      files.set(p, c);
    }),
    readDirectory: vi.fn(async (p: string) => {
      const prefix = p.endsWith('/') ? p : p + '/';
      const names = new Set<string>();
      for (const key of files.keys()) {
        if (key.startsWith(prefix)) {
          const rest = key.slice(prefix.length).split('/')[0];
          names.add(rest);
        }
      }
      return Array.from(names).map((name) => ({
        name,
        isDirectory: !Array.from(files.keys()).includes(prefix + name),
      }));
    }),
    searchFiles: vi.fn(async (root: string, query: string) => {
      const out: { path: string; line: number; preview: string }[] = [];
      for (const [p, content] of files) {
        if (!p.startsWith(root)) continue;
        content.split('\n').forEach((line, i) => {
          if (line.includes(query)) out.push({ path: p, line: i + 1, preview: line.trim() });
        });
      }
      return out;
    }),
    readMultipleFiles: vi.fn(async (paths: string[]) => {
      const r: Record<string, string> = {};
      for (const p of paths) r[p] = files.get(p) ?? `[读取失败：${p}]`;
      return r;
    }),
  };
  (globalThis as any).window = { api: { fs }, dispatchEvent: vi.fn() };
  return fs;
}

/** A ToolContext wired to the in-memory fs with a controllable approval gate. */
function makeCtx(opts: { approve?: boolean } = {}): {
  ctx: ToolContext;
  gate: ReturnType<typeof vi.fn>;
  edited: string[];
} {
  const edited: string[] = [];
  const gate = vi.fn(async () => opts.approve ?? true);
  const ctx: ToolContext = {
    rootPath: ROOT,
    resolvePath: (p: string) => resolveWorkspacePath(ROOT, p),
    gateAction: gate as any,
    writeFileTracked: async (filePath: string, content: string) => {
      files.set(filePath, content);
      edited.push(filePath);
    },
    getGitHubContext: async () => ({ hasToken: false, info: null }),
  };
  return { ctx, gate, edited };
}

const call = (name: string, args: Record<string, unknown>): ToolCall => ({
  id: 't1',
  name,
  arguments: args,
});

beforeEach(() => {
  files = new Map();
  installFakeApi();
});

describe('toolExecutor — file operations', () => {
  it('read_file returns content', async () => {
    files.set(`${ROOT}/a.ts`, 'hello\nworld');
    const { ctx } = makeCtx();
    const out = await executeSingleTool(call('read_file', { path: 'a.ts' }), ctx);
    expect(out).toBe('hello\nworld');
  });

  it('read_file with offset/limit slices lines', async () => {
    files.set(`${ROOT}/a.ts`, 'l1\nl2\nl3\nl4');
    const { ctx } = makeCtx();
    const out = await executeSingleTool(call('read_file', { path: 'a.ts', offset: 2, limit: 2 }), ctx);
    expect(out).toBe('l2\nl3');
  });

  it('write_file persists when approved and tracks the edit', async () => {
    const { ctx, gate, edited } = makeCtx({ approve: true });
    const out = await executeSingleTool(call('write_file', { path: 'new.ts', content: 'X' }), ctx);
    expect(gate).toHaveBeenCalledOnce();
    expect(files.get(`${ROOT}/new.ts`)).toBe('X');
    expect(edited).toContain(`${ROOT}/new.ts`);
    expect(out).toContain('已写入');
  });

  it('write_file does NOT persist when approval is denied', async () => {
    const { ctx } = makeCtx({ approve: false });
    const out = await executeSingleTool(call('write_file', { path: 'new.ts', content: 'X' }), ctx);
    expect(files.has(`${ROOT}/new.ts`)).toBe(false);
    expect(out).toContain('拒绝');
  });

  it('rejects path traversal outside the workspace', async () => {
    const { ctx } = makeCtx();
    await expect(
      executeSingleTool(call('read_file', { path: '../etc/passwd' }), ctx)
    ).rejects.toThrow();
  });
});

describe('toolExecutor — update_plan', () => {
  it('normalizes steps and forwards them to onPlanUpdate without an approval gate', async () => {
    const { ctx, gate } = makeCtx();
    const plans: PlanStep[][] = [];
    const ctxWithPlan: ToolContext = { ...ctx, onPlanUpdate: (s) => plans.push(s) };
    const out = await executeSingleTool(
      call('update_plan', {
        steps: [
          { content: '读取 theme.ts', status: 'completed' },
          { content: '写入 token', status: 'in_progress' },
          { content: '跑 lint', status: 'pending' },
          { content: '', status: 'pending' }, // empty content -> dropped
          { content: '坏状态', status: 'bogus' }, // unknown status -> pending
        ],
      }),
      ctxWithPlan
    );
    // A metadata-only tool must not require approval.
    expect(gate).not.toHaveBeenCalled();
    expect(plans).toHaveLength(1);
    expect(plans[0]).toEqual([
      { content: '读取 theme.ts', status: 'completed' },
      { content: '写入 token', status: 'in_progress' },
      { content: '跑 lint', status: 'pending' },
      { content: '坏状态', status: 'pending' },
    ]);
    expect(out).toContain('4 步');
    expect(out).toContain('完成 1');
  });

  it('tolerates a missing onPlanUpdate (headless) and missing steps', async () => {
    const { ctx } = makeCtx(); // no onPlanUpdate provided
    const out = await executeSingleTool(call('update_plan', {}), ctx);
    expect(out).toContain('0 步');
  });
});

describe('toolExecutor — Apply Model (replace_in_file)', () => {
  it('applies exact match', async () => {
    files.set(`${ROOT}/a.ts`, 'const a = 1;\nconst b = 2;');
    const { ctx } = makeCtx();
    const out = await executeSingleTool(
      call('replace_in_file', { path: 'a.ts', old_str: 'const a = 1;', new_str: 'const a = 9;' }),
      ctx
    );
    expect(files.get(`${ROOT}/a.ts`)).toBe('const a = 9;\nconst b = 2;');
    expect(out).toContain('替换');
  });

  it('falls back to whitespace-tolerant match and notes the strategy', async () => {
    files.set(`${ROOT}/a.ts`, 'function f() {\n    return 1;\n}');
    const { ctx } = makeCtx();
    const out = await executeSingleTool(
      call('replace_in_file', {
        path: 'a.ts',
        old_str: 'function f() {\n  return 1;\n}', // 2-space vs file's 4-space
        new_str: 'function f() {\n  return 2;\n}',
      }),
      ctx
    );
    expect(files.get(`${ROOT}/a.ts`)).toContain('return 2;');
    expect(out).toContain('容差匹配');
  });

  it('throws when no strategy matches', async () => {
    files.set(`${ROOT}/a.ts`, 'hello');
    const { ctx } = makeCtx();
    await expect(
      executeSingleTool(call('replace_in_file', { path: 'a.ts', old_str: 'nope', new_str: 'x' }), ctx)
    ).rejects.toThrow();
  });

  it('refuses non-unique old_str without replace_all', async () => {
    files.set(`${ROOT}/a.ts`, 'x\nx\nx');
    const { ctx } = makeCtx();
    await expect(
      executeSingleTool(call('replace_in_file', { path: 'a.ts', old_str: 'x', new_str: 'y' }), ctx)
    ).rejects.toThrow(/不唯一/);
  });
});

describe('toolExecutor — search & multi-file', () => {
  it('search_files returns matches', async () => {
    files.set(`${ROOT}/a.ts`, 'foo\nbar');
    files.set(`${ROOT}/b.ts`, 'baz\nfoo');
    const { ctx } = makeCtx();
    const out = await executeSingleTool(call('search_files', { query: 'foo' }), ctx);
    expect(out).toContain('a.ts');
    expect(out).toContain('b.ts');
  });

  it('read_multiple_files aggregates content', async () => {
    files.set(`${ROOT}/a.ts`, 'AAA');
    files.set(`${ROOT}/b.ts`, 'BBB');
    const { ctx } = makeCtx();
    const out = await executeSingleTool(call('read_multiple_files', { paths: ['a.ts', 'b.ts'] }), ctx);
    expect(out).toContain('AAA');
    expect(out).toContain('BBB');
  });
});

describe('toolExecutor — GitHub gating', () => {
  it('fails clearly when no GitHub token is configured', async () => {
    const { ctx } = makeCtx();
    await expect(
      executeSingleTool(call('github_list_issues', {}), ctx)
    ).rejects.toThrow(/GitHub/);
  });
});

describe('toolExecutor — unknown tool', () => {
  it('throws on unknown tool name', async () => {
    const { ctx } = makeCtx();
    await expect(executeSingleTool(call('does_not_exist', {}), ctx)).rejects.toThrow(/未知工具/);
  });
});
