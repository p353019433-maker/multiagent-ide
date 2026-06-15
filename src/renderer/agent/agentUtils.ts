/**
 * Pure agent helpers extracted from ChatPanel — no React, no side effects.
 * Kept dependency-free so they're trivial to unit-test.
 */

import { v4 as uuid } from 'uuid';
import type { ChatMessage as ChatMessageType } from '@shared/types';

/**
 * Resolve a tool-supplied path against the workspace root, rejecting any path
 * that escapes the workspace (absolute paths outside root, `..` traversal).
 *
 * The previous implementation special-cased inputs that started with the
 * workspace root + "/", returning them verbatim. That allowed an absolute path
 * like `/repo/../../etc/passwd` to bypass the `..` normalization. We now route
 * every input through the same segment-based resolution so all inputs are
 * normalized. The IPC layer (`assertAllowedPath` + `realpath`) is the
 * authoritative containment check; this renderer-side check is defense in depth.
 */
export function resolveWorkspacePath(rootPath: string | null, p: string): string {
  if (!rootPath) throw new Error('未打开工作区');

  // Treat backslashes as separators on all platforms (Windows-style input on a
  // POSIX path, etc.) so a path like "..\..\etc\passwd" can't sneak past.
  let segments = p.split(/[/\\]/).filter((s) => s.length > 0);

  // Reject Windows drive-letter paths outright.
  if (segments.length > 0 && /^[A-Za-z]:/.test(segments[0])) {
    throw new Error('拒绝访问：路径超出工作区');
  }

  // If the input is an absolute POSIX path inside the workspace, strip the
  // workspace prefix so the rest is treated like a relative path. If it's an
  // absolute path outside the workspace, reject outright.
  const rootSegments = rootPath.split(/[/\\]/).filter((s) => s.length > 0);
  if (segments.length > 0 && p.startsWith('/')) {
    if (rootSegments.length <= segments.length) {
      let same = true;
      for (let i = 0; i < rootSegments.length; i++) {
        if (segments[i] !== rootSegments[i]) { same = false; break; }
      }
      if (same) {
        // Path lies inside the workspace — drop the root prefix.
        segments = segments.slice(rootSegments.length);
      } else {
        // Outside the workspace — there's no segment walk that would
        // normalize it back inside, so reject.
        throw new Error('拒绝访问：路径超出工作区');
      }
    } else {
      throw new Error('拒绝访问：路径超出工作区');
    }
  }

  const resolved: string[] = [];
  for (const seg of segments) {
    if (seg === '..') {
      if (resolved.length === 0) {
        // Walking above the workspace root via a relative path.
        throw new Error('拒绝访问：检测到路径越界');
      }
      resolved.pop();
    } else if (seg !== '.') {
      resolved.push(seg);
    }
  }

  return rootPath + '/' + resolved.join('/');
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

  // Likewise, a tail-leading assistant message may carry toolCalls whose
  // tool_results were dropped into the summary. Stripping those toolCalls keeps
  // the request well-formed (an assistant tool_use with no tool_result is a hard
  // error on both OpenAI and Anthropic). Only do this for the first assistant;
  // any later tool_calls in the tail are followed by their own tool results.
  if (trimmedTail.length && trimmedTail[0].role === 'assistant' && trimmedTail[0].toolCalls?.length) {
    const first = trimmedTail[0];
    trimmedTail = [
      { ...first, toolCalls: undefined },
      ...trimmedTail.slice(1),
    ];
  }

  return [summary, ...trimmedTail];
}
