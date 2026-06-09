import React from 'react';
import { GitMerge, Trash2, X } from 'lucide-react';
import type { Conversation } from '@shared/types';

type WorktreeInfo = {
  path?: string;
  branch?: string;
};

type MergeMethod = 'merge' | 'squash' | 'rebase';

const DRAWER_CLASS =
  'fixed bottom-0 right-0 top-8 z-50 flex w-full flex-col border-l border-editor-border bg-editor-bg';
const DRAWER_HEADER_CLASS =
  'flex h-8 flex-shrink-0 items-center justify-between border-b border-editor-border bg-editor-sidebar px-3';
const DRAWER_ACTION_BAR_CLASS =
  'flex h-10 flex-shrink-0 items-center justify-end gap-2 border-t border-editor-border bg-editor-sidebar px-3';
const DRAWER_BUTTON_CLASS = 'h-7 border px-3 text-[11px] disabled:opacity-50';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizePath(p: string) {
  return p.replace(/[\\/]+$/, '');
}

export async function ensureKnownWorktree(conv: Conversation, workspaceRoot: string | null) {
  if (!conv.worktree) {
    throw new Error('该任务没有关联 worktree');
  }
  if (!workspaceRoot) {
    throw new Error('未打开工作区，无法操作 worktree');
  }
  const worktree = conv.worktree;
  const trees = await window.api.git.worktreeList(workspaceRoot);
  const expectedPath = normalizePath(worktree.path);
  const known = (trees as WorktreeInfo[]).some((tree) => {
    return normalizePath(tree.path || '') === expectedPath && tree.branch === worktree.branch;
  });
  if (!known) {
    throw new Error('当前工作区未登记该 worktree，请先打开对应的基础仓库');
  }
  return worktree;
}

export async function cleanupWorktreeConversation(conv: Conversation, workspaceRoot: string | null) {
  const worktree = await ensureKnownWorktree(conv, workspaceRoot);
  const result = await window.api.git.worktreeRemove(workspaceRoot!, worktree.path, worktree.branch);
  if (!result.success) {
    throw new Error(result.message || `无法清理 worktree：${worktree.branch}`);
  }
  return { branch: worktree.branch };
}

/** Compact multi-session tab bar inside TaskPanel. */
export default function TaskSessionTabs({
  conversations,
  activeId,
  onSelect,
  onDelete,
  onRename,
  workspaceRoot,
}: {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  workspaceRoot: string | null;
}) {
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState('');
  const [mergeTarget, setMergeTarget] = React.useState<Conversation | null>(null);
  const [mergeDiff, setMergeDiff] = React.useState('');
  const [mergeLoading, setMergeLoading] = React.useState(false);
  const [mergeError, setMergeError] = React.useState('');
  const [operationNotice, setOperationNotice] = React.useState<{
    tone: 'success' | 'error';
    text: string;
  } | null>(null);
  const [cleanupTarget, setCleanupTarget] = React.useState<Conversation | null>(null);
  const [cleanupLoading, setCleanupLoading] = React.useState(false);

  const handleMerge = async (conv: Conversation) => {
    const worktree = conv.worktree;
    if (!worktree) return;
    setOperationNotice(null);
    setMergeTarget(conv);
    setMergeDiff('');
    setMergeError('');
    setMergeLoading(true);
    try {
      await ensureKnownWorktree(conv, workspaceRoot);
      const diff = await window.api.git.worktreeMergeDiff(workspaceRoot!, worktree.baseBranch, worktree.branch);
      setMergeDiff(diff);
    } catch (error) {
      setMergeError(getErrorMessage(error));
    } finally {
      setMergeLoading(false);
    }
  };

  const handleMergeConfirm = async (method: MergeMethod) => {
    const target = mergeTarget;
    const worktree = target?.worktree;
    if (!target || !worktree) return;
    setMergeLoading(true);
    try {
      await ensureKnownWorktree(target, workspaceRoot);
      const res = await window.api.git.worktreeMerge(
        workspaceRoot!,
        worktree.branch,
        method,
        worktree.baseBranch
      );
      if (!res.success) throw new Error(res.message);
      setOperationNotice({
        tone: 'success',
        text: `合并成功：${res.message}。已保留为本地改动；确认无误后再手动 push 到远端。`,
      });
      setMergeTarget(null);
    } catch (error) {
      setMergeError(getErrorMessage(error));
    }
    setMergeLoading(false);
  };

  const handleWorktreeCleanup = async (conv: Conversation) => {
    const worktree = conv.worktree;
    if (!worktree) return;
    setOperationNotice(null);
    setCleanupTarget(conv);
  };

  const handleCleanupConfirm = async () => {
    const target = cleanupTarget;
    const worktree = target?.worktree;
    if (!target || !worktree) return;
    setCleanupLoading(true);
    try {
      const result = await cleanupWorktreeConversation(target, workspaceRoot);
      setOperationNotice({ tone: 'success', text: `已清理 worktree：${result.branch}` });
      setCleanupTarget(null);
      onDelete(target.id);
    } catch (error) {
      setOperationNotice({ tone: 'error', text: `清理失败：${getErrorMessage(error)}` });
    } finally {
      setCleanupLoading(false);
    }
  };

  const mergeTargetWorktree = mergeTarget?.worktree;
  const cleanupTargetWorktree = cleanupTarget?.worktree;

  return (
    <>
    <div className="flex h-8 flex-shrink-0 items-stretch overflow-x-auto border-b border-editor-border hide-scrollbar">
      {conversations.map((conv) => (
        <div
          key={conv.id}
          onClick={() => onSelect(conv.id)}
          className={`group flex min-w-[96px] max-w-[180px] cursor-pointer items-center gap-1 border-r border-editor-border border-b-2 px-2 ${
            conv.id === activeId
              ? 'bg-editor-bg text-white ' + (conv.worktree ? 'border-b-yellow-500' : 'border-b-editor-accent')
              : 'border-b-transparent text-gray-400 hover:bg-editor-hover'
          }`}
        >
          {conv.worktree && <span className="text-[10px] flex-shrink-0 group-hover:hidden text-yellow-500">WT</span>}
          {conv.worktree && (
            <div className="hidden group-hover:flex items-center gap-0.5 flex-shrink-0">
              <button
                onClick={(e) => { e.stopPropagation(); handleMerge(conv); }}
                className="flex h-4 w-4 items-center justify-center text-emerald-400 hover:text-emerald-300"
                title="合并到基础分支"
              >
                <GitMerge size={12} strokeWidth={1.8} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleWorktreeCleanup(conv); }}
                className="flex h-4 w-4 items-center justify-center text-red-400 hover:text-red-300"
                title="清理 worktree"
              >
                <Trash2 size={12} strokeWidth={1.8} />
              </button>
            </div>
          )}
          {editingId === conv.id ? (
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => {
                if (draft.trim()) onRename(conv.id, draft.trim());
                setEditingId(null);
              }}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditingId(null); }}
              onClick={(e) => e.stopPropagation()}
              autoFocus
              spellCheck={false}
              className="w-full border border-editor-accent bg-editor-bg px-1 py-0 text-[11px] text-white outline-none"
            />
          ) : (
            <span
              className="text-[11px] font-mono truncate select-none"
              onDoubleClick={() => { setEditingId(conv.id); setDraft(conv.title); }}
            >
              {conv.title || '新任务'}
            </span>
          )}
          {conversations.length > 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(conv.id); }}
              className="flex h-4 w-4 flex-shrink-0 items-center justify-center text-gray-600 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
              title="关闭任务"
            >
              <X size={11} strokeWidth={1.8} />
            </button>
          )}
        </div>
      ))}
    </div>

    {operationNotice && (
      <div
        className={`border-b px-3 py-1.5 text-[11px] ${
          operationNotice.tone === 'success'
            ? 'border-emerald-900/70 text-emerald-300'
            : 'border-red-900/80 text-red-300'
        }`}
      >
        {operationNotice.text}
      </div>
    )}

    {/* ── Merge diff drawer ── */}
    {mergeTarget && mergeTargetWorktree && (
      <div className={`${DRAWER_CLASS} max-w-[760px]`}>
        <div className={DRAWER_HEADER_CLASS}>
          <div className="flex min-w-0 items-center gap-2">
            <GitMerge size={14} strokeWidth={1.8} className="flex-shrink-0 text-gray-500" />
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              合并预览
            </span>
            <span className="truncate font-mono text-[11px] text-gray-400">
              {mergeTargetWorktree.branch} → {mergeTargetWorktree.baseBranch}
            </span>
          </div>
          <button
            onClick={() => setMergeTarget(null)}
            className="flex h-6 w-6 items-center justify-center text-gray-400 hover:bg-editor-active hover:text-white"
            title="关闭"
            aria-label="关闭合并预览"
          >
            <X size={14} strokeWidth={1.8} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {mergeLoading ? (
            <div className="border-b border-editor-border px-3 py-2 text-xs text-gray-500">加载 diff...</div>
          ) : mergeError ? (
            <div className="border-b border-editor-border px-3 py-2 text-xs text-red-400">{mergeError}</div>
          ) : (
            <pre className="whitespace-pre-wrap px-3 py-2 font-mono text-[11px] leading-relaxed text-gray-300">
              {mergeDiff || '没有差异'}
            </pre>
          )}
        </div>

        <div className={DRAWER_ACTION_BAR_CLASS}>
          <button
            onClick={() => handleMergeConfirm('merge')}
            className={`${DRAWER_BUTTON_CLASS} border-emerald-700 bg-emerald-700 text-white hover:bg-emerald-600`}
          >
            Merge
          </button>
          <button
            onClick={() => handleMergeConfirm('squash')}
            className={`${DRAWER_BUTTON_CLASS} border-blue-700 bg-blue-700 text-white hover:bg-blue-600`}
          >
            Squash
          </button>
          <button
            onClick={() => handleMergeConfirm('rebase')}
            className={`${DRAWER_BUTTON_CLASS} border-editor-border bg-editor-active text-white hover:bg-editor-hover`}
          >
            Rebase
          </button>
          <button
            onClick={() => setMergeTarget(null)}
            className={`${DRAWER_BUTTON_CLASS} border-editor-border bg-editor-bg text-gray-300 hover:bg-editor-hover hover:text-white`}
          >
            取消
          </button>
        </div>
      </div>
    )}

    {cleanupTarget && cleanupTargetWorktree && (
      <div className={`${DRAWER_CLASS} max-w-[520px]`}>
        <div className={DRAWER_HEADER_CLASS}>
          <div className="flex min-w-0 items-center gap-2">
            <Trash2 size={14} strokeWidth={1.8} className="flex-shrink-0 text-red-400" />
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              清理 worktree
            </span>
          </div>
          <button
            onClick={() => setCleanupTarget(null)}
            className="flex h-6 w-6 items-center justify-center text-gray-400 hover:bg-editor-active hover:text-white"
            title="关闭"
            disabled={cleanupLoading}
            aria-label="关闭清理面板"
          >
            <X size={14} strokeWidth={1.8} />
          </button>
        </div>

        <div className="min-h-0 flex-1 text-xs text-gray-300">
          <div className="border-b border-red-900/70 px-3 py-2 text-red-300">
            将删除隔离工作树目录和分支。确认前请确保需要保留的改动已经合并或另行保存。
          </div>
          <dl className="font-mono text-[11px]">
            <div className="grid min-h-8 grid-cols-[72px_minmax(0,1fr)] border-b border-editor-border">
              <dt className="border-r border-editor-border px-3 py-2 text-gray-500">branch</dt>
              <dd className="truncate px-3 py-2 text-gray-300" title={cleanupTargetWorktree.branch}>
              {cleanupTargetWorktree.branch}
              </dd>
            </div>
            <div className="grid min-h-8 grid-cols-[72px_minmax(0,1fr)] border-b border-editor-border">
              <dt className="border-r border-editor-border px-3 py-2 text-gray-500">path</dt>
              <dd className="truncate px-3 py-2 text-gray-300" title={cleanupTargetWorktree.path}>
              {cleanupTargetWorktree.path}
              </dd>
            </div>
          </dl>
        </div>

        <div className={DRAWER_ACTION_BAR_CLASS}>
          <button
            onClick={handleCleanupConfirm}
            disabled={cleanupLoading}
            className={`${DRAWER_BUTTON_CLASS} border-red-700 bg-red-700 text-white hover:bg-red-600`}
          >
            {cleanupLoading ? '清理中' : '删除 worktree 和分支'}
          </button>
          <button
            onClick={() => setCleanupTarget(null)}
            disabled={cleanupLoading}
            className={`${DRAWER_BUTTON_CLASS} border-editor-border bg-editor-bg text-gray-300 hover:bg-editor-hover hover:text-white`}
          >
            取消
          </button>
        </div>
      </div>
    )}
    </>
  );
}
