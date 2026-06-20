import React, { useRef, useState } from 'react';
import { MessagesSquare, Play, Square } from 'lucide-react';
import { useTaskWorkspace } from '../../context/TaskContext';
import { runDiscussion, type DiscussionAgent, type DiscussionMessage } from '../../task-engine/agentDiscussion';

/**
 * Round-table panel (Phase 2): the enabled API agents discuss a question in a
 * shared transcript and converge to one unified plan. Reads the agent roster
 * (Settings → 智能体) — only enabled API agents with a provider+model join.
 */
export default function RoundTablePanel() {
  const { agents } = useTaskWorkspace();
  const [question, setQuestion] = useState('');
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState('');
  const [messages, setMessages] = useState<DiscussionMessage[]>([]);
  const [plan, setPlan] = useState('');
  const signalRef = useRef({ aborted: false });

  // Any enabled agent that has a backing API connection can discuss via ai.chat
  // (pure API, or a shell configured with an API backend). Login-only shells
  // join the implementation phase later, not the discussion.
  const enabled: DiscussionAgent[] = agents
    .filter((a) => a.enabled && !!a.providerId && !!a.model)
    .map((a) => ({ id: a.id, name: a.name, providerId: a.providerId as string, model: a.model }));

  const run = async () => {
    if (running || !question.trim() || enabled.length === 0) return;
    setRunning(true);
    setMessages([]);
    setPlan('');
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
          <div className="px-3 py-2 text-11 text-muted-foreground">输入一个问题,让启用的 agent 互相讨论、收敛出统一方案。</div>
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
            <div className="mb-1 text-10 font-semibold uppercase tracking-wide text-editor-accent">统一方案</div>
            <div className="whitespace-pre-wrap text-xs text-foreground">{plan}</div>
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
            <button
              onClick={stop}
              className="inline-flex h-7 items-center gap-1 bg-red-600 px-3 text-xs text-white hover:bg-red-700"
            >
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
