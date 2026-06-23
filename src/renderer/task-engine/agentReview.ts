/**
 * Negotiation-based review engine (Phase 2 of the multi-agent system).
 *
 * Every enabled agent evaluates the user's question from its ASSIGNED ROLE
 * (architect, security, testing, style, general). A moderator then synthesizes
 * the per-dimension cards into a unified plan, plus a weight table used for
 * ranking Phase 3 implementations.
 *
 * No free-form discussion, no rounds — just parallel independent evaluation.
 */

import type { AgentKind, AgentRole } from '@shared/types';

export interface ReviewAgent {
  id: string;
  name: string;
  kind: AgentKind;
  role: AgentRole;
  providerId?: string;
  model: string;
  baseURL?: string;
  apiKey?: string;
}

export interface ReviewCard {
  agentId: string;
  agentName: string;
  role: AgentRole;
  text: string;
  durationMs: number;
  ok: boolean;
  error?: string;
}

/** Each agent's weight on each dimension (0-1). Produced by the moderator. */
export interface WeightTable {
  [agentId: string]: Record<AgentRole, number>;
}

export interface ReviewResult {
  cards: ReviewCard[];
  dimensionSummaries: Record<AgentRole, string>;
  plan: string;
  weights: WeightTable;
  durationMs: number;
  aborted: boolean;
}

export interface RunReviewParams {
  agents: ReviewAgent[];
  question: string;
  rootPath?: string | null;
  onCard?: (c: ReviewCard) => void;
  onPhase?: (phase: string) => void;
  onCall?: (info: {
    agentId: string;
    agentName: string;
    agentKind: AgentKind;
    role: AgentRole;
    ok: boolean;
    durationMs: number;
    outputLength: number;
    error?: string;
  }) => void;
  signal?: { aborted: boolean };
}

// Review token budgets — stay concise.
const REVIEW_TOKENS = 1500;
const MODERATOR_TOKENS = 3500;

const API_CALL_TIMEOUT_MS = 120_000;
const CLI_CALL_TIMEOUT_MS = 360_000;

/** Strip a reasoning model's <think> channel (reused from agentDiscussion). */
function stripThink(s: string | null | undefined): string {
  if (!s) return '';
  const noThink = s.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  if (/<think>/.test(noThink)) return '';
  return noThink;
}

/** Take a CLI shell's stdout and reduce it to a single review-sized reply. */
function condenseCliOutput(s: string): string {
  if (!s) return '';
  const cleaned = s
    .replace(/\x1B\[[0-9;]*[A-Za-z]/g, '')
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join('\n')
    .trim();
  return cleaned.length > 800 ? cleaned.slice(0, 800) + '…' : cleaned;
}

async function askApi(
  agent: ReviewAgent,
  system: string,
  user: string,
  maxTokens: number,
  timeoutMs: number
): Promise<{ text: string; rawLength: number; error?: string }> {
  if (!agent.providerId) return { text: '', rawLength: 0, error: 'API 智能体缺少 API 连接' };
  try {
    const res = (await Promise.race([
      window.api.ai.chat(
        agent.providerId,
        [{ role: 'user', content: user }],
        { model: agent.model, systemPrompt: system, maxTokens, temperature: 0.3 }
      ),
      new Promise<null>((_, reject) => setTimeout(() => reject(new Error('超时')), timeoutMs)),
    ])) as { content?: string } | null;
    const raw = res?.content ?? '';
    const text = stripThink(raw);
    return { text, rawLength: raw.length };
  } catch (e) {
    return { text: '', rawLength: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

async function askCli(
  agent: ReviewAgent,
  system: string,
  user: string,
  rootPath: string,
  timeoutMs: number
): Promise<{ text: string; rawLength: number; error?: string }> {
  const prompt =
    `${system}\n\n` +
    `严格只输出评审意见，不要修改任何文件，不要运行 git，不要调用工具。\n\n` +
    `---\n${user}`;

  const runPromise = new Promise<{ ok: boolean; output: string; error?: string }>((resolve, reject) => {
    window.api.cliAgent.runStream(
      rootPath,
      {
        tool: agent.kind as 'claude-code' | 'codex' | 'antigravity' | 'opencode',
        prompt,
        model: agent.model || undefined,
        baseURL: agent.baseURL,
        apiKey: agent.apiKey,
      },
      (event) => {
        if (event.type === 'error') reject(new Error(event.message));
        if (event.type === 'complete') resolve(event.result);
      }
    ).catch((e: unknown) => reject(e));
  });

  try {
    const res = await Promise.race([
      runPromise,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('超时')), timeoutMs)),
    ]);
    if (!res.ok) return { text: '', rawLength: (res.output ?? '').length, error: res.error || `${agent.kind} 执行失败` };
    const raw = res.output ?? '';
    return { text: condenseCliOutput(raw), rawLength: raw.length };
  } catch (e) {
    return { text: '', rawLength: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

/** System prompt per role — short, opinionated, dimension-specific. */
const systemForRole = (role: AgentRole, roleLabel: string): string => {
  const systems: Record<AgentRole, string> = {
    architect:
      '你是架构评审员。关注：整体设计是否合理、是否可维护、耦合度是否高、有没有明显的反模式、性能/扩展性有没有问题、边界条件有没有考虑到。简明给出你的判断和改进点。',
    security:
      '你是安全评审员。关注：有没有注入风险、权限问题、明文敏感数据、依赖漏洞、不安全的默认配置、越权访问可能、加密算法选择是否正确。简明给出你的判断和改进点。',
    testing:
      '你是测试评审员。关注：方案有没有覆盖主要测试点、边缘情况有没有考虑、测试策略是否清晰、复现步骤够不够明确、有没有无法验证的黑盒改动。简明给出你的判断和改进点。',
    style:
      '你是风格评审员。关注：命名是否一致、代码风格是否统一、注释是否到位、文档是否齐全、输出格式是否规范、有没有拼写或格式错误。简明给出你的判断和改进点。',
    general: '你是通用评审员。从整体角度评价：方案是否完整、是否符合需求、有没有明显遗漏、可行性如何。简明给出你的判断和改进点。',
  };
  return systems[role];
};

async function ask(
  agent: ReviewAgent,
  system: string,
  user: string,
  maxTokens: number,
  rootPath: string | null | undefined,
  timeoutMs: number
): Promise<{ text: string; rawLength: number; error?: string }> {
  if (agent.kind === 'api') return askApi(agent, system, user, maxTokens, timeoutMs);
  if (!rootPath) return { text: '', rawLength: 0, error: 'CLI 智能体需要打开的工作区' };
  return askCli(agent, system, user, rootPath, timeoutMs);
}

/** Pretty label mapping (we can't import the const itself in this module's
 *  top-level without a circular import risk, so we duplicate the exact strings
 *  here — they're small and stable, and typescript ensures we cover all cases).
 */
const roleLabel: Record<AgentRole, string> = {
  architect: '架构',
  security: '安全',
  testing: '测试',
  style: '风格',
  general: '通用',
};

/**
 * Main entry: parallel per-role reviews → moderator synthesis.
 */
export async function runReview(params: RunReviewParams): Promise<ReviewResult> {
  const { agents, question, onCard, onPhase, onCall, rootPath, signal } = params;
  const startedAt = Date.now();
  const cards: ReviewCard[] = [];

  // ── Phase 1: parallel independent review ──

  onPhase?.('各角色并行评审中…');

  const tasks = agents.map(async (agent): Promise<ReviewCard> => {
    const t0 = Date.now();
    const role = agent.role;
    const system = systemForRole(role, roleLabel[role]);
    const user = `请评审下面的议题/方案，从【${roleLabel[role]}】角度给出你的判断和改进点：\n\n${question}`;
    const timeout = agent.kind === 'api' ? API_CALL_TIMEOUT_MS : CLI_CALL_TIMEOUT_MS;

    const res = await ask(agent, system, user, REVIEW_TOKENS, rootPath, timeout);
    const durationMs = Date.now() - t0;
    const card: ReviewCard = {
      agentId: agent.id,
      agentName: agent.name,
      role,
      text: res.text,
      durationMs,
      ok: !res.error && res.text.length > 0,
      error: res.error,
    };

    onCall?.({
      agentId: agent.id,
      agentName: agent.name,
      agentKind: agent.kind,
      role,
      ok: card.ok,
      durationMs,
      outputLength: res.text.length,
      error: res.error,
    });
    onCard?.(card);
    return card;
  });

  const results = await Promise.all(tasks);
  cards.push(...results);

  if (signal?.aborted) {
    return { cards, dimensionSummaries: emptyDimensionSummaries(), plan: '', weights: {}, durationMs: Date.now() - startedAt, aborted: true };
  }

  // ── Phase 2: moderator synthesis ──

  onPhase?.('主持人整合中…');

  // Prefer an API agent for moderation (cheaper + faster). Fall back to
  // the first successful reviewer.
  const apiModerator = agents.find((a) => a.kind === 'api' && a.providerId);
  const fallbackModerator = cards.find((c) => c.ok) ? agents.find((a) => a.id === cards.find((c) => c.ok)!.agentId) : agents[0];
  const moderator = apiModerator ?? fallbackModerator;

  if (!moderator) {
    return { cards, dimensionSummaries: emptyDimensionSummaries(), plan: '', weights: {}, durationMs: Date.now() - startedAt, aborted: false };
  }

  // Build labelled cards for the moderator prompt.
  const labelled = cards
    .filter((c) => c.ok)
    .map((c) => `### ${c.agentName}（${roleLabel[c.role]}）\n${c.text}`)
    .join('\n\n');

  const moderatorSystem =
    '你是评审主持人。基于下面多角色的独立评审，输出三段内容（按顺序，用清晰的分隔线）：\n' +
    '1) 【各维度总结】：按架构/安全/测试/风格/通用五个维度，各自总结成一句话。\n' +
    '2) 【统一方案】：提炼 3-5 条明确、可执行的要点，只输出方案，不要复述讨论。\n' +
    '3) 【权重表】：输出一个 JSON 对象，key 是 agentId，value 是 { architect, security, testing, style, general } 各维度的权重（0-1 之间的小数），表示该 agent 在该维度的可信度。\n' +
    '注意：权重表必须是合法 JSON，不要有任何解释，放在最后一段。';

  const moderatorUser = `议题：${question}\n\n各角色评审：\n${labelled}`;

  const modTimeout = moderator.kind === 'api' ? API_CALL_TIMEOUT_MS * 2 : CLI_CALL_TIMEOUT_MS * 1.5;
  const modRes = await ask(moderator, moderatorSystem, moderatorUser, MODERATOR_TOKENS, rootPath, modTimeout);

  if (!modRes.text || signal?.aborted) {
    return { cards, dimensionSummaries: emptyDimensionSummaries(), plan: modRes.text || '', weights: {}, durationMs: Date.now() - startedAt, aborted: !!signal?.aborted };
  }

  // Parse moderator output: split by lines, extract dimension summaries, plan, and weights.
  // Heuristic: anything that looks like a JSON object at the end is the weight table.
  const lines = modRes.text.split('\n').map((l) => l.trim()).filter(Boolean);
  let plan = '';
  let dimensionSummaries = emptyDimensionSummaries();
  let weights: WeightTable = {};

  // Find the JSON block (last line that starts with { and the last line that ends with }).
  // ES2020 has no Array.prototype.findLastIndex, so scan backwards manually.
  let jsonStart = -1;
  let jsonEnd = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (jsonEnd < 0 && lines[i].endsWith('}')) jsonEnd = i;
    if (lines[i].startsWith('{')) { jsonStart = i; break; }
  }
  if (jsonStart >= 0 && jsonEnd >= jsonStart) {
    try {
      const jsonStr = lines.slice(jsonStart, jsonEnd + 1).join('');
      weights = JSON.parse(jsonStr) as WeightTable;
    } catch {
      // Fallback: equal weights for everyone.
      agents.forEach((a) => {
        weights[a.id] = { architect: 0.5, security: 0.5, testing: 0.5, style: 0.5, general: 0.5 };
      });
    }
  } else {
    agents.forEach((a) => {
      weights[a.id] = { architect: 0.5, security: 0.5, testing: 0.5, style: 0.5, general: 0.5 };
    });
  }

  // Everything before the JSON is the plan + dimension summaries. Heuristic:
  // take all non-JSON lines as the plan; dimension summaries are embedded in
  // the plan text (we don't need to structurally split them — the UI shows
  // them as one "moderator card").
  const planLines = jsonStart >= 0 ? lines.slice(0, jsonStart) : lines;
  plan = planLines.join('\n').trim();

  // Fill dimension summaries from the cards themselves (moderator's summary
  // is embedded in the plan text; we keep this Record for type soundness
  // and future UI expansion where we might want per-dimension expanders).
  cards.forEach((c) => {
    if (c.ok && !dimensionSummaries[c.role]) {
      dimensionSummaries[c.role] = c.text.slice(0, 120) + (c.text.length > 120 ? '…' : '');
    }
  });

  return { cards, dimensionSummaries, plan, weights, durationMs: Date.now() - startedAt, aborted: false };
}

function emptyDimensionSummaries(): Record<AgentRole, string> {
  return { architect: '', security: '', testing: '', style: '', general: '' };
}
