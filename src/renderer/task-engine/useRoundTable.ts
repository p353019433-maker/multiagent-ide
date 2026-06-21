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

/**
 * Round-table state machine, lifted out of the old narrow-sidebar RoundTablePanel
 * so the Codex workbench can render the roster (left), discussion + converged plan
 * (center) and parallel implementations (right) from one shared instance.
 *
 * Phase 1/2: enabled API-backed agents discuss → converge to a unified plan.
 * Phase 3: every enabled agent (incl. CLI shells) implements it in its own git
 * worktree; diffs are compared and one is adopted (others cleaned up).
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

  // Enabled agents with a backing API connection can discuss via ai.chat.
  // Login-only shells join only the implementation phase.
  const enabled: DiscussionAgent[] = useMemo(
    () =>
      agents
        .filter((a) => a.enabled && !!a.providerId && !!a.model)
        .map((a) => ({ id: a.id, name: a.name, providerId: a.providerId as string, model: a.model })),
    [agents]
  );

  // Implementation can include CLI shells (login or backed), not just API.
  const implementable = useMemo(
    () => agents.filter((a) => a.enabled && (a.kind === 'api' ? !!a.providerId && !!a.model : true)),
    [agents]
  );

  const run = async () => {
    if (running || !question.trim() || enabled.length === 0) return;
    setRunning(true);
    setMessages([]);
    setPlan('');
    setImpls([]);
    setAdoptedBranch(null);
    setNotice(null);
    setPhase('开始…');
    signalRef.current = { aborted: false };
    try {
      const res = await runDiscussion({
        agents: enabled,
        question: question.trim(),
        onMessage: (m) => setMessages((prev) => [...prev, m]),
        onPhase: setPhase,
        signal: signalRef.current,
      });
      setPlan(res.plan);
    } finally {
      setRunning(false);
    }
  };

  const stop = () => {
    signalRef.current.aborted = true;
    setPhase('停止中…');
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
    if (implementing || !plan || !rootPath || implementable.length === 0) return;
    setImplementing(true);
    setImpls([]);
    setAdoptedBranch(null);
    setNotice(null);
    try {
      const implAgents: ImplAgent[] = await Promise.all(
        implementable.map(async (a) => {
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
      await runImplementation({ agents: implAgents, plan, rootPath, tag: uuid().slice(0, 6), onUpdate: upsertImpl });
    } catch (e) {
      setNotice({ tone: 'err', text: e instanceof Error ? e.message : String(e) });
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
  };

  const cleanup = async () => {
    if (!rootPath) return;
    await cleanupImplementations(rootPath, impls);
    setImpls([]);
    setAdoptedBranch(null);
    setNotice({ tone: 'ok', text: '已清理本次 worktree' });
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
    enabled,
    implementable,
    canIntegrate,
    run,
    stop,
    implement,
    adopt,
    cleanup,
    integrate,
  };
}

export type RoundTableState = ReturnType<typeof useRoundTable>;
