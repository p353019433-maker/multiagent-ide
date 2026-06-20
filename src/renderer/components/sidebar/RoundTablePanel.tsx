import React, { useRef, useState } from 'react';
import { v4 as uuid } from 'uuid';
import { GitMerge, Hammer, MessagesSquare, Play, Square, Trash2 } from 'lucide-react';
import { useTaskWorkspace } from '../../context/TaskContext';
import { useWorkspace } from '../../context/WorkspaceContext';
import { runDiscussion, type DiscussionAgent, type DiscussionMessage } from '../../task-engine/agentDiscussion';
import {
  adoptImplementation,
  cleanupImplementations,
  runImplementation,
  type ImplAgent,
  type ImplementationResult,
} from '../../task-engine/agentImplementation';

/**
 * Round-table panel: enabled API-backed agents discuss a question, converge to a
 * unified plan (Phase 2), then each implements it in its own git worktree so the
 * diffs can be compared and one adopted (Phase 3a).
 */
export default function RoundTablePanel() {
  const { agents, providers } = useTaskWorkspace();
  const { rootPath } = useWorkspace();  const [question, setQuestion] = useState('');
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState('');
  const [messages, setMessages] = useState<DiscussionMessage[]>([]);
  const [plan, setPlan] = useState('');
  const signalRef = useRef({ aborted: false });

  const [impls, setImpls] = useState<ImplementationResult[]>([]);
  const [implementing, setImplementing] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  // Any enabled agent that has a backing API connection can discuss via ai.chat
  // (pure API, or a shell configured with an API backend). Login-only shells
  // join the implementation phase later, not the discussion.
  const enabled: DiscussionAgent[] = agents
    .filter((a) => a.enabled && !!a.providerId && !!a.model)
    .map((a) => ({ id: a.id, name: a.name, providerId: a.providerId as string, model: a.model }));

  // Implementation can also include CLI shells (login or backed), not just API.
  const implementable = agents.filter((a) => a.enabled && (a.kind === 'api' ? !!a.providerId && !!a.model : true));

  const run = async () => {
    if (running || !question.trim() || enabled.length === 0) return;
    setRunning(true);
    setMessages([]);
    setPlan('');
    setImpls([]);
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
    setNotice({ tone: res.ok ? 'ok' : 'err', text: res.ok ? `已采用 ${r.agent.name} 的实现：${res.message}` : `采用失败：${res.message}` });
  };

  const cleanup = async () => {
    if (!rootPath) return;
    await cleanupImplementations(rootPath, impls);
    setImpls([]);
    setNotice({ tone: 'ok', text: '已清理本次 worktree' });
  };

  const STATUS_LABEL: Record<ImplementationResult['status'], string> = { running: '实现中…', ok: '完成', failed: '失败' };

  return (
    <div className="flex h-full flex-col bg-editor-sidebar">
      <div className="flex h-8 flex-shrink-0 items-center gap-2 border-b border-editor-border px-3">
        <MessagesSquare size={13} strokeWidth={1.8} className="flex-shrink-0 text-muted-foreground" />
        <span className="text-10 font-semibold uppercase tracking-wide text-muted-foreground">圆桌</span>
        <span className="font-mono text-10 tabular-nums text-muted-foreground">{enabled.length} agent</span>
        {phase && <span className="ml-auto truncate text-10 text-editor-accent">{phase}</span>}
      </div>

      {enabled.length === 0 ? (
        <p className="border-b border-editor-border px-3 py-2 text-11 text-muted-foreground">
          没有启用的 API 智能体。去「设置 → 智能体」开启至少一个(可基于已配置的 API 添加多个模型)。
        </p>
      ) : (
        <p className="truncate border-b border-editor-border px-3 py-1.5 text-10 text-muted-foreground" title={enabled.map((a) => a.name).join('、')}>
          参与:{enabled.map((a) => a.name).join('、')}
        </p>
      )}

      <div className="flex-1 overflow-y-auto selectable">
        {messages.length === 0 && !running && !plan && (
          <div className="px-3 py-2 text-11 text-muted-foreground">输入一个问题,让启用的 agent 互相讨论、收敛出统一方案,再各自在 worktree 实现。</div>
        )}
        {messages.map((m, i) => (
          <div key={i} className="border-b border-editor-border/40 px-3 py-1.5">
            <div className="flex items-center gap-1.5 text-10 text-muted-foreground">
              <span className="font-mono text-editor-accent">{m.agentName}</span>
              <span>· 第 {m.round} 轮</span>
            </div>
            <div className="mt-0.5 whitespace-pre-wrap text-xs text-editor-text">{m.text}</div>
          </div>
        ))}

        {plan && (
          <div className="border-t-2 border-editor-accent bg-editor-bg px-3 py-2">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-10 font-semibold uppercase tracking-wide text-editor-accent">统一方案</span>
              {rootPath ? (
                <button
                  onClick={implement}
                  disabled={implementing || implementable.length === 0}
                  className="ml-auto inline-flex h-6 items-center gap-1 bg-editor-accent px-2 text-10 text-primary-foreground hover:opacity-90 disabled:opacity-40"
                  title="让每个启用的 agent(含 CLI)在各自 worktree 实现该方案"
                >
                  <Hammer size={11} strokeWidth={1.8} />
                  {implementing ? '实现中…' : `让 agent 实现 (${implementable.length})`}
                </button>
              ) : (
                <span className="ml-auto text-10 text-muted-foreground">需打开 git 项目才能实现</span>
              )}
            </div>
            <div className="whitespace-pre-wrap text-xs text-foreground">{plan}</div>
          </div>
        )}

        {notice && (
          <div className={`border-b border-editor-border px-3 py-1.5 text-11 ${notice.tone === 'ok' ? 'text-emerald-300' : 'text-red-300'}`}>
            {notice.text}
          </div>
        )}

        {impls.length > 0 && (
          <div className="border-t border-editor-border">
            <div className="flex items-center gap-2 bg-editor-sidebar px-3 py-1.5">
              <span className="text-10 font-semibold uppercase tracking-wide text-muted-foreground">实现对比</span>
              <button onClick={cleanup} className="ml-auto inline-flex items-center gap-1 text-10 text-muted-foreground hover:text-red-400" title="删除本次所有 worktree">
                <Trash2 size={11} strokeWidth={1.8} /> 清理
              </button>
            </div>
            {impls.map((r) => (
              <div key={r.branch} className="border-b border-editor-border/40 px-3 py-1.5">
                <div className="flex items-center gap-1.5 text-10">
                  <span className="font-mono text-editor-accent">{r.agent.name}</span>
                  <span className={r.status === 'ok' ? 'text-emerald-400' : r.status === 'failed' ? 'text-red-400' : 'text-yellow-400'}>
                    · {STATUS_LABEL[r.status]}
                  </span>
                  {r.status === 'ok' && <span className="text-muted-foreground">· {r.editedFiles.length} 文件</span>}
                  {r.status === 'ok' && r.diff && (
                    <button onClick={() => adopt(r)} className="ml-auto inline-flex items-center gap-1 text-10 text-emerald-400 hover:text-emerald-300" title="提交并合并此实现到主工作区">
                      <GitMerge size={11} strokeWidth={1.8} /> 采用
                    </button>
                  )}
                </div>
                {r.error && <div className="mt-0.5 text-10 text-red-400">{r.error}</div>}
                {r.note && <div className="mt-0.5 text-10 text-muted-foreground">{r.note}</div>}
                {r.diff && (
                  <pre className="mt-1 max-h-40 overflow-auto whitespace-pre border border-editor-border bg-editor-bg p-1.5 font-mono text-10 leading-relaxed text-editor-text">
                    {r.diff.slice(0, 4000)}
                  </pre>
                )}
                {r.status === 'ok' && !r.diff && <div className="mt-0.5 text-10 text-muted-foreground">无改动</div>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex-shrink-0 border-t border-editor-border p-2">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void run();
            }
          }}
          placeholder="给圆桌一个问题…  ⌘⏎ 开始"
          disabled={running}
          className="h-16 w-full resize-none border border-editor-border bg-editor-bg px-2 py-1.5 text-xs text-editor-text outline-none focus:border-editor-accent"
        />
        <div className="mt-1.5 flex justify-end">
          {running ? (
            <button onClick={stop} className="inline-flex h-7 items-center gap-1 bg-red-600 px-3 text-xs text-white hover:bg-red-700">
              <Square size={12} strokeWidth={1.8} />
              停止
            </button>
          ) : (
            <button
              onClick={run}
              disabled={!question.trim() || enabled.length === 0}
              className="inline-flex h-7 items-center gap-1 bg-editor-accent px-3 text-xs text-primary-foreground hover:opacity-90 disabled:opacity-40"
            >
              <Play size={12} strokeWidth={1.8} />
              讨论
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
