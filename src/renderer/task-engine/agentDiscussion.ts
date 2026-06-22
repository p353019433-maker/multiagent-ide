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
  /**
   * Per-call timeout in ms. A single hanging ai.chat / cliAgent.run is raced
   * against this; on expiry the call fails with a timeout error and the round
   * continues, so one stuck agent can't block the whole discussion.
   * Default 120000 (2 min); the moderator gets `moderatorTimeoutMs`.
   */
  callTimeoutMs?: number;
  /** Moderator step timeout (default 180000 / 3 min — it ingests the transcript). */
  moderatorTimeoutMs?: number;
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
 * Per-call timeout defaults. API chat is fast (2 min ceiling); CLI shells
 * (claude -p / codex exec / agy -p) are agentic and routinely take minutes
 * on a cold start, so they get 6 min — *longer* than the main process's own
 * 5-min CLI timeout (cli-agent-service.ts). That ordering is deliberate: the
 * main-side timeout actually kills the subprocess and returns a meaningful
 * "超时 5 分钟,已终止" error; the renderer-side race is only a safety net for
 * when IPC itself dies. If the renderer fired first, the subprocess would be
 * orphaned (main keeps running it) and the error message would be the
 * renderer's generic "超时" instead of main's real one.
 */
const API_CALL_TIMEOUT_MS = 120_000;
const CLI_CALL_TIMEOUT_MS = 360_000;
// Defaults: discuss turn uses the longer CLI bound by default so the race never
// fires before the main-process CLI timeout (5 min); API calls in askApi pass
// API_CALL_TIMEOUT_MS explicitly via timedAsk's kind-based selection.
const DEFAULT_CALL_TIMEOUT_MS = CLI_CALL_TIMEOUT_MS;
const DEFAULT_MODERATOR_TIMEOUT_MS = 540_000; // 9 min — moderator ingests the whole transcript

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

async function withTimeout<T>(p: Promise<T>, timeoutMs: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} 超时（${timeoutMs}ms）`)), timeoutMs);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function askApi(agent: DiscussionAgent, system: string, user: string, maxTokens: number, timeoutMs: number): Promise<{ text: string; rawLength: number; error?: string }> {
  if (!agent.providerId) return { text: '', rawLength: 0, error: 'API agent missing providerId' };
  try {
    const res = (await withTimeout(
      window.api.ai.chat(
        agent.providerId,
        [{ role: 'user', content: user }],
        { model: agent.model, systemPrompt: system, maxTokens, temperature: 0.4 }
      ),
      timeoutMs,
      `${agent.name} (ai.chat)`
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

async function askCli(agent: DiscussionAgent, system: string, user: string, rootPath: string, timeoutMs: number): Promise<{ text: string; rawLength: number; error?: string }> {
  // CLIs don't have a separate system-prompt channel, so we inline it.
  // We explicitly forbid file edits so this phase is read-only — only the
  // implementation phase touches the worktree.
  const prompt =
    `${system}\n\n` +
    `严格只输出讨论文字,不要修改任何文件,不要运行 git,不要调用工具。\n\n` +
    `---\n${user}`;

  // Drive the CLI via the streaming IPC. The main process classifies startup
  // failures (ENOENT / not-logged-in / silent-for-30s / timeout) and emits an
  // `error` event immediately — so the user sees "未登录 Claude Code" within
  // seconds instead of waiting timeoutMs for a generic hang. We still wrap in
  // withTimeout() as a safety net for IPC itself dying, but in normal operation
  // the main-side error/complete events arrive first.
  const runPromise = new Promise<{ ok: boolean; output: string; error?: string; errorKind?: string }>((resolve, reject) => {
    let buffer = '';
    let errBuf = '';
    let settled = false;
    window.api.cliAgent.runStream(
      rootPath,
      {
        tool: agent.kind as 'claude-code' | 'codex' | 'antigravity',
        prompt,
        model: agent.model || undefined,
        baseURL: agent.baseURL,
        apiKey: agent.apiKey,
      },
      (event) => {
        if (settled) return;
        switch (event.type) {
          case 'stdout':
            buffer += event.chunk;
            break;
          case 'stderr':
            errBuf += event.chunk;
            break;
          case 'error':
            // Classified startup/runtime error from main — surface immediately.
            settled = true;
            reject(new Error(event.message));
            break;
          case 'complete':
            settled = true;
            resolve(event.result);
            break;
          // 'start' / 'exit' are informational for the UI; no action here.
        }
      }
    ).catch((e: unknown) => {
      if (!settled) {
        settled = true;
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
    // errBuf is currently unused beyond debugging; keep it in scope so a future
    // "show CLI stderr in the diagnostics panel" feature can read it. Avoids a
    // TS unused-var without silencing the whole function.
    void errBuf;
  });

  try {
    const res = await withTimeout(runPromise, timeoutMs, `${agent.name} (cliAgent.runStream)`);
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
async function ask(agent: DiscussionAgent, system: string, user: string, maxTokens: number, rootPath: string | null | undefined, timeoutMs: number): Promise<{ text: string; rawLength: number; error?: string }> {
  if (agent.kind === 'api') return askApi(agent, system, user, maxTokens, timeoutMs);
  // CLI shells need a cwd. Without a workspace they can't run — that's a real
  // limitation of the CLI tools themselves, surface it as "no contribution".
  if (!rootPath) return { text: '', rawLength: 0, error: 'CLI agent requires an open workspace' };
  return askCli(agent, system, user, rootPath, timeoutMs);
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

  const callTimeoutMs = params.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
  const moderatorTimeoutMs = params.moderatorTimeoutMs ?? DEFAULT_MODERATOR_TIMEOUT_MS;
  /**
   * Per-agent timeout: API chat is fast (<= 2 min budget); CLI shells need
   * the longer ceiling so they don't race-lose to a too-tight renderer timer
   * before the main-process CLI service can itself bound the subprocess.
   * `callTimeoutMs` (if explicitly passed by the caller) overrides both.
   */
  const timeoutFor = (a: DiscussionAgent): number =>
    params.callTimeoutMs ?? (a.kind === 'api' ? API_CALL_TIMEOUT_MS : CLI_CALL_TIMEOUT_MS);

  /** ask() + timing + onCall. Returns the cleaned reply text (may be ''). */
  const timedAsk = async (
    a: DiscussionAgent,
    round: number,
    system: string,
    user: string,
    maxTokens: number,
    timeoutMs: number
  ): Promise<string> => {
    const t0 = Date.now();
    const res = await ask(a, system, user, maxTokens, rootPath, timeoutMs);
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
    const replies = await Promise.all(agents.map((a) => timedAsk(a, round, sysFor(a), user, DISCUSS_TOKENS, callTimeoutMs)));
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
    MODERATOR_TOKENS,
    moderatorTimeoutMs
  );
  onPhase?.(aborted() ? '已取消' : '完成');
  return { transcript, plan, durationMs: Date.now() - startedAt, aborted: aborted() };
}
