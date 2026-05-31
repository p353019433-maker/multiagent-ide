import React from 'react';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Compact multi-session tab bar inside ChatPanel */
export default function SessionTabs({
  conversations,
  activeId,
  onSelect,
  onDelete,
  onNew,
  onNewWorktree,
  onRename,
  workspaceRoot,
}: {
  conversations: any[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: () => string;
  onNewWorktree: () => void;
  onRename: (id: string, title: string) => void;
  workspaceRoot: string | null;
}) {
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState('');
  const [showMenu, setShowMenu] = React.useState(false);
  const [mergeTarget, setMergeTarget] = React.useState<any | null>(null);
  const [mergeDiff, setMergeDiff] = React.useState('');
  const [mergeLoading, setMergeLoading] = React.useState(false);
  const [mergeError, setMergeError] = React.useState('');
  const [, forceRerender] = React.useState(0);

  const handleMerge = (conv: any) => {
    if (!workspaceRoot) {
      setMergeError('未打开工作区，无法合并 worktree');
      return;
    }
    setMergeTarget(conv);
    setMergeDiff('');
    setMergeError('');
    setMergeLoading(true);
    window.api.git.worktreeMergeDiff(workspaceRoot, conv.worktree.baseBranch, conv.worktree.branch)
      .then((diff: string) => { setMergeDiff(diff); setMergeLoading(false); })
      .catch((e: any) => { setMergeError(e.message); setMergeLoading(false); });
  };

  const handleMergeConfirm = async (method: string) => {
    if (!mergeTarget) return;
    if (!workspaceRoot) {
      setMergeError('未打开工作区，无法合并 worktree');
      return;
    }
    setMergeLoading(true);
    try {
      const res = await window.api.git.worktreeMerge(workspaceRoot, mergeTarget.worktree.branch, method);
      if (!res.success) throw new Error(res.message);
      // Push after merge
      await window.api.git.push(workspaceRoot, 'origin');
      alert(`合并成功：${res.message}\n已推送到 origin`);
      setMergeTarget(null);
      // Optionally clean up worktree
    } catch (e: any) {
      setMergeError(e.message || String(e));
    }
    setMergeLoading(false);
  };

  const handleWorktreeCleanup = async (conv: any) => {
    if (!workspaceRoot) {
      alert('未打开工作区，无法清理 worktree');
      return;
    }
    if (!confirm(`删除 ${conv.worktree.branch} 的 worktree 和分支？`)) return;
    try {
      await window.api.git.worktreeRemove(workspaceRoot, conv.worktree.path);
      alert('Worktree 已清理');
      onDelete(conv.id);
    } catch (e: any) {
      alert(`清理失败：${e.message}`);
    }
  };

  return (
    <>
    <div className="flex items-center border-b border-editor-border flex-shrink-0 overflow-x-auto hide-scrollbar">
      {conversations.map((conv) => (
        <div
          key={conv.id}
          onClick={() => onSelect(conv.id)}
          className={`group flex items-center gap-1 px-3 py-1.5 cursor-pointer border-r border-editor-border min-w-0 max-w-[160px] ${
            conv.id === activeId
              ? 'bg-editor-bg text-white border-t-2 ' + (conv.worktree ? 'border-t-yellow-500' : 'border-t-editor-accent')
              : 'text-gray-400 hover:bg-editor-hover'
          }`}
        >
          {conv.worktree && <span className="text-[10px] flex-shrink-0 group-hover:hidden">🪵</span>}
          {conv.worktree && (
            <div className="hidden group-hover:flex items-center gap-0.5 flex-shrink-0">
              <button
                onClick={(e) => { e.stopPropagation(); handleMerge(conv); }}
                className="text-[10px] text-emerald-400 hover:text-emerald-300"
                title="合并到基础分支"
              >
                ⥄
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleWorktreeCleanup(conv); }}
                className="text-[10px] text-red-400 hover:text-red-300"
                title="清理 worktree"
              >
                🗑
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
              className="w-full text-[11px] bg-editor-bg border border-editor-accent rounded px-1 py-0 text-white outline-none"
            />
          ) : (
            <span
              className="text-[11px] font-mono truncate select-none"
              onDoubleClick={() => { setEditingId(conv.id); setDraft(conv.title); }}
            >
              {conv.title || '新对话'}
            </span>
          )}
          {conversations.length > 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(conv.id); }}
              className="text-[10px] text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
            >
              ✕
            </button>
          )}
        </div>
      ))}
      <div className="relative flex-shrink-0">
        <button
          onClick={() => setShowMenu(!showMenu)}
          className="px-2 py-1.5 text-sm text-gray-400 hover:text-white hover:bg-editor-hover"
          title="新建会话"
        >
          +
        </button>
        {showMenu && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
            <div className="absolute left-0 top-full z-20 mt-0.5 w-44 bg-editor-sidebar border border-editor-border rounded shadow-lg py-1">
              <button
                onClick={() => { onNew(); setShowMenu(false); }}
                className="w-full text-left px-3 py-1.5 text-[11px] text-gray-300 hover:bg-editor-hover flex items-center gap-2"
              >
                <span className="text-xs">💬</span> 新建普通会话
              </button>
              <button
                onClick={() => { onNewWorktree(); setShowMenu(false); }}
                className="w-full text-left px-3 py-1.5 text-[11px] text-gray-300 hover:bg-editor-hover flex items-center gap-2"
              >
                <span className="text-xs">🪵</span> 新建隔离会话 (Worktree)
              </button>
            </div>
          </>
        )}
      </div>
    </div>

    {/* ── Merge diff modal ── */}
    {mergeTarget && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setMergeTarget(null)}>
        <div
          className="bg-editor-sidebar border border-editor-border rounded-lg shadow-2xl w-[700px] max-h-[80vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-editor-border">
            <span className="text-xs font-semibold text-gray-300">
              🪵 合并 {mergeTarget.worktree.branch} → {mergeTarget.worktree.baseBranch}
            </span>
            <button onClick={() => setMergeTarget(null)} className="text-gray-500 hover:text-white text-sm">✕</button>
          </div>
          <div className="flex-1 overflow-auto p-4">
            {mergeLoading ? (
              <p className="text-xs text-gray-500">加载 diff...</p>
            ) : mergeError ? (
              <p className="text-xs text-red-400">{mergeError}</p>
            ) : (
              <pre className="text-[11px] font-mono text-gray-300 whitespace-pre-wrap bg-black/20 rounded p-3">
                {mergeDiff || '没有差异'}
              </pre>
            )}
          </div>
          <div className="flex gap-2 px-4 py-3 border-t border-editor-border justify-end">
            <button onClick={() => handleMergeConfirm('merge')} className="px-3 py-1 text-[11px] bg-emerald-600 text-white rounded hover:bg-emerald-700">Merge</button>
            <button onClick={() => handleMergeConfirm('squash')} className="px-3 py-1 text-[11px] bg-blue-600 text-white rounded hover:bg-blue-700">Squash</button>
            <button onClick={() => handleMergeConfirm('rebase')} className="px-3 py-1 text-[11px] bg-purple-600 text-white rounded hover:bg-purple-700">Rebase</button>
            <button onClick={() => setMergeTarget(null)} className="px-3 py-1 text-[11px] bg-gray-600 text-white rounded hover:bg-gray-700">取消</button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
