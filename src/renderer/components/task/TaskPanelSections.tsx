import React from 'react';
import { Check, ChevronDown, ChevronRight, FileText, RotateCcw } from 'lucide-react';
import type { Artifact, Checkpoint, PlanStep } from '@shared/types';
import type { PendingApproval } from '../../task-engine/useApproval';
import DiffPreview from '../editor/DiffPreview';

interface AgentRunBarProps {
  isStreaming: boolean;
  awaitingApproval: boolean;
  toolCount: number;
  runningCount: number;
  /** Token usage (prompt + completion) of the latest round-trip this turn. */
  tokens: number;
}

function formatTokens(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return `${k >= 10 ? Math.round(k) : Math.round(k * 10) / 10}k`;
  }
  return String(n);
}

/**
 * Sticky run-status strip pinned to the top of the Agent thread. Surfaces the
 * current run state, pending-approval flag, tool count and latest-turn token
 * usage so task progress is glanceable while scrolling. Mirrors the Open Design
 * `agent-runbar`, restyled with the project's own theme tokens. Renders nothing
 * until there is activity to report.
 */
export function AgentRunBar({ isStreaming, awaitingApproval, toolCount, runningCount, tokens }: AgentRunBarProps) {
  if (!isStreaming && toolCount === 0 && !awaitingApproval) return null;

  const live = isStreaming || awaitingApproval;
  const stateText = awaitingApproval
    ? '等待审批'
    : runningCount > 0
    ? '正在执行工具'
    : isStreaming
    ? '运行中'
    : '本轮完成';

  return (
    <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-editor-border bg-editor-bg px-3 py-1.5">
      <span className="flex min-w-0 items-center gap-2 text-xs font-medium text-foreground">
        <span
          className={`h-2 w-2 flex-shrink-0 rounded-full ${live ? 'bg-editor-accent' : 'bg-muted-foreground'} ${
            isStreaming ? 'animate-pulse' : ''
          }`}
        />
        <span className="truncate">{stateText}</span>
      </span>
      <span className="ml-auto flex items-center gap-3 whitespace-nowrap font-mono text-10 text-muted-foreground">
        {awaitingApproval && (
          <span className="flex items-center gap-1">
            <b className="font-semibold tabular-nums text-yellow-400">1</b> 待审批
          </span>
        )}
        <span className="flex items-center gap-1">
          <b className="font-semibold tabular-nums text-foreground">{toolCount}</b> 工具
        </span>
        {tokens > 0 && (
          <span className="flex items-center gap-1">
            <b className="font-semibold tabular-nums text-foreground">{formatTokens(tokens)}</b> token
          </span>
        )}
      </span>
    </div>
  );
}

const PLAN_STATE_META: Record<PlanStep['status'], { label: string; cls: string }> = {
  pending: { label: '待办', cls: 'text-muted-foreground' },
  in_progress: { label: '进行中', cls: 'text-yellow-400' },
  completed: { label: '完成', cls: 'text-emerald-400' },
};

/**
 * Agent execution plan card (Open Design `agent-plan`), rendered below the run-
 * bar. Reflects the live plan the model maintains via the update_plan tool;
 * collapsible and read-only. Renders nothing until a plan exists.
 */
export function AgentPlan({ steps }: { steps: PlanStep[] }) {
  const [collapsed, setCollapsed] = React.useState(false);
  if (!steps.length) return null;
  const done = steps.filter((s) => s.status === 'completed').length;

  return (
    <section className="border-b border-editor-border bg-editor-bg">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex h-8 w-full items-center gap-2 px-3 text-left"
        aria-expanded={!collapsed}
      >
        <span className="text-10 font-semibold uppercase tracking-wide text-muted-foreground">执行计划</span>
        <span className="font-mono text-10 tabular-nums text-muted-foreground">
          {done}/{steps.length}
        </span>
        <span className="ml-auto text-muted-foreground">
          {collapsed ? <ChevronRight size={13} strokeWidth={1.8} /> : <ChevronDown size={13} strokeWidth={1.8} />}
        </span>
      </button>
      {!collapsed && (
        <div className="pb-1">
          {steps.map((s, i) => {
            const meta = PLAN_STATE_META[s.status];
            return (
              <div
                key={i}
                className={`grid grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-2 px-3 py-1 text-xs ${
                  s.status === 'in_progress' ? 'bg-yellow-400/5' : ''
                }`}
              >
                <span className="flex items-center justify-center">
                  {s.status === 'completed' ? (
                    <Check size={13} strokeWidth={2} className="text-emerald-400" />
                  ) : (
                    <span className="font-mono text-10 tabular-nums text-muted-foreground">{i + 1}</span>
                  )}
                </span>
                <span
                  className={`min-w-0 truncate ${
                    s.status === 'completed' ? 'text-muted-foreground line-through' : 'text-editor-text'
                  }`}
                >
                  {s.content}
                </span>
                <span className={`font-mono text-10 ${meta.cls}`}>{meta.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

interface CheckpointListProps {
  checkpoints: Checkpoint[];
  onRevert: (checkpoint: Checkpoint) => Promise<{
    reverted: number;
    failed: number;
  }>;
}

export function CheckpointList({ checkpoints, onRevert }: CheckpointListProps) {
  const [pendingRevertId, setPendingRevertId] = React.useState<string | null>(null);
  const [revertingId, setRevertingId] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<{
    tone: 'success' | 'error' | 'warning';
    text: string;
  } | null>(null);

  if (checkpoints.length === 0) return null;

  const confirmRevert = async (cp: Checkpoint) => {
    setRevertingId(cp.id);
    setNotice(null);
    try {
      const result = await onRevert(cp);
      if (result.failed > 0) {
        setNotice({
          tone: 'warning',
          text: `已回滚 ${result.reverted} 个文件，${result.failed} 个文件失败。检查点已保留。`,
        });
      } else {
        setNotice({ tone: 'success', text: `已回滚 ${result.reverted} 个文件` });
        setPendingRevertId(null);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setNotice({ tone: 'error', text: `回滚失败：${message}` });
    } finally {
      setRevertingId(null);
    }
  };

  return (
    <section className="max-h-28 flex-shrink-0 overflow-y-auto border-t border-editor-border">
      <div className="flex h-8 items-center border-b border-editor-border bg-editor-sidebar px-3 text-10 font-semibold uppercase tracking-wide text-muted-foreground">
        检查点
      </div>
      {notice && (
        <div
          className={`border-b border-editor-border px-3 py-2 text-11 ${
            notice.tone === 'success'
              ? 'text-emerald-300'
              : notice.tone === 'warning'
              ? 'text-yellow-300'
              : 'text-red-300'
          }`}
        >
          {notice.text}
        </div>
      )}
      {checkpoints.slice(0, 5).map((cp) => {
        const pending = pendingRevertId === cp.id;
        const reverting = revertingId === cp.id;
        return (
          <div key={cp.id} className="border-b border-editor-border text-11">
            <div className="grid min-h-7 grid-cols-[minmax(0,1fr)_72px] items-center">
              <span className="truncate px-3 text-muted-foreground" title={cp.label}>
                {cp.label || '改动'}（{cp.files.length} 文件）
              </span>
              <button
                onClick={() => {
                  setNotice(null);
                  setPendingRevertId(cp.id);
                }}
                className="flex h-7 items-center justify-center gap-1 border-l border-editor-border text-muted-foreground hover:bg-editor-hover hover:text-foreground"
                title="回滚此检查点的所有文件改动"
              >
                <RotateCcw size={12} strokeWidth={1.8} />
                回滚
              </button>
            </div>
            {pending && (
              <div className="border-t border-red-900/70">
                <div className="px-3 py-2 text-red-300">
                  确认回滚 {cp.files.length} 个文件到「{cp.label || '改动'}」之前的状态？
                </div>
                <div className="flex h-8 items-center gap-2 border-t border-editor-border px-3">
                  <button
                    onClick={() => confirmRevert(cp)}
                    disabled={reverting}
                    className="h-6 border border-red-700 bg-red-700 px-2 text-11 text-white hover:bg-red-600 disabled:opacity-50"
                  >
                    {reverting ? '回滚中' : '确认回滚'}
                  </button>
                  <button
                    onClick={() => setPendingRevertId(null)}
                    disabled={reverting}
                    className="h-6 border border-editor-border px-2 text-11 text-foreground hover:bg-editor-hover hover:text-foreground disabled:opacity-50"
                  >
                    取消
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

interface ArtifactListProps {
  artifacts: Artifact[];
  onOpen: (path: string) => void;
}

export function ArtifactList({ artifacts, onOpen }: ArtifactListProps) {
  if (artifacts.length === 0) return null;

  return (
    <section className="max-h-28 flex-shrink-0 overflow-y-auto border-t border-editor-border">
      <div className="flex h-8 items-center border-b border-editor-border bg-editor-sidebar px-3 text-10 font-semibold uppercase tracking-wide text-muted-foreground">
        验证记录
      </div>
      {artifacts.slice(0, 5).map((artifact) => (
        <div
          key={artifact.id}
          className="grid min-h-7 grid-cols-[64px_minmax(0,1fr)_64px] items-center border-b border-editor-border text-11"
        >
          <span
            className={`border-r border-editor-border px-3 font-mono ${
              artifact.verified ? 'text-green-400' : 'text-red-400'
            }`}
            title={artifact.verified ? '验证通过' : '验证未通过'}
          >
            {artifact.verified ? 'pass' : 'fail'}
          </span>
          <span className="truncate px-3 text-muted-foreground" title={artifact.label}>
            {artifact.label}（{artifact.files.length} 文件）
          </span>
          {artifact.path ? (
            <button
              onClick={() => onOpen(artifact.path!)}
              className="flex h-7 items-center justify-center gap-1 border-l border-editor-border text-muted-foreground hover:bg-editor-hover hover:text-foreground"
              title="打开交付报告"
            >
              <FileText size={12} strokeWidth={1.8} />
              查看
            </button>
          ) : (
            <span className="h-full border-l border-editor-border" />
          )}
        </div>
      ))}
    </section>
  );
}

interface PendingApprovalViewProps {
  pendingApproval: PendingApproval | null;
  onAccept: () => void;
  onReject: () => void;
}

export function PendingApprovalView({ pendingApproval, onAccept, onReject }: PendingApprovalViewProps) {
  if (!pendingApproval) return null;

  const isFileEdit =
    pendingApproval.action === 'edit' ||
    pendingApproval.action === 'write' ||
    pendingApproval.action === 'replace_in_file' ||
    pendingApproval.action === 'search_and_replace';

  if (isFileEdit) {
    return (
      <div className="h-[250px] flex-shrink-0 border-t border-editor-border">
        <DiffPreview
          original={pendingApproval.before}
          modified={pendingApproval.after}
          filePath={pendingApproval.filePath}
          visible={true}
          onAccept={onAccept}
          onReject={onReject}
          statusText={pendingApproval.countdown ? '5 秒后自动接受' : '需手动批准'}
          statusTone={pendingApproval.dangerReason ? 'danger' : 'warning'}
        />
      </div>
    );
  }

  return (
    <div className="flex-shrink-0 border-t border-editor-border bg-editor-bg">
      <div className="grid h-8 grid-cols-[96px_minmax(0,1fr)_96px] items-center border-b border-editor-border bg-editor-sidebar text-xs">
        <span className="border-r border-editor-border px-3 text-10 font-semibold uppercase tracking-wide text-muted-foreground">
          审批
        </span>
        <span className="min-w-0 truncate px-3 text-foreground">
          {pendingApproval.action === 'command' ? '执行命令' : 'GitHub 操作'}：
          {pendingApproval.filePath.slice(0, 80)}
        </span>
        <span
          className={`border-l border-editor-border px-3 text-11 ${
            pendingApproval.dangerReason ? 'text-red-400' : 'text-yellow-400'
          }`}
        >
          {pendingApproval.countdown ? 'AUTO 5S' : 'MANUAL'}
        </span>
      </div>
      {pendingApproval.dangerReason && (
        <div className="border-b border-editor-border px-3 py-2 text-11 text-red-300">
          高风险操作：{pendingApproval.dangerReason}
        </div>
      )}
      <pre className="max-h-24 overflow-y-auto whitespace-pre-wrap border-b border-editor-border bg-editor-bg px-3 py-2 text-11 text-foreground">
        {pendingApproval.after.slice(0, 500)}
      </pre>
      <div className="flex h-8 items-center gap-2 px-3">
        <button
          onClick={onAccept}
          className="h-6 border border-green-700 px-2 text-11 text-green-300 hover:bg-editor-hover"
        >
          接受
        </button>
        <button
          onClick={onReject}
          className="h-6 border border-red-700 px-2 text-11 text-red-300 hover:bg-editor-hover"
        >
          拒绝
        </button>
      </div>
    </div>
  );
}
