import { useMemo, useRef, useState } from 'react';
import { v4 as uuid } from 'uuid';
import { useTaskWorkspace } from '../context/TaskContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { runDiscussion, type DiscussionAgent, type DiscussionMessage } from './agentDiscussion';
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
function roster(agents: DiscussionAgent[]): { id: string; name: string; kind: string }[] {
  return agents.map((a) => ({ id: a.id, name: a.name, kind: a.kind }));
}

/**
 * Round-table state machine, lifted out of the old narrow-sidebar RoundTablePanel
 * so the Codex workbench can render the roster (left), discussion + converged plan
 * (center) and parallel implementations (right) from one shared instance.
 *
 * Phase 1/2: enabled agents discuss → converge to a unified plan. API agents
 * talk via ai.chat; CLI shells (claude-code / codex / antigravity) talk via
 * the cliAgent IPC (their stdout IS their discussion turn).
 * Phase 3: every enabled agent implements the plan in its own git worktree;
 * diffs are compared and one is adopted (others cleaned up).
 *
 * `enabled` vs `implementable` are intentionally the same set now — earlier the
 * roster silently dropped any agent without an API connection, which is why
 * enabling a built-in CLI shell did nothing.
 */
export function useRoundTable() {
  const { agents, providers } = useTaskWorkspace();
  const { rootPath } = useWorkspace();

  const [question, setQuestion] = useState('');
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState('');
  const [messages, setMessages] = useState<DiscussionMessage[]>([]);
  const [plan, setPlan] = useState('');
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

  /** Build a DiscussionAgent for each enabled agent, decrypting any backing key. */
  const buildDiscussionAgents = async (): Promise<DiscussionAgent[]> => {
    return Promise.all(
      enabledAgents.map(async (a): Promise<DiscussionAgent> => {
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
    setRunning(true);
    setMessages([]);
    setPlan('');
    setImpls([]);
    setAdoptedBranch(null);
    setNotice(null);
    setPhase('开始…');
    signalRef.current = { aborted: false };

    const runStartedAt = Date.now();
    const questionText = question.trim();
    const runId = uuid().slice(0, 8);

    logEvent(rootPath, {
      kind: 'discussion-start',
      runId,
      question: questionText,
      agents: enabledAgents.map((a) => ({ id: a.id, name: a.name, kind: a.kind })),
      agentCount: enabledAgents.length,
      rootPath,
    });

    try {
      const discussionAgents = await buildDiscussionAgents();
      // Track per-agent call errors so we can build a precise diagnosis when
      // the whole run produces nothing — instead of the generic "no reply".
      const lastErrors = new Map<string, string>();
      const res = await runDiscussion({
        agents: discussionAgents,
        question: questionText,
        rootPath,
        onMessage: (m) => setMessages((prev) => [...prev, m]),
        onPhase: setPhase,
        onCall: (info) => {
          logEvent(rootPath, { kind: 'discussion-call', runId, ...info });
          if (info.error) lastErrors.set(info.agentId, info.error);
          else if (info.ok) lastErrors.delete(info.agentId); // recovered
        },
        signal: signalRef.current,
      });
      setPlan(res.plan);

      logEvent(rootPath, {
        kind: 'discussion-end',
        runId,
        transcriptLength: res.transcript.length,
        planLength: res.plan.length,
        durationMs: res.durationMs,
        aborted: res.aborted,
      });

      // Only dump non-empty rounds to markdown — empty transcripts are noise.
      if (rootPath && res.transcript.length > 0) {
        void window.api.agentLog
          .writeRound(rootPath, {
            question: questionText,
            agents: roster(discussionAgents),
            messages: res.transcript,
            plan: res.plan,
            startedAt: runStartedAt,
            endedAt: Date.now(),
          })
          .catch(() => undefined);
      }

      if (!res.plan && res.transcript.length === 0) {
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
            `所有启用的智能体都没产生回复。检查每一项,补好后再试一次:\n${summary}`,
        });
      }
    } finally {
      setRunning(false);
    }
  };

  const stop = () => {
    signalRef.current.aborted = true;
    logEvent(rootPath, { kind: 'notice', text: '用户取消了圆桌讨论' });
    setPhase('停止中…');
  };

  /** Start a fresh round table — clear the discussion, plan and implementations. */
  const reset = () => {
    if (running || implementing) return;
    setQuestion('');
    setMessages([]);
    setPlan('');
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
    running,
    phase,
    messages,
    plan,
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
