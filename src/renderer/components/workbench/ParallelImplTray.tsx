import React, { useState } from 'react';
import { Check, GitMerge, Trash2 } from 'lucide-react';
import { agentVisual } from './agentTheme';
import { useTaskWorkspace } from '../../context/TaskContext';
import type { RoundTableState } from '../../task-engine/useRoundTable';
import type { ImplementationResult } from '../../task-engine/agentImplementation';
import type { AgentKind } from '@shared/types';

/** +N −N from a unified diff (skip the +++/--- file headers). */
function diffStat(diff?: string): { add: number; del: number } {
  if (!diff) return { add: 0, del: 0 };
  let add = 0;
  let del = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) add++;
    else if (line.startsWith('-') && !line.startsWith('---')) del++;
  }
  return { add, del };
}

function ImplCard({ r, rt, kind }: { r: ImplementationResult; rt: RoundTableState; kind: AgentKind }) {
  const [showDiff, setShowDiff] = useState(false);
  const v = agentVisual(kind);
  const { add, del } = diffStat(r.diff);
  const adopted = rt.adoptedBranch === r.branch;
  const wtName = r.worktreePath ? r.worktreePath.split('/').slice(-1)[0] : r.branch;

  return (
    <div
      className="overflow-hidden rounded-[12px] bg-background"
      style={
        adopted
          ? { border: '1.5px solid #5fb83d', boxShadow: '0 1px 4px rgba(95,184,61,.18)' }
          : { border: '1px solid rgba(13,13,13,.09)', boxShadow: '0 1px 3px rgba(0,0,0,.05)' }
      }
    >
      <div className="flex items-center gap-2 border-b border-border/60 px-[13px] py-2.5">
        <span className="flex h-5 w-5 flex-none items-center justify-center rounded-md" style={{ background: v.iconBg }}>
          <v.Icon size={11} strokeWidth={1.9} style={{ color: v.iconColor }} />
        </span>
        <span className="text-[12.5px] font-semibold text-foreground">{r.agent.name}</span>
        {r.status === 'running' ? (
          <span className="rounded font-mono text-[9px] font-semibold" style={{ color: '#c08a14', background: '#fdeecf', padding: '1px 6px' }}>
            running
          </span>
        ) : r.status === 'failed' ? (
          <span className="rounded font-mono text-[9px] font-semibold" style={{ color: '#9a2533', background: 'var(--diff-del-surface)', padding: '1px 6px' }}>
            failed
          </span>
        ) : (
          <span className="rounded font-mono text-[9px] font-semibold" style={{ color: '#3f8a2e', background: 'var(--status-green-surface)', padding: '1px 6px' }}>
            ok
          </span>
        )}
        {r.status === 'running' ? (
          <span className="ml-auto h-[7px] w-[7px] animate-pulse-dot rounded-full" style={{ background: '#c08a14' }} />
        ) : (
          <span className="ml-auto whitespace-nowrap font-mono text-10">
            <span style={{ color: '#2f8a4e' }}>+{add}</span> <span style={{ color: '#c1374a' }}>−{del}</span>
          </span>
        )}
      </div>

      <div className="px-[13px] py-2 font-mono text-10 text-foreground/45">
        {wtName} {r.status === 'running' ? '· 实现中…' : `· ${r.editedFiles.length} 文件`}
      </div>

      {r.error && <div className="px-[13px] pb-1 text-10" style={{ color: '#c1374a' }}>{r.error}</div>}
      {r.note && <div className="px-[13px] pb-1 text-10 text-foreground/45">{r.note}</div>}

      {showDiff && r.diff && (
        <pre className="mx-[13px] mb-2 max-h-48 overflow-auto whitespace-pre rounded-md border border-border bg-app p-2 font-mono text-[10px] leading-relaxed text-foreground/80">
          {r.diff.slice(0, 6000)}
        </pre>
      )}

      {r.status === 'ok' && r.diff && (
        <div className="flex gap-2 px-[13px] pb-3">
          <button
            onClick={() => setShowDiff((s) => !s)}
            className="flex-1 rounded-lg border border-border-strong bg-background py-[7px] text-[11.5px] font-semibold text-foreground transition-colors hover:bg-[#f6f6f4]"
          >
            {showDiff ? '收起 diff' : '对比 diff'}
          </button>
          {adopted ? (
            <button
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg py-[7px] text-[11.5px] font-bold"
              style={{ background: '#5fb83d', color: '#0c2b00' }}
            >
              <Check size={12} strokeWidth={2.2} />
              已采用
            </button>
          ) : (
            <button
              onClick={() => rt.adopt(r)}
              className="flex-1 rounded-lg border border-border-strong bg-background py-[7px] text-[11.5px] font-semibold text-foreground transition-colors hover:bg-[#f6f6f4]"
            >
              采用
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Right column for round mode: each enabled agent's worktree implementation as a
 * diff card with adopt / 已采用 / 对比, plus integrate + cleanup. Auto-checkpoint
 * before adopt; unadopted worktrees are cleaned up.
 */
export default function ParallelImplTray({ rt }: { rt: RoundTableState }) {
  const { agents } = useTaskWorkspace();
  const kindById = (id: string): AgentKind => agents.find((a) => a.id === id)?.kind ?? 'api';

  return (
    <div className="flex h-full flex-col" style={{ background: 'var(--app-bg)' }}>
      <div className="flex flex-none items-center justify-between border-b border-border/70 px-4 py-3">
        <span className="text-[12.5px] font-semibold text-foreground">并行实现</span>
        <span className="font-mono text-10 text-foreground/40">各自 worktree</span>
      </div>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-3.5">
        {rt.impls.length === 0 ? (
          <p className="px-1 text-11 leading-relaxed text-foreground/45">
            收敛出统一方案后，点中间「让 agent 实现」，每个启用的 agent 会在各自的 git worktree 里实现，结果在这里对比、采用。
          </p>
        ) : (
          <>
            {rt.canIntegrate && (
              <button
                onClick={rt.integrate}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-border-strong bg-background py-2 text-[11.5px] font-semibold text-foreground transition-colors hover:bg-[#f6f6f4]"
              >
                <GitMerge size={12} strokeWidth={1.8} />
                整合为 best-of
              </button>
            )}
            {rt.impls.map((r) => (
              <ImplCard key={r.branch} r={r} rt={rt} kind={kindById(r.agent.id)} />
            ))}
            <button
              onClick={rt.cleanup}
              className="flex items-center justify-center gap-1.5 py-1 text-10 text-foreground/45 transition-colors hover:text-[#c1374a]"
            >
              <Trash2 size={11} strokeWidth={1.8} />
              清理本次 worktree
            </button>
            <p className="px-1 text-11 leading-[1.6] text-foreground/45">
              采用前自动建检查点，可一键回滚；未采用的 worktree 会被清理。
            </p>
          </>
        )}
      </div>
    </div>
  );
}
