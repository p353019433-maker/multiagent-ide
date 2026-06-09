import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useWorkspace } from '../../context/WorkspaceContext';
import { Download, GitBranchPlus, Plus, RefreshCw, Upload } from 'lucide-react';

interface GitChange {
  status: string; // "M ", "??", "A ", "AM", etc.
  path: string;
  staged: boolean; // in staging area vs working tree
}

const ACTION_BUTTON_CLASS =
  'flex h-6 w-6 items-center justify-center text-gray-400 hover:bg-editor-active hover:text-white disabled:opacity-40';
const FIELD_CLASS =
  'w-full border border-editor-border bg-editor-bg px-2 py-1 text-xs font-mono text-editor-text placeholder-gray-600 focus:border-editor-accent focus:outline-none';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function GitPanel() {
  const { rootPath } = useWorkspace();
  const [changes, setChanges] = useState<GitChange[]>([]);
  const [stagedChanges, setStagedChanges] = useState<GitChange[]>([]);
  const [diff, setDiff] = useState('');
  const [log, setLog] = useState('');
  const [loading, setLoading] = useState(false);
  const [commitMsg, setCommitMsg] = useState('');
  const [view, setView] = useState<'changes' | 'diff' | 'log'>('changes');
  const [branch, setBranch] = useState('');
  const [branches, setBranches] = useState<string[]>([]);
  const [statusMsg, setStatusMsg] = useState('');
  const [diffFile, setDiffFile] = useState<string | undefined>();
  const [diffStaged, setDiffStaged] = useState(false);
  const [creatingBranch, setCreatingBranch] = useState(false);
  const [branchDraft, setBranchDraft] = useState('');
  const branchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (creatingBranch) branchInputRef.current?.focus();
  }, [creatingBranch]);

  const parseStatus = (text: string) => {
    const lines = text.split('\n');
    const staged: GitChange[] = [];
    const unstaged: GitChange[] = [];
    let currentBranch = '';
    for (const line of lines) {
      if (line.startsWith('##')) {
        const m = line.match(/## (.+?)(?:\.\.\.|$)/);
        if (m) currentBranch = m[1];
        continue;
      }
      const trimmed = line.trim();
      if (!trimmed) continue;
      // git status --short shows XY where X=staging status, Y=working tree status
      const x = line[0] === ' ' ? '' : line[0];
      const y = line[1] === ' ' ? '' : line[1];
      const path = line.slice(3);
      const status = x + y;
      if (x && x !== ' ') staged.push({ status, path, staged: true });
      if (y && y !== ' ') unstaged.push({ status, path, staged: false });
    }
    return { staged, unstaged, branch: currentBranch };
  };

  const refresh = useCallback(async () => {
    if (!rootPath) return;
    setLoading(true);
    try {
      const [statusText, brText, curBr] = await Promise.all([
        window.api.git.status(rootPath),
        window.api.git.branchList(rootPath),
        window.api.git.currentBranch(rootPath),
      ]);
      const { staged, unstaged, branch } = parseStatus(statusText);
      setStagedChanges(staged);
      setChanges(unstaged);
      setBranch(curBr || branch);
      setBranches(brText.split('\n').map((l) => l.replace('*', '').trim()).filter(Boolean));
      setStatusMsg('');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatusMsg(message || '获取状态失败');
    }
    setLoading(false);
  }, [rootPath]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleViewDiff = async (filePath: string, staged: boolean) => {
    if (!rootPath) return;
    setDiffFile(filePath);
    setDiffStaged(staged);
    const d = await window.api.git.diff(rootPath, staged, filePath);
    setDiff(d || (filePath ? '没有差异' : ''));
    setView('diff');
  };

  const handleViewLog = async () => {
    if (!rootPath) return;
    const l = await window.api.git.log(rootPath, 20);
    setLog(l);
    setView('log');
  };

  const runGitAction = async (action: () => Promise<string>, onSuccess?: () => void) => {
    try {
      const result = await action();
      setStatusMsg(result);
      onSuccess?.();
    } catch (error) {
      setStatusMsg(getErrorMessage(error) || 'Git 操作失败');
    } finally {
      refresh();
    }
  };

  const handleStage = async (filePath: string) => {
    if (!rootPath) return;
    await runGitAction(() => window.api.git.stage(rootPath, [filePath]));
  };

  const handleUnstage = async (filePath: string) => {
    if (!rootPath) return;
    await runGitAction(() => window.api.git.unstage(rootPath, [filePath]));
  };

  const handleStageAll = async () => {
    if (!rootPath) return;
    await runGitAction(() => window.api.git.stageAll(rootPath));
  };

  const handleCommit = async () => {
    if (!rootPath || !commitMsg.trim()) return;
    await runGitAction(() => window.api.git.commit(rootPath, commitMsg), () => setCommitMsg(''));
  };

  const handlePush = async () => {
    if (!rootPath) return;
    await runGitAction(() => window.api.git.push(rootPath));
  };

  const handlePull = async () => {
    if (!rootPath) return;
    await runGitAction(() => window.api.git.pull(rootPath));
  };

  const handleSwitchBranch = async (name: string) => {
    if (!rootPath) return;
    await runGitAction(() => window.api.git.branchSwitch(rootPath, name));
  };

  const startCreateBranch = () => {
    setCreatingBranch(true);
    setBranchDraft('');
    setStatusMsg('');
  };

  const handleCreateBranch = async () => {
    if (!rootPath || !branchDraft.trim()) return;
    const name = branchDraft.trim();
    await runGitAction(
      () => window.api.git.branchCreate(rootPath, name),
      () => {
        setCreatingBranch(false);
        setBranchDraft('');
      }
    );
  };

  const statusLabel = (s: string) => {
    if (s === 'M' || s === 'M ') return { label: 'M', color: 'text-yellow-400' };
    if (s === '??') return { label: 'U', color: 'text-red-400' };
    if (s === 'A' || s === 'A ') return { label: 'A', color: 'text-green-400' };
    if (s === 'D' || s === ' D') return { label: 'D', color: 'text-red-500' };
    if (s === 'MM' || s === 'AM') return { label: s, color: 'text-yellow-400' };
    return { label: s, color: 'text-gray-500' };
  };

  return (
    <div className="h-full flex flex-col bg-editor-sidebar">
      {/* Header */}
      <div className="flex h-8 items-center justify-between border-b border-editor-border px-3">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Git</span>
          {branch && (
            <span className="font-mono text-[10px] text-editor-accent" title="当前分支">
              {branch}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={refresh}
            disabled={loading}
            className={ACTION_BUTTON_CLASS}
            title="刷新"
            aria-label="刷新 Git"
          >
            <RefreshCw size={14} strokeWidth={1.8} />
          </button>
          <button
            onClick={startCreateBranch}
            className={ACTION_BUTTON_CLASS}
            title="新建分支"
            aria-label="新建分支"
          >
            <GitBranchPlus size={14} strokeWidth={1.8} />
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-editor-border">
        {(['changes', 'diff', 'log'] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`flex-1 py-1.5 text-[11px] text-center ${
              view === v ? 'text-white border-b-2 border-editor-accent' : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {v === 'changes' ? '变更' : v === 'diff' ? '差异' : '日志'}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto selectable">
        {view === 'changes' && (
          <div>
            {/* Action bar */}
            <div className="px-3 py-1.5 border-b border-editor-border/50">
              <div className="flex items-center justify-between gap-1">
                <button
                  onClick={handleStageAll}
                  className={ACTION_BUTTON_CLASS}
                  title="暂存所有变更"
                  aria-label="暂存所有变更"
                >
                  <Plus size={14} strokeWidth={1.8} />
                </button>
                <div className="flex items-center gap-1">
                  <button
                    onClick={handlePull}
                    className={ACTION_BUTTON_CLASS}
                    title="从远程拉取"
                    aria-label="从远程拉取"
                  >
                    <Download size={14} strokeWidth={1.8} />
                  </button>
                  <button
                    onClick={handlePush}
                    className={ACTION_BUTTON_CLASS}
                    title="推送到远程"
                    aria-label="推送到远程"
                  >
                    <Upload size={14} strokeWidth={1.8} />
                  </button>
                </div>
              </div>

              {/* Branch quick switcher */}
              {creatingBranch && (
                <div className="mt-1.5 flex items-center gap-1">
                  <GitBranchPlus size={13} strokeWidth={1.8} className="flex-shrink-0 text-gray-500" />
                  <input
                    ref={branchInputRef}
                    value={branchDraft}
                    onChange={(e) => setBranchDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void handleCreateBranch();
                      } else if (e.key === 'Escape') {
                        setCreatingBranch(false);
                        setBranchDraft('');
                      }
                    }}
                    onBlur={() => {
                      if (!branchDraft.trim()) setCreatingBranch(false);
                    }}
                    placeholder="分支名"
                    spellCheck={false}
                    className={FIELD_CLASS}
                  />
                </div>
              )}

              {branches.length > 1 && (
                <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                  {branches.slice(0, 6).map((br) => (
                    <button
                      key={br}
                      onClick={() => handleSwitchBranch(br)}
                      className={`border px-1.5 py-0.5 font-mono text-[10px] ${
                        br === branch
                          ? 'border-editor-accent bg-editor-accent/20 text-editor-accent'
                          : 'border-editor-border bg-editor-bg text-gray-400 hover:bg-editor-hover hover:text-white'
                      }`}
                      title={`切换到 ${br}`}
                    >
                      {br.replace(/^remotes\/\w+\//, '')}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Status message */}
            {statusMsg && (
              <div className="px-3 py-1 text-[11px] text-gray-400 border-b border-editor-border/50 font-mono">
                {statusMsg}
              </div>
            )}

            {/* Staged changes */}
            {stagedChanges.length > 0 && (
              <div>
                <div className="px-3 py-1 text-[11px] font-semibold text-green-400">
                  已暂存 ({stagedChanges.length})
                </div>
                {stagedChanges.map((c, i) => {
                  const sl = statusLabel(c.status);
                  return (
                    <div
                      key={i}
                      className="flex items-center gap-2 px-3 py-[3px] hover:bg-editor-hover text-xs group"
                    >
                      <span
                        className={`${sl.color} font-mono text-[11px] cursor-pointer flex-shrink-0`}
                        onClick={() => handleUnstage(c.path)}
                        title="取消暂存"
                      >
                        {sl.label}
                      </span>
                      <span
                        className="text-editor-text truncate font-mono text-[11px] flex-1 cursor-pointer"
                        onClick={() => handleViewDiff(c.path, true)}
                      >
                        {c.path}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Unstaged changes */}
            {changes.length > 0 && (
              <div>
                {stagedChanges.length > 0 && (
                  <div className="px-3 py-1 text-[11px] font-semibold text-yellow-400">
                    未暂存 ({changes.length})
                  </div>
                )}
                {changes.map((c, i) => {
                  const sl = statusLabel(c.status);
                  return (
                    <div
                      key={i}
                      className="flex items-center gap-2 px-3 py-[3px] hover:bg-editor-hover text-xs group"
                    >
                      <span
                        className={`${sl.color} font-mono text-[11px] cursor-pointer flex-shrink-0`}
                        onClick={() => handleStage(c.path)}
                        title="暂存"
                      >
                        {sl.label}
                      </span>
                      <span
                        className="text-editor-text truncate font-mono text-[11px] flex-1 cursor-pointer"
                        onClick={() => handleViewDiff(c.path, false)}
                      >
                        {c.path}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {stagedChanges.length === 0 && changes.length === 0 && !statusMsg && (
              <div className="border-b border-editor-border px-3 py-2 text-xs text-gray-500">
                工作区干净
              </div>
            )}

            {/* Commit input */}
            {stagedChanges.length > 0 && (
              <div className="p-2 border-t border-editor-border">
                <textarea
                  value={commitMsg}
                  onChange={(e) => setCommitMsg(e.target.value)}
                  placeholder="提交信息..."
                  rows={2}
                  className={`${FIELD_CLASS} resize-none`}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      handleCommit();
                    }
                  }}
                />
                <div className="mt-1 flex justify-end">
                  <button
                    onClick={handleCommit}
                    disabled={!commitMsg.trim()}
                    className="px-2 py-0.5 text-[11px] bg-green-600 text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    提交
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {view === 'diff' && (
          <div>
            <div className="flex items-center gap-2 px-3 py-1 border-b border-editor-border/50 text-[11px]">
              <span
                className={`cursor-pointer border px-1.5 py-0.5 ${!diffStaged ? 'border-editor-accent bg-editor-accent/20 text-editor-accent' : 'border-editor-border bg-editor-bg text-gray-500 hover:bg-editor-hover hover:text-white'}`}
                onClick={() => diffFile && handleViewDiff(diffFile, false)}
              >
                工作区
              </span>
              <span
                className={`cursor-pointer border px-1.5 py-0.5 ${diffStaged ? 'border-editor-accent bg-editor-accent/20 text-editor-accent' : 'border-editor-border bg-editor-bg text-gray-500 hover:bg-editor-hover hover:text-white'}`}
                onClick={() => diffFile && handleViewDiff(diffFile, true)}
              >
                暂存区
              </span>
              {diffFile && (
                <span className="text-gray-600 ml-auto truncate font-mono text-[10px]">
                  {diffFile}
                </span>
              )}
            </div>
            <pre className="text-[11px] font-mono text-editor-text p-3 whitespace-pre-wrap leading-relaxed">
              {diff || '没有差异'}
            </pre>
          </div>
        )}

        {view === 'log' && (
          <pre className="text-[11px] font-mono text-editor-text p-3 whitespace-pre-wrap leading-relaxed">
            {log || '加载中...'}
          </pre>
        )}
      </div>
    </div>
  );
}
