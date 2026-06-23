import { useMemo, useRef, useState } from 'react';
import { v4 as uuid } from 'uuid';
import { useTaskWorkspace } from '../context/TaskContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { runReview, type ReviewAgent, type ReviewCard, type WeightTable } from './agentReview';
import {
  adoptImplementation,
  cleanupImplementations,
  integrateImplementations,
  runImplementation,
  type ImplAgent,
  type ImplementationResult,
} from './agentImplementation';

export interface RoundTableNotice {
  tone: 'ok' | 'err';
  text: string;
}

/** Best-effort append to the diagnostic log; never lets logging block/abort a run. */
function logEvent(rootPath: string | null, event: Record<string, unknown>): void {
  if (!rootPath) return;
  void window.api.agentLog.append(rootPath, event).catch(() => undefined);
}

/** Per-agent kind/model for the round transcript + the start event. */
function roster(agents: ReviewAgent[]): { id: string; name: string; kind: string; role: string }[] {
  return agents.map((a) => ({ id: a.id, name: a.name, kind: a.kind, role: a.role }));
}

/**
 * Round-table state machine, lifted out of the old narrow-sidebar RoundTablePanel
 * so the Codex workbench can render the roster (left), parallel review cards
 * (center) and parallel implementations (right) from one shared instance.
 *
 * Phase 1: every enabled agent evaluates the question from its assigned ROLE
 * in parallel (architect / security / testing / style / general). No rounds,
 * no discussion — just independent cards.
 * Phase 2: moderator synthesizes the cards into a unified plan + a weight table
 * (agentId → role → 0-1) used for ranking Phase 3 implementations.
 * Phase 3: every enabled agent implements the plan in its own git worktree;
 * diffs are ranked by weighted score and one is adopted (others cleaned up).
 *
 * `enabled` vs `implementable` are intentionally the same set now — earlier the
 * roster silently dropped any agent without an API connection, which is why
 * enabling a built-in CLI shell did nothing.
 */
export function useRoundTable() {
  const { agents, providers } = useTaskWorkspace();
  const { rootPath } = useWorkspace();

  const [question, setQuestion] = useState('');
  /** The committed topic for the current round. The input box drafts into
   *  `question`; on send we snapshot it here and clear the draft, so the
   *  topic card stays visible while the input is empty and ready for the
   *  next round. */
  const [topic, setTopic] = useState('');
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState('');
  const [cards, setCards] = useState<ReviewCard[]>([]);
  const [plan, setPlan] = useState('');
  const [weights, setWeights] = useState<WeightTable>({});
  const signalRef = useRef({ aborted: false });

  const [impls, setImpls] = useState<ImplementationResult[]>([]);
  const [implementing, setImplementing] = useState(false);
  const [adoptedBranch, setAdoptedBranch] = useState<string | null>(null);
  const [notice, setNotice] = useState<RoundTableNotice | null>(null);

  // Every enabled agent participates — API or CLI.
  // API agents need a providerId+model; CLI shells just need to be enabled
  // (they bring their own auth via own-login or a configured backend).
  const enabledAgents = useMemo(
    () =>
      agents.filter((a) => {
        if (!a.enabled) return false;
        if (a.kind === 'api') return !!a.providerId && !!a.model;
        return true; // claude-code / codex / antigravity / opencode
      }),
    [agents]
  );

  /** Build a ReviewAgent for each enabled agent, decrypting any backing key. */
  const buildReviewAgents = async (): Promise<ReviewAgent[]> => {
    return Promise.all(
      enabledAgents.map(async (a): Promise<ReviewAgent> => {
        let baseURL: string | undefined;
        let apiKey: string | undefined;
        if (a.providerId) {
          const p = providers.find((x) => x.id === a.providerId);
          baseURL = p?.baseURL || undefined;
          if (p) apiKey = (await window.api.store.decryptAndGet(p.apiKeyRef)) ?? undefined;
        }
        return {
          id: a.id,
          name: a.name,
          kind: a.kind,
          role: a.role,
          providerId: a.providerId,
          model: a.model,
          baseURL,
          apiKey,
        };
      })
    );
  };

  const run = async () => {
    if (running || !question.trim() || enabledAgents.length === 0) return;
    const questionText = question.trim();
    setRunning(true);
    setCards([]);
    setPlan('');
    setWeights({});
    setImpls([]);
    setAdoptedBranch(null);
    setNotice(null);
    setPhase('开始…');
    signalRef.current = { aborted: false };
    // Snapshot the draft as this round's topic, then clear the input so it's
    // ready for the next question instead of keeping the sent text.
    setTopic(questionText);
    setQuestion('');

    const runStartedAt = Date.now();
    const runId = uuid().slice(0, 8);

    logEvent(rootPath, {
      kind: 'review-start',
      runId,
      question: questionText,
      agents: enabledAgents.map((a) => ({ id: a.id, name: a.name, kind: a.kind, role: a.role })),
      agentCount: enabledAgents.length,
      rootPath,
    });

    try {
      const reviewAgents = await buildReviewAgents();
      // Track per-agent call errors so we can build a precise diagnosis when
      // the whole run produces nothing — instead of the generic "no reply".
      const lastErrors = new Map<string, string>();
      const res = await runReview({
        agents: reviewAgents,
        question: questionText,
        rootPath,
        onCard: (c) => setCards((prev) => [...prev, c]),
        onPhase: setPhase,
        onCall: (info) => {
          logEvent(rootPath, { kind: 'review-call', runId, ...info });
          if (info.error) lastErrors.set(info.agentId, info.error);
          else if (info.ok) lastErrors.delete(info.agentId); // recovered
        },
        signal: signalRef.current,
      });
      setPlan(res.plan);
      setWeights(res.weights);

      logEvent(rootPath, {
        kind: 'review-end',
        runId,
        cardCount: res.cards.length,
        planLength: res.plan.length,
        weightCount: Object.keys(res.weights).length,
        durationMs: res.durationMs,
        aborted: res.aborted,
      });

      // Only dump non-empty cards to markdown — empty cards are noise.
      if (rootPath && res.cards.filter((c) => c.ok).length > 0) {
        void window.api.agentLog
          .writeRound(rootPath, {
            question: questionText,
            agents: roster(reviewAgents),
            cards: res.cards,
            plan: res.plan,
            weights: res.weights,
            startedAt: runStartedAt,
            endedAt: Date.now(),
          })
          .catch(() => undefined);
      }

      if (!res.plan && res.cards.filter((c) => c.ok).length === 0) {
        // Build a precise message: every agent ran but every agent failed,
        // so the user sees what's actually broken (no API key / CLI not
        // installed / no workspace), not a generic English fallback.
        const lines: string[] = [];
        for (const a of enabledAgents) {
          const err = lastErrors.get(a.id);
          lines.push(`• ${a.name}${err ? `：${err}` : '：无响应'}`);
        }
        const summary = lines.length > 0 ? lines.join('\n') : '没有任何智能体可参与';
        setNotice({
          tone: 'err',
          text:
            `所有启用的智能体都没产生评审意见。检查每一项，补好后再试一次:\n${summary}`,
        });
      }
    } finally {
      setRunning(false);
    }
  };

  const stop = () => {
    signalRef.current.aborted = true;
    logEvent(rootPath, { kind: 'notice', text: '用户取消了评审' });
    setPhase('停止中…');
  };

  /** Start a fresh round table — clear the review cards, plan and implementations. */
  const reset = () => {
    if (running || implementing) return;
    setQuestion('');
    setTopic('');
    setCards([]);
    setPlan('');
    setWeights({});
    setImpls([]);
    setAdoptedBranch(null);
    setNotice(null);
    setPhase('');
  };

  const upsertImpl = (r: ImplementationResult) =>
    setImpls((prev) => {
      const i = prev.findIndex((x) => x.branch === r.branch);
      if (i < 0) return [...prev, r];
      const next = [...prev];
      next[i] = r;
      return next;
    });

  const implement = async () => {
    if (implementing || !plan || !rootPath || enabledAgents.length === 0) return;
    setImplementing(true);
    setImpls([]);
    setAdoptedBranch(null);
    setNotice(null);

    const tag = uuid().slice(0, 6);
    const implStartedAt = Date.now();
    logEvent(rootPath, {
      kind: 'implementation-start',
      tag,
      agents: enabledAgents.map((a) => ({ id: a.id, name: a.name, kind: a.kind })),
      agentCount: enabledAgents.length,
      planLength: plan.length,
    });

    try {
      const implAgents: ImplAgent[] = await Promise.all(
        enabledAgents.map(async (a) => {
          let baseURL: string | undefined;
          let apiKey: string | undefined;
          if (a.providerId) {
            const p = providers.find((x) => x.id === a.providerId);
            baseURL = p?.baseURL || undefined;
            if (p) apiKey = (await window.api.store.decryptAndGet(p.apiKeyRef)) ?? undefined;
          }
          return { id: a.id, name: a.name, kind: a.kind, model: a.model, providerId: a.providerId, baseURL, apiKey };
        })
      );
      const results = await runImplementation({
        agents: implAgents,
        plan,
        rootPath,
        tag,
        onUpdate: upsertImpl,
        onCall: (info) => {
          const { kind: agentKind, ...rest } = info;
          logEvent(rootPath, { kind: 'implementation-call', tag, ...rest, agentKind });
        },
      });
      logEvent(rootPath, {
        kind: 'implementation-end',
        tag,
        okCount: results.filter((r) => r.status === 'ok').length,
        failCount: results.filter((r) => r.status === 'failed').length,
        durationMs: Date.now() - implStartedAt,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setNotice({ tone: 'err', text: message });
      logEvent(rootPath, { kind: 'notice', text: `实现阶段异常: ${message}` });
    } finally {
      setImplementing(false);
    }
  };

  const adopt = async (r: ImplementationResult) => {
    if (!rootPath) return;
    setNotice(null);
    const res = await adoptImplementation(rootPath, r);
    if (res.ok) setAdoptedBranch(r.branch);
    setNotice({
      tone: res.ok ? 'ok' : 'err',
      text: res.ok ? `已采用 ${r.agent.name} 的实现：${res.message}` : `采用失败：${res.message}`,
    });
    logEvent(rootPath, {
      kind: 'notice',
      text: res.ok ? `采用 ${r.agent.name} (${r.branch})` : `采用失败 ${r.agent.name}: ${res.message}`,
    });
  };

  const cleanup = async () => {
    if (!rootPath) return;
    const res = await cleanupImplementations(rootPath, impls);
    setImpls([]);
    setAdoptedBranch(null);
    if (res.failed.length > 0) {
      const detail = res.failed.map((f) => `${f.branch}：${f.error}`).join('\n');
      setNotice({
        tone: 'err',
        text: `已清理 ${res.removed} 个 worktree，${res.failed.length} 个失败（可能有未提交改动）：\n${detail}`,
      });
    } else {
      setNotice({ tone: 'ok', text: `已清理 ${res.removed} 个 worktree` });
    }
  };

  const canIntegrate = impls.filter((r) => r.status === 'ok' && r.diff).length >= 2 && !impls.some((r) => r.agent.id === 'integrated');

  const integrate = async () => {
    if (!rootPath || !canIntegrate) return;
    setNotice(null);
    try {
      const integrated = await integrateImplementations(rootPath, impls, plan);
      setImpls((prev) => [...prev, integrated]);
      setNotice({ tone: 'ok', text: `已整合 ${impls.filter((r) => r.status === 'ok').length} 份实现 → ${integrated.branch}` });
    } catch (e) {
      setNotice({ tone: 'err', text: `整合失败：${e instanceof Error ? e.message : String(e)}` });
    }
  };

  return {
    rootPath,
    question,
    setQuestion,
    topic,
    running,
    phase,
    cards,
    plan,
    weights,
    impls,
    implementing,
    adoptedBranch,
    notice,
    enabled: enabledAgents,
    implementable: enabledAgents,
    canIntegrate,
    run,
    stop,
    reset,
    implement,
    adopt,
    cleanup,
    integrate,
  };
}

export type RoundTableState = ReturnType<typeof useRoundTable>;

/**
 * Score an implementation by the weighted opinion of the reviewers:
 *   score(impl) = sum over reviewers r of (weights[r.id][r.role])
 * The higher the implementing agent's reviewers trusted it on their own role,
 * the higher the score. We use the role weight of THE reviewer evaluating
 * (i.e. how trusted each reviewer's voice is overall), then sum to get a
 * dimension-balanced ranking.
 *
 * Caveat: this is a heuristic — without per-implementation scoring it can't
 * truly say "agent A's diff is more secure than agent B's". A proper ranker
 * would re-call each role agent to grade each diff, which would multiply cost.
 * The current implementation prefers the *role-rich* agent (one with high
 * weight in multiple dimensions) which is a reasonable shortcut.
 */
export function scoreImplementations(
  impls: ImplementationResult[],
  weights: WeightTable
): { branch: string; score: number }[] {
  return impls
    .filter((r) => r.status === 'ok')
    .map((r) => {
      const w = weights[r.agent.id];
      if (!w) return { branch: r.branch, score: 0 };
      const score = (w.architect || 0) + (w.security || 0) + (w.testing || 0) + (w.style || 0) + (w.general || 0);
      return { branch: r.branch, score: Math.round(score * 100) / 100 };
    })
    .sort((a, b) => b.score - a.score);
}
