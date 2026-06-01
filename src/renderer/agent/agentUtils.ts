/**
 * Pure agent helpers extracted from ChatPanel — no React, no side effects.
 * Kept dependency-free so they're trivial to unit-test.
 */

import { v4 as uuid } from 'uuid';
import type { ChatMessage as ChatMessageType } from '@shared/types';

/**
 * Resolve a tool-supplied path against the workspace root, rejecting any path
 * that escapes the workspace (absolute paths, `..` traversal).
 */
export function resolveWorkspacePath(rootPath: string | null, p: string): string {
  if (!rootPath) throw new Error('未打开工作区');
  if (p.startsWith(rootPath + '/') || p === rootPath) return p;
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) throw new Error('拒绝访问：路径超出工作区');
  const segments = p.split(/[/\\]/);
  const resolved: string[] = [];
  for (const seg of segments) {
    if (seg === '..') {
      if (resolved.length === 0) throw new Error('拒绝访问：检测到路径越界');
      resolved.pop();
    } else if (seg !== '.' && seg !== '') {
      resolved.push(seg);
    }
  }
  const result = rootPath + '/' + resolved.join('/');

  // Block access to .git internals — a compromised agent could otherwise
  // overwrite hooks (e.g. .git/hooks/pre-commit) to execute arbitrary code
  // on the user's next commit. This is a hard security boundary.
  if (resolved.some((seg) => seg === '.git')) {
    throw new Error('拒绝访问：禁止读写 .git 目录（安全策略）');
  }

  return result;
}

/**
 * Classify a tool error so the agent gets actionable feedback. Transient
 * failures (network/timeout/locks) are retriable; logic errors are not.
 */
export function classifyToolError(err: unknown): { message: string; retriable: boolean } {
  const message = (err as { message?: string })?.message || String(err);
  const lower = message.toLowerCase();
  const retriable =
    /etimedout|econnreset|enotfound|socket hang up|network|timeout|429|rate limit|temporarily|eai_again|lock/i.test(
      lower
    );
  return { message, retriable };
}

const COMPACT_THRESHOLD = 40;
const KEEP_RECENT = 16;

/**
 * Keep the conversation within a sane size for the model. When the history
 * grows past a threshold we summarize the older turns into a single synthetic
 * message and keep the most recent turns verbatim. This prevents unbounded
 * token growth (and cost) on long agent sessions.
 */
export function compactMessages(msgs: ChatMessageType[]): ChatMessageType[] {
  if (msgs.length <= COMPACT_THRESHOLD) return msgs;

  const head = msgs.slice(0, msgs.length - KEEP_RECENT);
  const tail = msgs.slice(msgs.length - KEEP_RECENT);

  // Build a compact textual summary of the older turns. Tool payloads are
  // dropped; only roles and trimmed content/tool names are retained.
  const summaryLines: string[] = [];
  for (const m of head) {
    if (m.role === 'user') {
      summaryLines.push(`用户: ${m.content.slice(0, 200)}`);
    } else if (m.role === 'assistant') {
      if (m.content) summaryLines.push(`助手: ${m.content.slice(0, 200)}`);
      if (m.toolCalls?.length) {
        summaryLines.push(`助手调用工具: ${m.toolCalls.map((t) => t.name).join(', ')}`);
      }
    } else if (m.role === 'tool' && m.toolResults) {
      summaryLines.push(
        `工具结果: ${m.toolResults.map((r) => (r.isError ? '失败' : '成功')).join(', ')}`
      );
    }
  }

  const summary: ChatMessageType = {
    id: uuid(),
    role: 'user',
    content: '[以下是早期对话的压缩摘要，用于节省上下文]\n' + summaryLines.join('\n').slice(0, 4000),
    timestamp: head[0]?.timestamp || Date.now(),
  };

  // The tail must not start with a dangling tool result whose tool_use is now
  // in the summarized head — drop leading tool messages to keep the API happy.
  let trimmedTail = tail;
  while (trimmedTail.length && trimmedTail[0].role === 'tool') {
    trimmedTail = trimmedTail.slice(1);
  }

  return [summary, ...trimmedTail];
}
