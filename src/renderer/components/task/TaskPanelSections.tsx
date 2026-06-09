import React from 'react';
import { FileText, RotateCcw, ShieldCheck } from 'lucide-react';
import type { Artifact, Checkpoint } from '@shared/types';
import { type ApprovalMode, APPROVAL_MODE_META } from '@shared/command-policy';
import type { PendingApproval } from '../../task-engine/useApproval';
import DiffPreview from '../editor/DiffPreview';

interface ApprovalModeStripProps {
  mode: ApprovalMode;
  onChange: (mode: ApprovalMode) => void;
}

export function ApprovalModeStrip({ mode, onChange }: ApprovalModeStripProps) {
  return (
    <div className="grid h-8 flex-shrink-0 grid-cols-[96px_minmax(0,1fr)] border-b border-editor-border bg-editor-bg">
      <div className="flex min-w-0 items-center gap-1.5 border-r border-editor-border px-3 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
        <ShieldCheck size={13} strokeWidth={1.8} className="flex-shrink-0" />
        <span className="truncate">执行策略</span>
      </div>
      <div className="grid min-w-0 grid-cols-3">
        {(['readonly', 'auto', 'full'] as ApprovalMode[]).map((m) => {
          const meta = APPROVAL_MODE_META[m];
          const active = mode === m;
          return (
            <button
              key={m}
              onClick={() => onChange(m)}
              title={meta.hint}
              aria-label={`切换执行策略：${meta.label}`}
              className={`h-8 border-r border-editor-border border-b-2 px-2 text-[11px] transition-colors duration-75 last:border-r-0 ${
                active
                  ? 'border-b-editor-accent bg-editor-sidebar text-white'
                  : 'border-b-transparent text-gray-500 hover:bg-editor-hover hover:text-gray-300'
              }`}
            >
              {meta.label}
            </button>
          );
        })}
      </div>
    </div>
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
      <div className="flex h-8 items-center border-b border-editor-border bg-editor-sidebar px-3 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
        检查点
      </div>
      {notice && (
        <div
          className={`border-b border-editor-border px-3 py-2 text-[11px] ${
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
          <div key={cp.id} className="border-b border-editor-border text-[11px]">
            <div className="grid min-h-7 grid-cols-[minmax(0,1fr)_72px] items-center">
              <span className="truncate px-3 text-gray-400" title={cp.label}>
                {cp.label || '改动'}（{cp.files.length} 文件）
              </span>
              <button
                onClick={() => {
                  setNotice(null);
                  setPendingRevertId(cp.id);
                }}
                className="flex h-7 items-center justify-center gap-1 border-l border-editor-border text-gray-400 hover:bg-editor-hover hover:text-white"
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
                    className="h-6 border border-red-700 bg-red-700 px-2 text-[11px] text-white hover:bg-red-600 disabled:opacity-50"
                  >
                    {reverting ? '回滚中' : '确认回滚'}
                  </button>
                  <button
                    onClick={() => setPendingRevertId(null)}
                    disabled={reverting}
                    className="h-6 border border-editor-border px-2 text-[11px] text-gray-300 hover:bg-editor-hover hover:text-white disabled:opacity-50"
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
      <div className="flex h-8 items-center border-b border-editor-border bg-editor-sidebar px-3 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
        验证记录
      </div>
      {artifacts.slice(0, 5).map((artifact) => (
        <div
          key={artifact.id}
          className="grid min-h-7 grid-cols-[64px_minmax(0,1fr)_64px] items-center border-b border-editor-border text-[11px]"
        >
          <span
            className={`border-r border-editor-border px-3 font-mono ${
              artifact.verified ? 'text-green-400' : 'text-red-400'
            }`}
            title={artifact.verified ? '验证通过' : '验证未通过'}
          >
            {artifact.verified ? 'pass' : 'fail'}
          </span>
          <span className="truncate px-3 text-gray-400" title={artifact.label}>
            {artifact.label}（{artifact.files.length} 文件）
          </span>
          {artifact.path ? (
            <button
              onClick={() => onOpen(artifact.path!)}
              className="flex h-7 items-center justify-center gap-1 border-l border-editor-border text-gray-400 hover:bg-editor-hover hover:text-white"
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
        <span className="border-r border-editor-border px-3 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
          审批
        </span>
        <span className="min-w-0 truncate px-3 text-gray-300">
          {pendingApproval.action === 'command' ? '执行命令' : 'GitHub 操作'}：
          {pendingApproval.filePath.slice(0, 80)}
        </span>
        <span
          className={`border-l border-editor-border px-3 text-[11px] ${
            pendingApproval.dangerReason ? 'text-red-400' : 'text-yellow-400'
          }`}
        >
          {pendingApproval.countdown ? 'AUTO 5S' : 'MANUAL'}
        </span>
      </div>
      {pendingApproval.dangerReason && (
        <div className="border-b border-editor-border px-3 py-2 text-[11px] text-red-300">
          高风险操作：{pendingApproval.dangerReason}
        </div>
      )}
      <pre className="max-h-24 overflow-y-auto whitespace-pre-wrap border-b border-editor-border bg-editor-bg px-3 py-2 text-[11px] text-gray-300">
        {pendingApproval.after.slice(0, 500)}
      </pre>
      <div className="flex h-8 items-center gap-2 px-3">
        <button
          onClick={onAccept}
          className="h-6 border border-green-700 px-2 text-[11px] text-green-300 hover:bg-editor-hover"
        >
          接受
        </button>
        <button
          onClick={onReject}
          className="h-6 border border-red-700 px-2 text-[11px] text-red-300 hover:bg-editor-hover"
        >
          拒绝
        </button>
      </div>
    </div>
  );
}
