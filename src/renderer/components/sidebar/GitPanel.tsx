import React, { useEffect, useState, useCallback } from 'react';
import { useWorkspace } from '../../context/WorkspaceContext';

interface GitChange {
  path: string;
  status: string; // e.g. " M", "??", "AM"
}

export default function GitPanel() {
  const { rootPath } = useWorkspace();
  const [statusText, setStatusText] = useState('');
  const [changes, setChanges] = useState<GitChange[]>([]);
  const [diff, setDiff] = useState('');
  const [log, setLog] = useState('');
  const [loading, setLoading] = useState(false);
  const [commitMsg, setCommitMsg] = useState('');
  const [view, setView] = useState<'changes' | 'diff' | 'log'>('changes');

  const refresh = useCallback(async () => {
    if (!rootPath) return;
    setLoading(true);
    try {
      const status = await window.api.git.status(rootPath);
      setStatusText(status);
      const lines = status.split('\n');
      const cs: GitChange[] = [];
      for (const line of lines) {
        if (line.startsWith('##')) continue;
        const trimmed = line.trim();
        if (!trimmed) continue;
        cs.push({ status: line.slice(0, 2).trim(), path: trimmed.split(' ').pop() || trimmed });
      }
      setChanges(cs);
    } catch {
      setStatusText('获取状态失败（可能不是 git 仓库）');
    }
    setLoading(false);
  }, [rootPath]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleViewDiff = async (filePath?: string) => {
    if (!rootPath) return;
    const d = await window.api.git.diff(rootPath, false, filePath);
    setDiff(d);
    setView('diff');
  };

  const handleViewLog = async () => {
    if (!rootPath) return;
    const l = await window.api.git.log(rootPath, 20);
    setLog(l);
    setView('log');
  };

  return (
    <div className="h-full flex flex-col bg-editor-sidebar">
      <div className="flex items-center justify-between px-3 py-2 border-b border-editor-border">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
          Git
        </span>
        <button
          onClick={refresh}
          disabled={loading}
          className="text-xs px-1.5 py-0.5 rounded hover:bg-editor-active text-gray-400 hover:text-white"
          title="刷新"
        >
          🔄
        </button>
      </div>

      <div className="flex border-b border-editor-border">
        {(['changes', 'diff', 'log'] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`flex-1 py-1 text-[11px] text-center ${
              view === v ? 'text-white border-b-2 border-editor-accent' : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {v === 'changes' ? '变更' : v === 'diff' ? '差异' : '日志'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto selectable">
        {view === 'changes' && (
          <div>
            {changes.length === 0 && statusText && (
              <div className="px-3 py-4 text-center text-xs text-gray-500">
                {statusText.includes('不是') ? statusText : '工作区干净'}
              </div>
            )}
            {changes.length > 0 && (
              <div className="py-1">
                {changes.map((c, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 px-3 py-[3px] cursor-pointer hover:bg-editor-hover text-xs"
                    onClick={() => handleViewDiff(c.path)}
                  >
                    <span className={c.status.includes('M') || c.status.includes('A') ? 'text-green-400' : c.status.includes('D') ? 'text-red-400' : 'text-yellow-400'}>
                      {c.status.padEnd(2) || '  '}
                    </span>
                    <span className="text-editor-text truncate font-mono text-[11px]">
                      {c.path}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {view === 'diff' && (
          <pre className="text-[11px] font-mono text-editor-text p-3 whitespace-pre-wrap">
            {diff || '没有差异'}
          </pre>
        )}

        {view === 'log' && (
          <pre className="text-[11px] font-mono text-editor-text p-3 whitespace-pre-wrap">
            {log || '加载中...'}
          </pre>
        )}
      </div>
    </div>
  );
}
