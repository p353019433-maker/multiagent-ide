import React, { useEffect, useState, useCallback } from 'react';
import { useWorkspace } from '../../context/WorkspaceContext';

export default function GitHubPanel() {
  const { rootPath } = useWorkspace();
  const [token, setToken] = useState('');
  const [repoInfo, setRepoInfo] = useState<{ owner: string; repo: string } | null>(null);
  const [issues, setIssues] = useState<any[]>([]);
  const [prs, setPrs] = useState<any[]>([]);
  const [workflows, setWorkflows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<'issues' | 'prs' | 'actions'>('issues');
  const [error, setError] = useState('');

  // Try to get token from store
  useEffect(() => {
    window.api.store.decryptAndGet('github_token').then((t: string | null) => {
      if (t) setToken(t);
    });
  }, []);

  // Try to detect owner/repo from git remote
  const detectRepo = useCallback(async () => {
    if (!rootPath || !token) return;
    try {
      // Get remote origin URL
      const result = await window.api.terminal.runCommand(rootPath, 'git remote get-url origin', 5000);
      const url = result.stdout.trim();
      if (!url) return;
      const info = await window.api.github.parseRemote(url);
      if (info) {
        setRepoInfo(info);
      }
    } catch {
      // Not a git repo or no remote
    }
  }, [rootPath, token]);

  useEffect(() => {
    detectRepo();
  }, [detectRepo]);

  const refresh = useCallback(async () => {
    if (!token || !repoInfo) return;
    setLoading(true);
    setError('');
    try {
      if (view === 'issues') {
        const data = await window.api.github.listIssues(token, repoInfo.owner, repoInfo.repo, 'open');
        setIssues(data);
      } else if (view === 'prs') {
        const data = await window.api.github.listPRs(token, repoInfo.owner, repoInfo.repo, 'open');
        setPrs(data);
      } else if (view === 'actions') {
        const data = await window.api.github.listWorkflowRuns(token, repoInfo.owner, repoInfo.repo);
        setWorkflows(data);
      }
    } catch (e: any) {
      setError(e.message || '加载失败');
    }
    setLoading(false);
  }, [token, repoInfo, view]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleSaveToken = async () => {
    if (!token) return;
    await window.api.store.encryptAndStore('github_token', token);
    detectRepo();
  };

  if (!token) {
    return (
      <div className="h-full flex flex-col bg-editor-sidebar">
        <div className="px-3 py-2 border-b border-editor-border">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">GitHub</span>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center px-4">
          <p className="text-xs text-gray-500 mb-2">需要 GitHub Personal Access Token</p>
          <p className="text-[10px] text-gray-600 mb-3">
            在 GitHub Settings → Developer settings → Fine-grained tokens 创建
          </p>
          <input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="ghp_..."
            type="password"
            className="w-full text-xs bg-editor-bg border border-editor-border rounded px-2 py-1 text-editor-text font-mono mb-2"
          />
          <button
            onClick={handleSaveToken}
            className="text-xs px-3 py-1 bg-editor-accent text-white rounded hover:opacity-90"
          >
            保存 Token
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-editor-sidebar">
      <div className="flex items-center justify-between px-3 py-2 border-b border-editor-border">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">GitHub</span>
          {repoInfo && (
            <span className="text-[10px] text-editor-accent font-mono truncate max-w-[150px]">
              {repoInfo.owner}/{repoInfo.repo}
            </span>
          )}
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="text-xs px-1.5 py-0.5 rounded hover:bg-editor-active text-gray-400 hover:text-white"
        >
          🔄
        </button>
      </div>

      <div className="flex border-b border-editor-border">
        {(['issues', 'prs', 'actions'] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`flex-1 py-1.5 text-[11px] text-center ${
              view === v ? 'text-white border-b-2 border-editor-accent' : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {v === 'issues' ? 'Issue' : v === 'prs' ? 'PR' : 'CI'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto selectable">
        {error && (
          <div className="px-3 py-2 text-xs text-red-400">{error}</div>
        )}

        {!repoInfo && !error && (
          <div className="px-3 py-4 text-center text-xs text-gray-500">
            未检测到 GitHub 仓库（需要 git remote origin）
          </div>
        )}

        {view === 'issues' && issues.map((issue) => (
          <div
            key={issue.number}
            className="px-3 py-2 border-b border-editor-border/30 cursor-pointer hover:bg-editor-hover"
            onClick={() => window.open(issue.html_url, '_blank')}
          >
            <div className="text-xs text-editor-text font-mono truncate">
              #{issue.number} {issue.title}
            </div>
            <div className="flex items-center gap-1 mt-0.5">
              {issue.labels?.map((l: string) => (
                <span key={l} className="text-[9px] px-1 py-0.5 bg-editor-active rounded text-gray-400">
                  {l}
                </span>
              ))}
              <span className="text-[10px] text-gray-600 ml-auto">
                {new Date(issue.updated_at).toLocaleDateString('zh-CN')}
              </span>
            </div>
          </div>
        ))}

        {view === 'prs' && prs.map((pr) => (
          <div
            key={pr.number}
            className="px-3 py-2 border-b border-editor-border/30 cursor-pointer hover:bg-editor-hover"
            onClick={() => window.open(pr.html_url, '_blank')}
          >
            <div className="text-xs text-editor-text font-mono truncate">
              #{pr.number} {pr.title}
              {pr.draft && <span className="ml-1 text-[10px] text-gray-500">Draft</span>}
            </div>
            <div className="text-[10px] text-gray-600">
              {pr.head} → {pr.base} · {pr.user}
            </div>
          </div>
        ))}

        {view === 'actions' && workflows.map((run) => (
          <div
            key={run.id ?? run.html_url}
            className="px-3 py-2 border-b border-editor-border/30 cursor-pointer hover:bg-editor-hover"
            onClick={() => window.open(run.html_url, '_blank')}
          >
            <div className="flex items-center gap-2">
              <span className={
                run.conclusion === 'success' ? 'text-green-400' :
                run.conclusion === 'failure' ? 'text-red-400' :
                run.status === 'in_progress' ? 'text-yellow-400' :
                'text-gray-500'
              }>
                {run.conclusion === 'success' ? '✓' :
                 run.conclusion === 'failure' ? '✕' :
                 run.status === 'in_progress' ? '⟳' : '•'}
              </span>
              <span className="text-[11px] text-editor-text truncate font-mono">
                {run.name}
              </span>
            </div>
            <div className="text-[10px] text-gray-600 ml-4">
              {run.branch} · {new Date(run.created_at).toLocaleDateString('zh-CN')}
            </div>
          </div>
        ))}

        {view === 'issues' && issues.length === 0 && !loading && repoInfo && (
          <div className="px-3 py-4 text-center text-xs text-gray-500">暂无 open issues</div>
        )}
        {view === 'prs' && prs.length === 0 && !loading && repoInfo && (
          <div className="px-3 py-4 text-center text-xs text-gray-500">暂无 open PR</div>
        )}
        {view === 'actions' && workflows.length === 0 && !loading && repoInfo && (
          <div className="px-3 py-4 text-center text-xs text-gray-500">无 CI 记录</div>
        )}
      </div>
    </div>
  );
}