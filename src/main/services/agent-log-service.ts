/**
 * Agent-run logging — durable, line-delimited diagnostic trail of every
 * agent interaction so we can answer "why didn't this agent talk?" after
 * the fact. Two surfaces, both written into `<workspace>/.ide/`:
 *
 *  - `agent-log.jsonl` — append-only one-event-per-line diagnostic log.
 *    Stable schema, grep-friendly, capped at ~5MB with a single .1 rotation.
 *    Every CLI / API call records duration, ok/fail, stdoutLength, head/tail
 *    samples, and the full error on failure. Stdout itself is NOT dumped —
 *    that's what the round transcript is for.
 *
 *  - `rounds/<iso>__<slug>.md` — human-readable transcript of one full round
 *    table run: question, every agent's contribution per round, the moderator's
 *    converged plan, any notice. Only written when a discussion actually
 *    produced something (transcript non-empty).
 *
 * Both writers are best-effort: any IO error is swallowed so logging never
 * blocks an agent run.
 */

import fs from 'fs/promises';
import path from 'path';

const LOG_FILE = 'agent-log.jsonl';
const ROUNDS_DIR = 'rounds';
const IDE_DIR = '.ide';
const MAX_LOG_BYTES = 5 * 1024 * 1024; // 5MB before rotating to .1

/** One JSONL event. `kind` distinguishes call/round/error families. */
export interface AgentLogEvent {
  /** ISO timestamp at write time. */
  ts: string;
  /** Family of event — keeps the JSONL grep-friendly. */
  kind:
    | 'discussion-call'      // single agent's turn (one API or CLI invocation)
    | 'discussion-round'     // start of a round (round N, agents=[...])
    | 'discussion-start'     // the run begins (question, agents, rootPath)
    | 'discussion-end'       // the run ends (transcriptLength, planLength, durationMs)
    | 'implementation-call'  // one agent's implementation in its worktree
    | 'notice';              // user-facing notice (mirrors UI rt.notice)
  /** Free-form fields per event. The shape is documented at the call site. */
  [key: string]: unknown;
}

/** Stable shape used by call-site helpers; keeps writeEvent type-safe. */
export interface DiscussionCallEvent extends AgentLogEvent {
  kind: 'discussion-call';
  agentId: string;
  agentName: string;
  agentKind: 'api' | 'claude-code' | 'codex' | 'antigravity' | 'opencode';
  round: number;
  ok: boolean;
  durationMs: number;
  /** Bytes of returned text after stripThink / condenseCliOutput. */
  outputLength: number;
  /** First N chars of the cleaned reply, for at-a-glance diagnosis. */
  outputHead?: string;
  /** Last N chars (mostly useful for CLI shells whose tail signals errors). */
  outputTail?: string;
  /** Full error message when ok=false. CLIs may stuff stderr in here. */
  error?: string;
  /** For API agents: model id; for CLIs: the --model passed if any. */
  model?: string;
  /** For API agents only. */
  providerId?: string;
}

/**
 * Take the head and tail of a string so log entries stay small but useful.
 * - Empty input → both fields empty.
 * - Short input (≤ 2n) → just head.
 * - Long input → head + tail of n chars each.
 * The renderer-side `sampleText` in agentDiscussion.ts is intentionally similar;
 * either can call this helper if we consolidate later.
 */
export function sampleText(s: string, n = 200): { head: string; tail: string } {
  if (!s) return { head: '', tail: '' };
  if (s.length <= n * 2) return { head: s, tail: '' };
  return { head: s.slice(0, n), tail: s.slice(-n) };
}

/** A round-table transcript ready to dump as markdown. */
export interface RoundTranscript {
  question: string;
  agents: { id: string; name: string; kind: string; role?: string }[];
  /** Either a per-round-discussion messages list (legacy) … */
  messages?: { agentId: string; agentName: string; round: number; text: string }[];
  /** … or a parallel-review card list (negotiated review mode). */
  cards?: { agentId: string; agentName: string; role: string; text: string; ok: boolean; durationMs: number; error?: string }[];
  /** Moderator-produced agent-id → role → weight (0-1) table. */
  weights?: Record<string, Record<string, number>>;
  plan: string;
  startedAt: number;
  endedAt: number;
  notice?: { tone: 'ok' | 'err'; text: string };
}

/** Slugify a question into a short, filesystem-safe label. */
export function slugifyQuestion(q: string): string {
  const trimmed = q.trim().replace(/\s+/g, '-');
  const safe = trimmed.replace(/[^\w一-鿿-]/g, ''); // keep CJK + word chars
  return (safe || 'round').slice(0, 40);
}

export class AgentLogService {
  /** Build `<workspace>/.ide/`, creating it on demand. */
  private ideDir(root: string): string {
    return path.join(root, IDE_DIR);
  }

  /** Build `<workspace>/.ide/agent-log.jsonl`. */
  private logPath(root: string): string {
    return path.join(this.ideDir(root), LOG_FILE);
  }

  /** Build `<workspace>/.ide/rounds/`. */
  private roundsDir(root: string): string {
    return path.join(this.ideDir(root), ROUNDS_DIR);
  }

  /** Ensure a directory exists. Best-effort — silently absorbs failures. */
  private async ensureDir(dir: string): Promise<void> {
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch {
      // best-effort
    }
  }

  /**
   * Rotate the log file when it crosses MAX_LOG_BYTES. Keeps exactly one
   * `.1` backup — we don't accumulate forever; this is a tail, not history.
   */
  private async rotateIfNeeded(file: string): Promise<void> {
    try {
      const stat = await fs.stat(file);
      if (stat.size < MAX_LOG_BYTES) return;
      const backup = `${file}.1`;
      // Drop the previous .1 (we only keep one rotation) then rename current.
      await fs.rm(backup, { force: true });
      await fs.rename(file, backup);
    } catch {
      // file may not exist yet — that's fine, no rotation needed
    }
  }

  /** Append one JSONL event. Best-effort. */
  async append(root: string, event: AgentLogEvent): Promise<void> {
    try {
      await this.ensureDir(this.ideDir(root));
      const file = this.logPath(root);
      await this.rotateIfNeeded(file);
      const line = JSON.stringify(event) + '\n';
      await fs.appendFile(file, line, 'utf-8');
    } catch {
      // best-effort
    }
  }

  /**
   * Read the most recent N events (newest last). Returns [] on any error or
   * if the file doesn't exist. Lines that fail to parse are skipped — we
   * never throw on a corrupt entry, the log is a diagnostic surface, not a
   * source of truth.
   */
  async readTail(root: string, limit = 200): Promise<AgentLogEvent[]> {
    try {
      const raw = await fs.readFile(this.logPath(root), 'utf-8');
      const lines = raw.split('\n').filter((l) => l.length > 0);
      const tail = lines.slice(-limit);
      const out: AgentLogEvent[] = [];
      for (const line of tail) {
        try {
          const parsed = JSON.parse(line) as AgentLogEvent;
          if (parsed && typeof parsed === 'object' && typeof parsed.kind === 'string') {
            out.push(parsed);
          }
        } catch {
          // skip malformed line
        }
      }
      return out;
    } catch {
      return [];
    }
  }

  /**
   * Render a round transcript to markdown and persist under .ide/rounds/.
   * Returns the absolute file path on success, or null on failure. We don't
   * write empty transcripts (length 0); that's noise.
   */
  async writeRound(root: string, t: RoundTranscript): Promise<string | null> {
    const hasMessages = t.messages && t.messages.length > 0;
    const hasCards = t.cards && t.cards.filter((c) => c.ok).length > 0;
    if (!hasMessages && !hasCards && !t.plan) return null;
    try {
      await this.ensureDir(this.roundsDir(root));
      const ts = new Date(t.startedAt);
      const isoSlug = ts.toISOString().replace(/[:.]/g, '-');
      const fname = `${isoSlug}__${slugifyQuestion(t.question)}.md`;
      const fpath = path.join(this.roundsDir(root), fname);
      const md = renderRoundMarkdown(t);
      await fs.writeFile(fpath, md, 'utf-8');
      return fpath;
    } catch {
      return null;
    }
  }
}

/** Render a transcript as a human-friendly markdown document. Exported for tests. */
export function renderRoundMarkdown(t: RoundTranscript): string {
  const lines: string[] = [];
  const title = t.cards ? '圆桌评审' : '圆桌讨论';
  lines.push(`# ${title}：${t.question.slice(0, 80)}`);
  lines.push('');
  lines.push(`- 开始：${new Date(t.startedAt).toLocaleString()}`);
  lines.push(`- 结束：${new Date(t.endedAt).toLocaleString()}`);
  lines.push(`- 耗时：${Math.round((t.endedAt - t.startedAt) / 1000)}s`);
  lines.push(`- 参与：${t.agents.map((a) => `${a.name} (${a.kind}${a.role ? '/' + a.role : ''})`).join('、') || '（无）'}`);
  if (t.notice) lines.push(`- 提示：[${t.notice.tone}] ${t.notice.text}`);
  lines.push('');
  lines.push(`## 议题`);
  lines.push('');
  lines.push(t.question);
  lines.push('');

  // Negotiated-review mode: one card per role.
  if (t.cards && t.cards.length > 0) {
    lines.push(`## 各角色评审`);
    lines.push('');
    for (const c of t.cards) {
      const head = c.ok ? `${c.agentName}（${c.role}）` : `${c.agentName}（${c.role}）[失败]`;
      lines.push(`### ${head}`);
      lines.push('');
      lines.push(c.ok ? c.text : c.error || '（无内容）');
      lines.push('');
    }
  } else if (t.messages && t.messages.length > 0) {
    // Legacy debate mode: group messages by round so the transcript reads like a meeting.
    const byRound = new Map<number, NonNullable<RoundTranscript['messages']>>();
    for (const m of t.messages) {
      const arr = byRound.get(m.round) ?? [];
      arr.push(m);
      byRound.set(m.round, arr);
    }
    const rounds = Array.from(byRound.keys()).sort((a, b) => a - b);
    for (const r of rounds) {
      lines.push(`## 第 ${r} 轮`);
      lines.push('');
      for (const m of byRound.get(r)!) {
        lines.push(`### ${m.agentName}`);
        lines.push('');
        lines.push(m.text);
        lines.push('');
      }
    }
  }

  if (t.plan) {
    lines.push(`## 统一方案`);
    lines.push('');
    lines.push(t.plan);
    lines.push('');
  }

  if (t.weights && Object.keys(t.weights).length > 0) {
    lines.push(`## 权重表`);
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify(t.weights, null, 2));
    lines.push('```');
    lines.push('');
  }

  return lines.join('\n');
}
