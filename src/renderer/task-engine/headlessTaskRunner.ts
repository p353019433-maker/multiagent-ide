/**
 * Headless task loop for background / orchestrated sub-tasks.
 *
 * The interactive task engine (useTaskEngine) is bound to React state and the global
 * streaming IPC channels, so it can only drive ONE conversation at a time. The
 * orchestrator runs several sub-tasks in parallel inside isolated git
 * worktrees, so it needs a self-contained loop that:
 *
 *   - uses the NON-streaming `ai.chat` (parallel streams would interleave on the
 *     single global `ai:stream-*` channel),
 *   - executes real tools via the shared {@link executeSingleTool} dispatch, and
 *   - runs autonomously (no human to click "approve").
 *
 * Capability policy (tuned for a single-user local tool that favours automation):
 * each task is fenced to its own worktree and may freely read, write, run
 * commands (build/test/lint) and do LOCAL git, so it can actually implement AND
 * self-verify a sub-task. The only hard blocks are the things that are
 * outward-facing or irreversible without a human — remote/GitHub writes
 * (`github_*`, `git_push`), branch merges (`git_merge`, the user's integration
 * step), and genuinely destructive shell commands (rm -rf, dd, fork bombs, force
 * push, hard reset…) caught by the shared danger classifier.
 *
 * This is what turns `orchestrate` from a text-only "复读机" into task runs that can
 * actually read, edit, run, and verify changes in their workspace.
 */

import { v4 as uuid } from 'uuid';
import type { ChatMessage, ToolCall } from '@shared/types';
import { BUILTIN_TOOLS, TASK_SYSTEM_PROMPT } from '@shared/tools';
import { classifyCommand } from '@shared/command-policy';
import { executeSingleTool, type ToolContext } from './toolExecutor';
import { resolveWorkspacePath, classifyToolError } from './taskUtils';

const MAX_ITERATIONS = 20;

/** Tools an unattended task must not call: outward-facing or user-owned. */
const HEADLESS_BLOCKED_TOOLS = new Set(['git_push', 'git_merge']);

/**
 * Headless tool-gate companion: returns true when a `command` action coming
 * from `toolExecutor.gateAction` is a local worktree git op we should allow
 * past the default "dangerous → reject" rule.
 *
 * Charter §3.4 explicitly allows background agents to "做本地 git" — branch +
 * commit + worktree-add inside their own worktree is exactly that. `toolExecutor`
 * tags these as `dangerous: true` so an interactive run still confirms with the
 * user; headless mode trusts them because they're local and worktree-scoped.
 * Anything outward / integration-y (push, merge, github_*) stays blocked by
 * `HEADLESS_BLOCKED_TOOLS` / the `github_` prefix check above.
 *
 * `shellRepr` is the `after` string `toolExecutor` passes to `gateAction` —
 * the shell representation (e.g. `git checkout -b foo`), not the human label.
 * Pure so it's easy to test.
 */
export function isHeadlessLocalGitOk(shellRepr: string): boolean {
  if (!shellRepr) return false;
  return (
    /^git\s+checkout\s+-b\s+\S+/.test(shellRepr) ||
    /^git\s+switch\s+\S+/.test(shellRepr) ||
    /^git\s+add\s+-A\s+&&\s+git\s+commit\s+-m\s+/.test(shellRepr) ||
    /^git\s+worktree\s+add\s+/.test(shellRepr)
  );
}

/**
 * Enforce the headless capability policy before a tool runs. Blocks remote /
 * integration tools outright and destructive shell commands via the shared
 * danger classifier; everything else (reads, workspace writes, safe commands,
 * local git) is allowed so the task can implement and self-verify autonomously.
 */
function assertHeadlessToolAllowed(tc: ToolCall): void {
  if (tc.name.startsWith('github_') || HEADLESS_BLOCKED_TOOLS.has(tc.name)) {
    throw new Error(`后台任务禁止调用 ${tc.name}：无人值守模式不做远端写入/分支合并，请在界面中手动操作`);
  }
  if (tc.name === 'run_command' || tc.name === 'run_background_command') {
    const command = String((tc.arguments as { command?: unknown })?.command ?? '');
    const risk = classifyCommand(command);
    if (risk.dangerous) {
      throw new Error(`后台任务拒绝执行高危命令（${risk.reason}）：${command}`);
    }
  }
}

export interface HeadlessTaskResult {
  /** The task runner's final assistant text. */
  content: string;
  /** How many model round-trips ran. */
  iterations: number;
  /** Absolute paths the task wrote to (deduped). */
  editedFiles: string[];
  /** Set when the loop ended abnormally (cap hit, error, stuck). */
  note?: string;
}

export interface HeadlessTaskParams {
  providerId: string;
  model: string;
  /** Absolute path of the isolated worktree this task operates in. */
  workspaceRoot: string;
  /** The sub-task instruction. */
  task: string;
  /** Optional extra system guidance appended to the base task prompt. */
  systemPromptSuffix?: string;
  /** Callback fired when a file is written. */
  onFileWritten?: (path: string) => void;
  /** Cancel the autonomous loop between model/tool calls. */
  signal?: AbortSignal;
}

/** Run a tool with exponential-backoff retry on transient (retriable) errors. */
async function runToolWithRetry(tc: ToolCall, ctx: ToolContext, maxAttempts = 3): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      assertHeadlessToolAllowed(tc);
      return await executeSingleTool(tc, ctx);
    } catch (err) {
      lastErr = err;
      const { retriable } = classifyToolError(err);
      if (!retriable || attempt === maxAttempts) throw err;
      await new Promise((r) => setTimeout(r, 2 ** (attempt - 1) * 500));
    }
  }
  throw lastErr;
}

/**
 * Drive a single sub-task to completion inside its worktree. Never throws —
 * failures are captured into the returned `content`/`note` so the orchestrator
 * can record a per-task status without aborting its siblings.
 */
export async function runHeadlessTask(params: HeadlessTaskParams): Promise<HeadlessTaskResult> {
  const { providerId, model, workspaceRoot, task, systemPromptSuffix, onFileWritten, signal } = params;

  const editedFiles = new Set<string>();
  const ctx: ToolContext = {
    rootPath: workspaceRoot,
    resolvePath: (p: string) => resolveWorkspacePath(workspaceRoot, p),
    // Policy is enforced at the tool gate (assertHeadlessToolAllowed): whatever
    // reaches a tool is already vetted by the blocklist. The gate additionally
    // blocks writes to .git/ (malicious hooks) and rejects dangerous commands
    // caught by the classifier — but allows safe commands so the task can
    // build/test/lint in its worktree without human input.
    //
    // Charter §3.4 lets background agents "做本地 git"; `toolExecutor` tags
    // branch/commit/worktree-add as `dangerous: true` so an interactive run
    // still confirms. Headless mode trusts those (they're local + worktree-
    // scoped) via isHeadlessLocalGitOk, which matches the shell repr in `after`.
    gateAction: async (_toolCallId, label, kind, _before, after, _action, opts) => {
      if (typeof label === 'string' && /[\/\\]\.git[\/\\]/i.test(label)) return false;
      if (kind === 'write' && !opts?.dangerous) return true;
      if (kind === 'command' && !opts?.dangerous) return true;
      if (kind === 'command' && opts?.dangerous && typeof after === 'string' && isHeadlessLocalGitOk(after)) return true;
      return false;
    },
    writeFileTracked: async (filePath: string, content: string) => {
      await window.api.fs.writeFile(filePath, content);
      editedFiles.add(filePath);
      onFileWritten?.(filePath);
    },
    // Background tasks don't act on GitHub; surface a clear failure if they try.
    getGitHubContext: async () => ({ token: null, info: null }),
  };

  const systemPrompt = systemPromptSuffix
    ? `${TASK_SYSTEM_PROMPT}\n\n${systemPromptSuffix}`
    : TASK_SYSTEM_PROMPT;

  let messages: ChatMessage[] = [
    { id: uuid(), role: 'user', content: task, timestamp: Date.now() },
  ];

  let lastContent = '';
  let lastSignature = '';
  let repeatCount = 0;
  let iterations = 0;
  let note: string | undefined;
  let selfHealAttempted = false;

  while (iterations < MAX_ITERATIONS) {
    if (signal?.aborted) {
      note = '任务已取消';
      break;
    }
    iterations++;

    let result: { content: string; toolCalls?: ToolCall[]; finishReason: string };
    try {
      result = await window.api.ai.chat(providerId, messages, {
        model,
        systemPrompt,
        workspaceRoot,
        tools: BUILTIN_TOOLS,
      } as never);
    } catch (err: unknown) {
      note = `模型调用失败：${err instanceof Error ? err.message : String(err)}`;
      break;
    }

    lastContent = result.content || lastContent;

    const assistantMsg: ChatMessage = {
      id: uuid(),
      role: 'assistant',
      content: result.content || '',
      toolCalls: result.toolCalls,
      timestamp: Date.now(),
    };

    if (!result.toolCalls?.length || result.finishReason !== 'tool_calls') {
      messages = [...messages, assistantMsg];
      // Self-verify once: if the task edited files, run lint/type-check on them
      // and feed any errors back so it can fix them before finishing. Enabled by
      // the shared node_modules symlink, which lets tsc/eslint run in the worktree.
      if (!selfHealAttempted && editedFiles.size > 0) {
        selfHealAttempted = true;
        let check: { hasErrors: boolean; output: string } | null = null;
        try {
          check = await window.api.lint.check(workspaceRoot, Array.from(editedFiles));
        } catch {
          check = null; // lint unavailable — skip self-heal
        }
        if (check?.hasErrors && check.output) {
          messages = [
            ...messages,
            {
              id: uuid(),
              role: 'user',
              content:
                '你的改动引入了以下 lint/类型错误，请修复它们（不要重复无效操作）：\n\n```\n' +
                check.output.slice(0, 4000) +
                '\n```',
              timestamp: Date.now(),
            },
          ];
          continue;
        }
      }
      break; // task runner considers the task done
    }

    // Detect a stuck task repeating identical calls with no progress.
    const signature = JSON.stringify(result.toolCalls.map((tc) => [tc.name, tc.arguments]));
    repeatCount = signature === lastSignature ? repeatCount + 1 : 0;
    lastSignature = signature;
    if (repeatCount >= 2) {
      note = '检测到重复操作且无进展，自动停止';
      messages = [...messages, assistantMsg];
      break;
    }

    const toolResults = [];
    for (const tc of result.toolCalls) {
      if (signal?.aborted) {
        note = '任务已取消';
        break;
      }
      try {
        const content = await runToolWithRetry(tc, ctx);
        toolResults.push({ toolCallId: tc.id, content });
      } catch (err: unknown) {
        const { message } = classifyToolError(err);
        toolResults.push({ toolCallId: tc.id, content: `错误：${message}`, isError: true });
      }
    }

    messages = [
      ...messages,
      assistantMsg,
      { id: uuid(), role: 'tool', content: '', toolResults, timestamp: Date.now() },
    ];
  }

  if (iterations >= MAX_ITERATIONS && !note) {
    note = `已达最大 ${MAX_ITERATIONS} 轮工具调用上限，自动停止`;
  }

  return { content: lastContent, iterations, editedFiles: Array.from(editedFiles), note };
}
