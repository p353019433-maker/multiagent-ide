import React, { useEffect, useState, useCallback } from 'react';
import { useWorkspace } from '../../context/WorkspaceContext';

interface GitChange {
  status: string; // "M ", "??", "A ", "AM", etc.
  path: string;
  staged: boolean; // in staging area vs working tree
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
    } catch (e: any) {
      setStatusMsg(e.message || '获取状态失败');
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

  const handleStage = async (filePath: string) => {
    if (!rootPath) return;
    const result = await window.api.git.stage(rootPath, [filePath]);
    setStatusMsg(result);
    refresh();
  };

  const handleUnstage = async (filePath: string) => {
    if (!rootPath) return;
    const result = await window.api.git.unstage(rootPath, [filePath]);
    setStatusMsg(result);
    refresh();
  };

  const handleStageAll = async () => {
    if (!rootPath) return;
    const result = await window.api.git.stageAll(rootPath);
    setStatusMsg(result);
    refresh();
  };

  const handleCommit = async () => {
    if (!rootPath || !commitMsg.trim()) return;
    const result = await window.api.git.commit(rootPath, commitMsg);
    setStatusMsg(result);
    setCommitMsg('');
    refresh();
  };

  const handlePush = async () => {
    if (!rootPath) return;
    const result = await window.api.git.push(rootPath);
    setStatusMsg(result);
    refresh();
  };

  const handlePull = async () => {
    if (!rootPath) return;
    const result = await window.api.git.pull(rootPath);
    setStatusMsg(result);
    refresh();
  };

  const handleSwitchBranch = async (name: string) => {
    if (!rootPath) return;
    const result = await window.api.git.branchSwitch(rootPath, name);
    setStatusMsg(result);
    refresh();
  };

  const handleCreateBranch = async () => {
    if (!rootPath) return;
    const name = prompt('新分支名：');
    if (!name) return;
    const result = await window.api.git.branchCreate(rootPath, name);
    setStatusMsg(result);
    refresh();
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
      <div className="flex items-center justify-between px-3 py-2 border-b border-editor-border">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Git</span>
          {branch && (
            <span className="text-[11px] text-editor-accent font-mono" title="当前分支">
              {branch}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={refresh}
            disabled={loading}
            className="text-xs px-1.5 py-0.5 rounded hover:bg-editor-active text-gray-400 hover:text-white"
            title="刷新"
          >
            🔄
          </button>
          <button
            onClick={handleCreateBranch}
            className="text-xs px-1.5 py-0.5 rounded hover:bg-editor-active text-gray-400 hover:text-white"
            title="新建分支"
          >
            ➕
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
              <div className="flex items-center gap-1">
                <button
                  onClick={handleStageAll}
                  className="flex-1 py-0.5 text-[11px] bg-editor-active/50 rounded hover:bg-editor-active text-editor-text"
                  title="暂存所有变更"
                >
                  + 全部暂存
                </button>
                <button
                  onClick={handlePush}
                  className="flex-1 py-0.5 text-[11px] bg-editor-active/50 rounded hover:bg-editor-active text-green-400"
                  title="推送到远程"
                >
                  ↑ 推送
                </button>
                <button
                  onClick={handlePull}
                  className="flex-1 py-0.5 text-[11px] bg-editor-active/50 rounded hover:bg-editor-active text-blue-400"
                  title="从远程拉取"
                >
                  ↓ 拉取
                </button>
              </div>

              {/* Branch quick switcher */}
              {branches.length > 1 && (
                <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                  {branches.slice(0, 6).map((br) => (
                    <button
                      key={br}
                      onClick={() => handleSwitchBranch(br)}
                      className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                        br === branch
                          ? 'bg-editor-accent/30 text-editor-accent'
                          : 'bg-editor-active/30 text-gray-400 hover:text-white'
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
              <div className="px-3 py-4 text-center text-xs text-gray-500">
                工作区干净 ✓
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
                  className="w-full text-xs bg-editor-bg border border-editor-border rounded px-2 py-1 text-editor-text resize-none font-mono placeholder-gray-600 focus:outline-none focus:border-editor-accent"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      handleCommit();
                    }
                  }}
                />
                <div className="flex justify-between items-center mt-1">
                  <span className="text-[10px] text-gray-600">⌘Enter 提交</span>
                  <button
                    onClick={handleCommit}
                    disabled={!commitMsg.trim()}
                    className="px-2 py-0.5 text-[11px] bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed"
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
                className={`px-1.5 py-0.5 rounded cursor-pointer ${!diffStaged ? 'bg-editor-accent/30 text-editor-accent' : 'text-gray-500 hover:text-white bg-editor-active/30'}`}
                onClick={() => diffFile && handleViewDiff(diffFile, false)}
              >
                工作区
              </span>
              <span
                className={`px-1.5 py-0.5 rounded cursor-pointer ${diffStaged ? 'bg-editor-accent/30 text-editor-accent' : 'text-gray-500 hover:text-white bg-editor-active/30'}`}
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
