/**
 * In-app free-shared-discussion engine (Phase 2 of the multi-agent system).
 *
 * Every enabled agent contributes to a shared transcript across N rounds, then
 * a moderator converges the discussion into one unified plan.
 *
 * Two backends:
 *  - API agents (`kind === 'api'` with providerId+model) reach the model via
 *    `ai.chat` IPC, supporting reasoning models like DeepSeek (the <think>
 *    channel is stripped).
 *  - CLI shells (`claude-code` / `codex` / `antigravity`) are driven headlessly
 *    via `cliAgent.run`, each in the user's repo root. The CLI is told NOT to
 *    edit files in this phase — its stdout IS the agent's discussion turn.
 *
 * If only CLI agents are enabled, the moderator step uses the first CLI shell
 * to converge; if an API agent is available, it's preferred (cheaper + faster).
 */

import type { AgentKind } from '@shared/types';

export interface DiscussionAgent {
  id: string;
  name: string;
  kind: AgentKind;
  /** API agents only. */
  providerId?: string;
  model: string;
  /** CLI shells only: optional backing API. */
  baseURL?: string;
  apiKey?: string;
}

export interface DiscussionMessage {
  agentId: string;
  agentName: string;
  round: number;
  text: string;
}

export interface RunDiscussionParams {
  agents: DiscussionAgent[];
  question: string;
  /** Discussion rounds before the moderator converges (default 2). */
  rounds?: number;
  /** Workspace root for CLI shells; falls back to a temp dir if not provided. */
  rootPath?: string | null;
  onMessage?: (m: DiscussionMessage) => void;
  onPhase?: (phase: string) => void;
  /** Fired once per agent invocation (discuss turn or moderator) with timing +
   *  ok/fail + a head/tail sample, so the caller can append a diagnostic log. */
  onCall?: (info: DiscussionCallInfo) => void;
  /** Cooperative cancellation; checked between rounds. */
  signal?: { aborted: boolean };
}

/** Diagnostic snapshot of one agent invocation, handed to onCall for logging. */
export interface DiscussionCallInfo {
  agentId: string;
  agentName: string;
  agentKind: AgentKind;
  /** Round number; 0 = the moderator convergence step. */
  round: number;
  ok: boolean;
  durationMs: number;
  /** Length of the *cleaned* reply (after stripThink / condenseCliOutput). */
  outputLength: number;
  outputHead?: string;
  outputTail?: string;
  error?: string;
  model?: string;
  providerId?: string;
}

export interface DiscussionResult {
  transcript: DiscussionMessage[];
  plan: string;
  /** Wall-clock ms of the whole run (start → moderator done), for the end log. */
  durationMs: number;
  aborted: boolean;
}

// Reasoning models can burn thousands of tokens thinking before they answer
// (see the spike findings), so budget generously — especially the moderator,
// whose input is the whole transcript.
const DISCUSS_TOKENS = 2500;
const MODERATOR_TOKENS = 8000;
const DEFAULT_ROUNDS = 2;

/**
 * Strip a reasoning model's `<think>` channel. Returns '' when the reply is only
 * an unclosed think block (the model spent its whole budget thinking and never
 * produced a real answer) so callers can treat that agent as "no contribution".
 */
export function stripThink(s: string | null | undefined): string {
  if (!s) return '';
  const noThink = s.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  if (/<think>/.test(noThink)) return '';
  return noThink;
}

export function transcriptText(t: DiscussionMessage[]): string {
  return t.map((m) => `【${m.agentName}】${m.text}`).join('\n\n');
}

/** Take a CLI shell's stdout and reduce it to a single discussion-sized reply. */
export function condenseCliOutput(s: string): string {
  if (!s) return '';
  // Strip ANSI escapes, drop blank lines, and clip to ~600 chars so a chatty
  // CLI doesn't drown the transcript. The moderator gets the whole transcript
  // either way, so condensation is purely a display/cost concern.
  const cleaned = s
    // eslint-disable-next-line no-control-regex
    .replace(/\[[0-9;]*[A-Za-z]/g, '')
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join('\n')
    .trim();
  return cleaned.length > 800 ? cleaned.slice(0, 800) + '…' : cleaned;
}

/** Take the head and tail of a string so log entries stay small but useful. */
export function sampleText(s: string, n = 200): { head?: string; tail?: string } {
  if (!s) return {};
  if (s.length <= n * 2) return { head: s };
  return { head: s.slice(0, n), tail: s.slice(-n) };
}

async function askApi(agent: DiscussionAgent, system: string, user: string, maxTokens: number): Promise<{ text: string; rawLength: number; error?: string }> {
  if (!agent.providerId) return { text: '', rawLength: 0, error: 'API agent missing providerId' };
  try {
    const res = (await window.api.ai.chat(
      agent.providerId,
      [{ role: 'user', content: user }],
      { model: agent.model, systemPrompt: system, maxTokens, temperature: 0.4 }
    )) as { content?: string } | null;
    const raw = res?.content ?? '';
    const text = stripThink(raw);
    // rawLength is the pre-strip output (so logs catch "all-think, no answer"
    // cases). text is the post-strip reply the rest of the system uses.
    return { text, rawLength: raw.length };
  } catch (e) {
    return { text: '', rawLength: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

async function askCli(agent: DiscussionAgent, system: string, user: string, rootPath: string): Promise<{ text: string; rawLength: number; error?: string }> {
  // CLIs don't have a separate system-prompt channel, so we inline it.
  // We explicitly forbid file edits so this phase is read-only — only the
  // implementation phase touches the worktree.
  const prompt =
    `${system}\n\n` +
    `严格只输出讨论文字,不要修改任何文件,不要运行 git,不要调用工具。\n\n` +
    `---\n${user}`;
  try {
    const res = await window.api.cliAgent.run(rootPath, {
      // ask() only routes CLI shells here (kind !== 'api'); narrow for the IPC type.
      tool: agent.kind as 'claude-code' | 'codex' | 'antigravity',
      prompt,
      model: agent.model || undefined,
      baseURL: agent.baseURL,
      apiKey: agent.apiKey,
    });
    if (!res.ok) return { text: '', rawLength: (res.output ?? '').length, error: res.error || `${agent.kind} exited non-zero` };
    const raw = res.output ?? '';
    return { text: condenseCliOutput(raw), rawLength: raw.length };
  } catch (e) {
    return { text: '', rawLength: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Internal-shaped call result so the caller can build a DiscussionCallInfo for
 * logging. ask() returns `text` (the cleaned reply that becomes a transcript
 * entry) plus diagnostics (`rawLength`, `error`).
 */
async function ask(agent: DiscussionAgent, system: string, user: string, maxTokens: number, rootPath: string | null | undefined): Promise<{ text: string; rawLength: number; error?: string }> {
  if (agent.kind === 'api') return askApi(agent, system, user, maxTokens);
  // CLI shells need a cwd. Without a workspace they can't run — that's a real
  // limitation of the CLI tools themselves, surface it as "no contribution".
  if (!rootPath) return { text: '', rawLength: 0, error: 'CLI agent requires an open workspace' };
  return askCli(agent, system, user, rootPath);
}

export async function runDiscussion(params: RunDiscussionParams): Promise<DiscussionResult> {
  const { agents, question, onMessage, onPhase, onCall, rootPath } = params;
  const rounds = params.rounds ?? DEFAULT_ROUNDS;
  const transcript: DiscussionMessage[] = [];
  const aborted = () => params.signal?.aborted === true;
  const startedAt = Date.now();

  const sysFor = (a: DiscussionAgent) =>
    `你是多 agent 协作中的「${a.name}」。和其他 agent 自由讨论用户问题,简明给出你的观点(不超过 150 字),` +
    `可赞同或反驳他人。目标是大家收敛出一个统一方案。`;

  /** ask() + timing + onCall. Returns the cleaned reply text (may be ''). */
  const timedAsk = async (
    a: DiscussionAgent,
    round: number,
    system: string,
    user: string,
    maxTokens: number
  ): Promise<string> => {
    const t0 = Date.now();
    const res = await ask(a, system, user, maxTokens, rootPath);
    const durationMs = Date.now() - t0;
    const sample = sampleText(res.text);
    onCall?.({
      agentId: a.id,
      agentName: a.name,
      agentKind: a.kind,
      round,
      ok: !res.error && res.text.length > 0,
      durationMs,
      outputLength: res.text.length,
      outputHead: sample.head,
      outputTail: sample.tail,
      error: res.error,
      model: a.model || undefined,
      providerId: a.providerId,
    });
    return res.text;
  };

  for (let round = 1; round <= rounds && !aborted(); round++) {
    onPhase?.(`第 ${round}/${rounds} 轮讨论`);
    const user =
      round === 1
        ? question
        : `用户问题：${question}\n\n目前讨论：\n${transcriptText(transcript)}\n\n请回应其他 agent、推动收敛(不超过 120 字)。`;
    const replies = await Promise.all(agents.map((a) => timedAsk(a, round, sysFor(a), user, DISCUSS_TOKENS)));
    if (aborted()) break;
    agents.forEach((a, i) => {
      const text = replies[i];
      if (!text) return; // produced nothing (e.g. blew its token budget) — skip
      const m: DiscussionMessage = { agentId: a.id, agentName: a.name, round, text };
      transcript.push(m);
      onMessage?.(m);
    });
  }

  if (aborted() || transcript.length === 0) {
    return { transcript, plan: '', durationMs: Date.now() - startedAt, aborted: aborted() };
  }

  // Prefer an API agent for moderation (cheaper, faster, real system prompt).
  // Fall back to the first agent that actually contributed.
  const apiModerator = agents.find((a) => a.kind === 'api' && a.providerId);
  const fallbackModerator = transcript.length
    ? agents.find((a) => a.id === transcript[0].agentId) ?? agents[0]
    : agents[0];
  const moderator = apiModerator ?? fallbackModerator;

  onPhase?.('主持人收敛中…');
  const plan = await timedAsk(
    moderator,
    0,
    '你是讨论主持人。基于多 agent 的讨论,提炼出各方共识的【统一方案】:3-5 条明确、可执行的要点。只输出方案,不要复述讨论。',
    `用户问题：${question}\n\n完整讨论：\n${transcriptText(transcript)}`,
    MODERATOR_TOKENS
  );
  onPhase?.(aborted() ? '已取消' : '完成');
  return { transcript, plan, durationMs: Date.now() - startedAt, aborted: aborted() };
}
