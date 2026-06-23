import React, { useMemo } from 'react';
import { ArrowUp, Check, Clock, Hammer, Square } from 'lucide-react';
import { useTaskWorkspace } from '../../context/TaskContext';
import { useApproval } from '../../task-engine/useApproval';
import { APPROVAL_MODE_META, type ApprovalMode } from '@shared/command-policy';
import ModelPicker from '../task/ModelPicker';
import { agentVisual } from './agentTheme';
import type { RoundTableState } from '../../task-engine/useRoundTable';
import type { AgentKind } from '@shared/types';

function StageDot({ state }: { state: 'done' | 'active' | 'pending' }) {
  if (state === 'done') return <Check size={12} strokeWidth={2.4} style={{ color: '#3f8a2e' }} />;
  if (state === 'active')
    return <span className="h-[7px] w-[7px] animate-pulse-dot rounded-full" style={{ background: '#c08a14' }} />;
  return <span className="h-[7px] w-[7px] rounded-full" style={{ background: 'rgba(13,13,13,.18)' }} />;
}

function Stage({ label, state }: { label: string; state: 'done' | 'active' | 'pending' }) {
  const color = state === 'done' ? '#3f8a2e' : state === 'active' ? '#c08a14' : 'rgba(13,13,13,.35)';
  return (
    <span className="flex items-center gap-1 text-[11px] font-semibold" style={{ color }}>
      <StageDot state={state} />
      {label}
    </span>
  );
}

/**
 * Center column for round mode: stage indicator, topic card, discussion stream
 * and the moderator's converged-plan card with the "让 agent 实现" trigger.
 * Driven by the shared useRoundTable() instance.
 */
export default function RoundTableThread({ rt, onConfigure }: { rt: RoundTableState; onConfigure?: () => void }) {
  const { agents, providers, activeProviderId, activeModel, setActiveProvider, setActiveModel } = useTaskWorkspace();
  const { approvalMode, changeApprovalMode } = useApproval();
  const kindById = useMemo(() => {
    const m = new Map<string, AgentKind>();
    agents.forEach((a) => m.set(a.id, a.kind));
    return m;
  }, [agents]);

  // 'pending' before any activity; 'active' while discussion runs; 'done' once
  // the plan exists or the run finished. Annotated so the Stage prop type stays
  // narrow without a cast at the call site.
  const discussionState: 'done' | 'active' | 'pending' =
    rt.messages.length > 0 || rt.running
      ? rt.plan || !rt.running
        ? 'done'
        : 'active'
      : 'pending';
  const convergeState: 'done' | 'active' | 'pending' = rt.plan ? 'done' : rt.running ? 'active' : 'pending';
  const implementState: 'done' | 'active' | 'pending' = rt.implementing ? 'active' : rt.impls.length > 0 ? 'done' : 'pending';

  const participants = rt.enabled.map((a) => a.name).join(' · ');
  const rounds = rt.messages.reduce((m, x) => Math.max(m, x.round), 0);

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-background">
      {/* header */}
      <div className="flex h-[54px] flex-none items-center justify-between border-b border-border px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="truncate text-[14.5px] font-semibold text-foreground">圆桌讨论</span>
          <span className="flex flex-none items-center gap-[7px]">
            <Stage label="讨论" state={discussionState} />
            <span className="text-foreground/20">›</span>
            <Stage label="收敛" state={convergeState} />
            <span className="text-foreground/20">›</span>
            <Stage label="实现" state={implementState} />
          </span>
        </div>
        {providers.length > 0 && (
          <ModelPicker
            providers={providers}
            activeProviderId={activeProviderId}
            activeModel={activeModel}
            labelPrefix="主持人"
            onSelect={(providerId, model) => {
              if (providerId !== activeProviderId) setActiveProvider(providerId);
              setActiveModel(model);
            }}
          />
        )}
      </div>

      {/* status strip */}
      <div className="flex flex-none items-center gap-2.5 border-b border-border/70 px-6 py-2" style={{ background: '#fbfbfa' }}>
        <span
          className={`h-[7px] w-[7px] flex-none rounded-full ${rt.running || rt.implementing ? 'animate-pulse-dot' : ''}`}
          style={{ background: 'var(--status-green)' }}
        />
        <span className="text-xs font-semibold text-foreground">
          {rt.phase || (rt.plan ? '已收敛统一方案' : rt.enabled.length === 0 ? '未启用 API 智能体' : '准备讨论')}
        </span>
        <span className="ml-auto flex flex-none gap-3.5 whitespace-nowrap font-mono text-[10.5px] text-foreground/50">
          <span><b className="font-semibold text-foreground">{rt.enabled.length}</b> 智能体</span>
          <span><b className="font-semibold text-foreground">{rt.messages.length}</b> 发言</span>
        </span>
      </div>

      {/* scroll */}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-1 pt-5 selectable">
        <div className="mx-auto flex max-w-[760px] flex-col gap-4">
          {rt.enabled.length === 0 && rt.messages.length === 0 && (
            <div className="mt-8 flex flex-col items-center gap-3 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background: '#f3ede2' }}>
                <Hammer size={22} strokeWidth={1.6} style={{ color: '#c2632a' }} />
              </span>
              <div className="text-sm font-semibold text-foreground">还没有可参与讨论的智能体</div>
              <p className="max-w-[420px] text-[13px] leading-relaxed text-foreground/50">
                圆桌需要至少一个带 API 后端的智能体。配置好后，在左侧名册启用它们，再在下方提出议题——它们会互相讨论、收敛出统一方案，并各自在 worktree 实现。
              </p>
              {onConfigure && (
                <button
                  onClick={onConfigure}
                  className="mt-1 rounded-[10px] px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[#262626]"
                  style={{ background: '#0d0d0d' }}
                >
                  去设置添加智能体
                </button>
              )}
            </div>
          )}

          {/* topic card */}
          {(rt.messages.length > 0 || rt.plan) && rt.question && (
            <div className="border-b border-border/60 px-0.5 pb-4 text-sm leading-relaxed text-foreground/90">
              <span className="mb-1.5 block font-mono text-10 text-foreground/40">圆桌议题</span>
              {rt.question}
            </div>
          )}

          {/* discussion stream */}
          {rt.messages.map((m, i) => {
            const v = agentVisual(kindById.get(m.agentId) ?? 'api');
            // Composite key: agentId+round is unique per turn; i is a tiebreaker
            // for safety but the pair alone stabilizes across re-renders.
            return (
              <div key={`${m.agentId}-${m.round}-${i}`} className="flex gap-[13px]">
                <span
                  className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-lg"
                  style={{ background: v.iconBg }}
                >
                  <v.Icon size={14} strokeWidth={1.8} style={{ color: v.iconColor }} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-[7px]">
                    <span className="text-[12.5px] font-semibold text-foreground">{m.agentName}</span>
                    <span
                      className="rounded font-mono text-[9px] font-semibold"
                      style={{ color: v.badgeColor, background: v.badgeBg, padding: '1px 5px' }}
                    >
                      {v.badge}
                    </span>
                    <span className="font-mono text-10 text-foreground/35">轮 {m.round}</span>
                  </div>
                  <div className="whitespace-pre-wrap text-[13.5px] leading-[1.6] text-foreground/90">{m.text}</div>
                </div>
              </div>
            );
          })}

          {/* converged plan */}
          {rt.plan && (
            <div className="overflow-hidden rounded-[13px] border border-border shadow-card" style={{ background: '#fbfcf9' }}>
              <div className="flex items-center gap-2.5 border-b border-border/70 px-4 py-3">
                <span className="flex h-5 w-5 items-center justify-center rounded-md" style={{ background: '#0d0d0d' }}>
                  <Check size={12} strokeWidth={2} style={{ color: '#9fe870' }} />
                </span>
                <span className="text-[13px] font-semibold text-foreground">主持人 · 统一方案</span>
                <span className="ml-auto text-[10.5px] text-foreground/40">综合 {rt.enabled.length} 个意见</span>
              </div>
              <div className="whitespace-pre-wrap px-4 py-3 text-[13.5px] leading-[1.55] text-foreground/90">{rt.plan}</div>
              <div className="px-4 pb-3.5">
                {rt.rootPath ? (
                  <button
                    onClick={rt.implement}
                    disabled={rt.implementing || rt.implementable.length === 0}
                    className="flex w-full items-center justify-center gap-2 rounded-[10px] py-2.5 text-[13px] font-semibold text-white transition-colors disabled:opacity-40"
                    style={{ background: '#0d0d0d' }}
                  >
                    <Hammer size={15} strokeWidth={1.8} />
                    {rt.implementing ? '实现中…' : `让 agent 实现 (${rt.implementable.length})`}
                  </button>
                ) : (
                  <div className="rounded-[10px] border border-border py-2.5 text-center text-[11px] text-foreground/45">
                    需打开 git 项目才能实现
                  </div>
                )}
              </div>
            </div>
          )}

          {rt.notice && (
            <div
              className="rounded-[10px] px-3 py-2 text-11"
              style={
                rt.notice.tone === 'ok'
                  ? { color: '#1f6b27', background: 'var(--diff-add-surface)' }
                  : { color: '#9a2533', background: 'var(--diff-del-surface)' }
              }
            >
              {rt.notice.text}
            </div>
          )}
        </div>
      </div>

      {/* composer */}
      <div className="flex-none bg-background px-6 pb-5 pt-3">
        <div className="mx-auto max-w-[760px]">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[10.5px] text-foreground/40">
              {participants ? `参与：${participants}` : '未启用智能体'}
            </span>
          </div>
          <div className="rounded-[14px] border border-border-strong bg-background shadow-float focus-within:border-foreground/25">
            <textarea
              value={rt.question}
              onChange={(e) => rt.setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void rt.run();
                }
              }}
              rows={1}
              placeholder="给圆桌补充约束或追问…  回车直接发送"
              className="max-h-[120px] w-full resize-none bg-transparent px-4 pb-1 pt-3 text-[13.5px] leading-[1.55] text-foreground outline-none"
            />
            <div className="flex items-center gap-2 px-3 pb-2.5 pl-3 pr-2.5">
              <div className="inline-flex rounded-lg p-0.5" style={{ background: '#f1f1ef' }}>
                {(['readonly', 'auto', 'full'] as ApprovalMode[]).map((m) => {
                  const meta = APPROVAL_MODE_META[m];
                  const active = approvalMode === m;
                  const danger = m === 'full';
                  return (
                    <button
                      key={m}
                      onClick={() => changeApprovalMode(m)}
                      title={meta.hint}
                      className="rounded-md px-2.5 py-1 text-[11px] font-semibold transition-all"
                      style={
                        active
                          ? danger
                            ? { color: '#9a4a00', background: '#fdeccd', boxShadow: '0 1px 2px rgba(154,74,0,.22)' }
                            : { color: '#0d0d0d', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.12)' }
                          : { color: 'rgba(13,13,13,.5)' }
                      }
                    >
                      {meta.label}
                    </button>
                  );
                })}
              </div>
              <span
                className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold text-foreground/60"
                style={{ background: '#f1f1ef' }}
              >
                <Clock size={12} strokeWidth={1.8} />
                {rounds > 0 ? `讨论 ${rounds} 轮` : '圆桌讨论'}
              </span>
              {rt.running ? (
                <button
                  onClick={rt.stop}
                  className="ml-auto flex h-8 w-8 flex-none items-center justify-center rounded-full text-white transition-colors"
                  style={{ background: '#c1374a' }}
                  title="停止"
                >
                  <Square size={14} strokeWidth={2} />
                </button>
              ) : (
                <button
                  onClick={rt.run}
                  disabled={!rt.question.trim() || rt.enabled.length === 0}
                  className="ml-auto flex h-8 w-8 flex-none items-center justify-center rounded-full text-white transition-colors hover:bg-[#262626] disabled:opacity-30"
                  style={{ background: '#0d0d0d' }}
                  title="开始讨论 ⌘⏎"
                >
                  <ArrowUp size={16} strokeWidth={2} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
