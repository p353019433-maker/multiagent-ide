/**
 * In-app free-shared-discussion engine (Phase 2 of the multi-agent system).
 *
 * Ports the validated standalone spike onto the app's ai-service path: every
 * enabled API agent contributes to a shared transcript across N rounds, then a
 * moderator converges the discussion into one unified plan. Tuned for the
 * reasoning models we tested (give a generous token budget, strip the <think>
 * channel, and skip an agent that produced nothing).
 *
 * API agents only for now; CLI agents (Claude Code / Codex) join in a later step.
 */

export interface DiscussionAgent {
  id: string;
  name: string;
  providerId: string;
  model: string;
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
  onMessage?: (m: DiscussionMessage) => void;
  onPhase?: (phase: string) => void;
  /** Cooperative cancellation; checked between rounds. */
  signal?: { aborted: boolean };
}

export interface DiscussionResult {
  transcript: DiscussionMessage[];
  plan: string;
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

async function ask(agent: DiscussionAgent, system: string, user: string, maxTokens: number): Promise<string> {
  try {
    const res = (await window.api.ai.chat(
      agent.providerId,
      [{ role: 'user', content: user }],
      { model: agent.model, systemPrompt: system, maxTokens, temperature: 0.4 }
    )) as { content?: string } | null;
    return stripThink(res?.content);
  } catch {
    return '';
  }
}

export async function runDiscussion(params: RunDiscussionParams): Promise<DiscussionResult> {
  const { agents, question, onMessage, onPhase } = params;
  const rounds = params.rounds ?? DEFAULT_ROUNDS;
  const transcript: DiscussionMessage[] = [];
  const aborted = () => params.signal?.aborted === true;

  const sysFor = (a: DiscussionAgent) =>
    `你是多 agent 协作中的「${a.name}」。和其他 agent 自由讨论用户问题,简明给出你的观点(不超过 150 字),` +
    `可赞同或反驳他人。目标是大家收敛出一个统一方案。`;

  for (let round = 1; round <= rounds && !aborted(); round++) {
    onPhase?.(`第 ${round}/${rounds} 轮讨论`);
    const user =
      round === 1
        ? question
        : `用户问题：${question}\n\n目前讨论：\n${transcriptText(transcript)}\n\n请回应其他 agent、推动收敛(不超过 120 字)。`;
    const replies = await Promise.all(agents.map((a) => ask(a, sysFor(a), user, DISCUSS_TOKENS)));
    if (aborted()) break;
    agents.forEach((a, i) => {
      const text = replies[i];
      if (!text) return; // produced nothing (e.g. blew its token budget) — skip
      const m: DiscussionMessage = { agentId: a.id, agentName: a.name, round, text };
      transcript.push(m);
      onMessage?.(m);
    });
  }

  if (aborted() || transcript.length === 0) return { transcript, plan: '' };

  onPhase?.('主持人收敛中…');
  const plan = await ask(
    agents[0],
    '你是讨论主持人。基于多 agent 的讨论,提炼出各方共识的【统一方案】:3-5 条明确、可执行的要点。只输出方案,不要复述讨论。',
    `用户问题：${question}\n\n完整讨论：\n${transcriptText(transcript)}`,
    MODERATOR_TOKENS
  );
  onPhase?.(aborted() ? '已取消' : '完成');
  return { transcript, plan };
}
