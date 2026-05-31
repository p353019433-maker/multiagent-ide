/**
 * Headless agent loop for background / orchestrated sub-tasks.
 *
 * The interactive agent (useAgentEngine) is bound to React state and the global
 * streaming IPC channels, so it can only drive ONE conversation at a time. The
 * orchestrator runs several sub-agents in parallel inside isolated git
 * worktrees, so it needs a self-contained loop that:
 *
 *   - uses the NON-streaming `ai.chat` (parallel streams would interleave on the
 *     single global `ai:stream-*` channel),
 *   - executes real tools via the shared {@link executeSingleTool} dispatch, and
 *   - auto-approves actions, since each agent is fenced inside its own worktree
 *     and there is no human watching to click "approve".
 *
 * This is what turns `orchestrate` from a text-only "复读机" into agents that can
 * actually read, edit, and run commands in their workspace.
 */

import { v4 as uuid } from 'uuid';
import type { ChatMessage, ToolCall } from '@shared/types';
import { BUILTIN_TOOLS, AGENT_SYSTEM_PROMPT } from '@shared/tools';
import { executeSingleTool, type ToolContext } from './toolExecutor';
import { resolveWorkspacePath, classifyToolError } from './agentUtils';

const MAX_ITERATIONS = 20;

export interface HeadlessAgentResult {
  /** The agent's final assistant text. */
  content: string;
  /** How many model round-trips ran. */
  iterations: number;
  /** Absolute paths the agent wrote to (deduped). */
  editedFiles: string[];
  /** Set when the loop ended abnormally (cap hit, error, stuck). */
  note?: string;
}

export interface HeadlessAgentParams {
  providerId: string;
  model: string;
  /** Absolute path of the isolated worktree this agent operates in. */
  workspaceRoot: string;
  /** The sub-task instruction. */
  task: string;
  /** Optional extra system guidance appended to the base agent prompt. */
  systemPromptSuffix?: string;
}

/** Run a tool with exponential-backoff retry on transient (retriable) errors. */
async function runToolWithRetry(tc: ToolCall, ctx: ToolContext, maxAttempts = 3): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
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
export async function runHeadlessAgent(params: HeadlessAgentParams): Promise<HeadlessAgentResult> {
  const { providerId, model, workspaceRoot, task, systemPromptSuffix } = params;

  const editedFiles = new Set<string>();
  const ctx: ToolContext = {
    rootPath: workspaceRoot,
    resolvePath: (p: string) => resolveWorkspacePath(workspaceRoot, p),
    // Auto-approve: the agent is sandboxed to its own worktree and runs
    // unattended. Path fencing in the main process still applies on every call.
    gateAction: async () => true,
    writeFileTracked: async (filePath: string, content: string) => {
      await window.api.fs.writeFile(filePath, content);
      editedFiles.add(filePath);
    },
    // Background agents don't act on GitHub; surface a clear failure if they try.
    getGitHubContext: async () => ({ token: null, info: null }),
  };

  const systemPrompt = systemPromptSuffix
    ? `${AGENT_SYSTEM_PROMPT}\n\n${systemPromptSuffix}`
    : AGENT_SYSTEM_PROMPT;

  let messages: ChatMessage[] = [
    { id: uuid(), role: 'user', content: task, timestamp: Date.now() },
  ];

  let lastContent = '';
  let lastSignature = '';
  let repeatCount = 0;
  let iterations = 0;
  let note: string | undefined;

  while (iterations < MAX_ITERATIONS) {
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
      break; // agent considers the task done
    }

    // Detect a stuck agent repeating identical calls with no progress.
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
