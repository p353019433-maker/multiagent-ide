import React, { useState } from 'react';
import { useTaskWorkspace } from '../../context/TaskContext';
import { useWorkspace } from '../../context/WorkspaceContext';
import type { OrchestrationSession } from '@shared/types';
import { GitMerge, Play, Plus, Trash2, X } from 'lucide-react';

const ICON_BUTTON_CLASS =
  'inline-flex h-6 items-center justify-center gap-1 px-2 text-11 text-muted-foreground hover:bg-editor-active hover:text-foreground disabled:opacity-40';

const TASK_STATUS_LABEL: Record<string, string> = {
  pending: '等待中',
  running: '运行中',
  completed: '完成',
  failed: '失败',
  merged: '已合并',
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function removeWorktreeOrThrow(rootPath: string, wtPath: string, branch: string) {
  const result = await window.api.git.worktreeRemove(rootPath, wtPath, branch);
  if (!result.success) {
    throw new Error(result.message || `清理 ${branch} 失败`);
  }
}

export default function TaskRunsPanel() {
  const { conversations, orchestrationSessions, orchestrate, updateOrchestrationSession } = useTaskWorkspace();
  const { rootPath } = useWorkspace();
  const [goal, setGoal] = useState('');
  const [subTasks, setSubTasks] = useState<string[]>(['', '', '']);
  const [isOrchestrating, setIsOrchestrating] = useState(false);
  const [panelNotice, setPanelNotice] = useState<{
    tone: 'success' | 'error';
    text: string;
  } | null>(null);
  const runningSessionCount = orchestrationSessions.filter((session) => session.status === 'running').length;

  const handleAddSubTask = () => {
    setSubTasks([...subTasks, '']);
  };

  const handleRemoveSubTask = (idx: number) => {
    setSubTasks(subTasks.filter((_, i) => i !== idx));
  };

  const handleSubTaskChange = (idx: number, value: string) => {
    const newTasks = [...subTasks];
    newTasks[idx] = value;
    setSubTasks(newTasks);
  };

  const handleOrchestrate = async () => {
    const trimmedSubTasks = subTasks.map((t) => t.trim()).filter(Boolean);
    if (!goal.trim()) return;

    setPanelNotice(null);
    setIsOrchestrating(true);
    try {
      await orchestrate(goal, trimmedSubTasks.length ? trimmedSubTasks : undefined);
      setGoal('');
      setSubTasks(['', '', '']);
    } catch (err) {
      console.error('Orchestration failed:', err);
      const message = err instanceof Error ? err.message : String(err);
      setPanelNotice({ tone: 'error', text: `启动失败：${message}` });
    } finally {
      setIsOrchestrating(false);
    }
  };

  const handleMergeSession = async (session: OrchestrationSession) => {
    if (!rootPath) return;
    setPanelNotice(null);
    try {
      const cleanupErrors: string[] = [];
      for (let i = 0; i < session.tasks.length; i++) {
        const task = session.tasks[i];
        if (task.status === 'completed') {
          const conv = conversations.find((c) => c.id === task.conversationId);
          const branch = conv?.worktree?.branch || `task-${session.id.slice(0, 6)}-${i + 1}`;
          const wtPath =
            conv?.worktree?.path || `${rootPath.endsWith('/') ? rootPath.slice(0, -1) : rootPath}_wt/${branch}`;
          const mergeResult = await window.api.git.worktreeMerge(rootPath, branch, 'squash');
          if (!mergeResult.success) {
            throw new Error(mergeResult.message || `合并 ${branch} 失败`);
          }
          task.status = 'merged';
          try {
            await removeWorktreeOrThrow(rootPath, wtPath, branch);
          } catch (error) {
            cleanupErrors.push(`${branch}: ${getErrorMessage(error)}`);
          }
        }
      }
      updateOrchestrationSession(session.id, { tasks: [...session.tasks], status: 'completed' });
      if (cleanupErrors.length) {
        setPanelNotice({
          tone: 'error',
          text: `合并已完成，但清理失败：${cleanupErrors.join('；')}`,
        });
      } else {
        setPanelNotice({ tone: 'success', text: '并行任务已合并为本地改动' });
      }
    } catch (err: unknown) {
      console.error('Merge failed', err);
      const message = getErrorMessage(err);
      setPanelNotice({ tone: 'error', text: `合并失败：${message}` });
    }
  };

  const handleCleanupSession = async (session: OrchestrationSession) => {
    if (!rootPath) return;
    setPanelNotice(null);
    try {
      const cleanupErrors: string[] = [];
      for (let i = 0; i < session.tasks.length; i++) {
        const task = session.tasks[i];
        if (task.status !== 'pending' && task.status !== 'running') {
          const conv = conversations.find((c) => c.id === task.conversationId);
          const branch = conv?.worktree?.branch || `task-${session.id.slice(0, 6)}-${i + 1}`;
          const wtPath =
            conv?.worktree?.path || `${rootPath.endsWith('/') ? rootPath.slice(0, -1) : rootPath}_wt/${branch}`;
          try {
            await removeWorktreeOrThrow(rootPath, wtPath, branch);
          } catch (error) {
            cleanupErrors.push(`${branch}: ${getErrorMessage(error)}`);
          }
        }
      }
      try {
        await window.api.git.worktreePrune(rootPath);
      } catch (error) {
        cleanupErrors.push(`prune: ${getErrorMessage(error)}`);
      }
      if (cleanupErrors.length) {
        throw new Error(cleanupErrors.join('；'));
      }
      updateOrchestrationSession(session.id, { status: 'failed' }); // Mark failed so it hides buttons if cleaned without merge
      setPanelNotice({ tone: 'success', text: '并行任务 worktree 已清理' });
    } catch (err: unknown) {
      console.error('Cleanup failed', err);
      const message = getErrorMessage(err);
      setPanelNotice({ tone: 'error', text: `清理失败：${message}` });
    }
  };

  return (
    <div className="flex h-full flex-col bg-editor-sidebar">
      <div className="border-b border-editor-border">
        <div className="flex min-h-8 items-center justify-between gap-2 px-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-10 font-semibold uppercase tracking-wide text-muted-foreground">
              任务运行
            </span>
            <span className="font-mono text-10 text-muted-foreground">
              {orchestrationSessions.length} RUNS
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              className={ICON_BUTTON_CLASS}
              onClick={handleAddSubTask}
              title="添加子任务"
              aria-label="添加子任务"
            >
              <Plus size={13} strokeWidth={1.8} />
            </button>
            <button
              className="inline-flex h-6 items-center justify-center gap-1 bg-editor-accent px-2 text-11 text-primary-foreground hover:opacity-90 disabled:opacity-40"
              onClick={handleOrchestrate}
              disabled={isOrchestrating || !goal.trim()}
              title="运行并行任务"
              aria-label="运行并行任务"
            >
              <Play size={13} strokeWidth={1.8} />
              {isOrchestrating ? '启动中' : '运行'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-[52px_minmax(0,1fr)] border-t border-editor-border">
          <label className="flex h-8 items-center border-r border-editor-border px-3 text-10 font-semibold uppercase tracking-wide text-muted-foreground">
            目标
          </label>
          <input
            className="h-8 min-w-0 bg-editor-bg px-2 text-xs text-editor-text outline-none placeholder:text-muted-foreground focus:bg-editor-active"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="任务目标"
          />
        </div>

        <div className="border-t border-editor-border">
          {subTasks.map((task, idx) => (
            <div
              key={idx}
              className="grid min-h-8 grid-cols-[28px_minmax(0,1fr)_28px] items-center border-b border-editor-border last:border-b-0"
            >
              <span className="border-r border-editor-border px-2 font-mono text-10 text-muted-foreground">
                {idx + 1}
              </span>
              <input
                className="h-8 min-w-0 bg-transparent px-2 text-xs text-editor-text outline-none placeholder:text-muted-foreground focus:bg-editor-bg"
                value={task}
                onChange={(e) => handleSubTaskChange(idx, e.target.value)}
                placeholder="子任务"
              />
              {subTasks.length > 1 ? (
                <button
                  className="flex h-8 w-7 flex-shrink-0 items-center justify-center text-muted-foreground hover:bg-editor-active hover:text-red-400"
                  onClick={() => handleRemoveSubTask(idx)}
                  title="删除子任务"
                  aria-label={`删除子任务 ${idx + 1}`}
                >
                  <X size={14} strokeWidth={1.8} />
                </button>
              ) : (
                <span />
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex min-h-8 items-center justify-between border-b border-editor-border px-3">
          <span className="text-10 font-semibold uppercase tracking-wide text-muted-foreground">
            运行记录
          </span>
          <span className="font-mono text-10 text-muted-foreground">
            {runningSessionCount} ACTIVE
          </span>
        </div>
        {panelNotice && (
          <div
            className={`border-b px-3 py-1.5 text-xs ${
              panelNotice.tone === 'success'
                ? 'border-emerald-900/70 text-emerald-300'
                : 'border-red-900/80 text-red-300'
            }`}
          >
            {panelNotice.text}
          </div>
        )}
        {orchestrationSessions.length === 0 ? (
          <div className="border-b border-editor-border px-3 py-2 text-xs text-muted-foreground">
            无运行记录
          </div>
        ) : (
          <div>
            {orchestrationSessions.map((session) => (
              <div
                key={session.id}
                className="border-b border-editor-border bg-editor-sidebar px-3 py-2"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                    {session.goal}
                  </span>
                  <span
                    className={`text-10 uppercase tracking-wide ${
                      session.status === 'completed'
                        ? 'text-green-400'
                        : session.status === 'failed'
                        ? 'text-red-400'
                        : 'text-blue-400'
                    }`}
                  >
                    {TASK_STATUS_LABEL[session.status] || session.status}
                  </span>
                </div>

                <div className="mb-2 space-y-1">
                  {session.tasks.map((task, idx) => (
                    <div key={task.id} className="text-xs">
                      <div className="flex items-center gap-2">
                        <span
                          className={`h-1.5 w-1.5 flex-shrink-0 ${
                            task.status === 'completed' || task.status === 'merged'
                              ? 'bg-green-400'
                              : task.status === 'failed'
                              ? 'bg-red-400'
                              : task.status === 'running'
                              ? 'bg-blue-400 animate-pulse'
                              : 'bg-muted-foreground'
                          }`}
                        />
                        <span className="min-w-0 flex-1 truncate text-foreground">
                          {idx + 1}. {task.description}
                        </span>
                        <span className="text-10 text-muted-foreground">
                          {TASK_STATUS_LABEL[task.status] || task.status}
                        </span>
                      </div>
                      {task.error && <div className="text-red-400 text-10 ml-3 mt-1">{task.error}</div>}
                      {task.editedFiles && task.editedFiles.length > 0 && (
                        <div className="ml-3 mt-1 text-10 text-muted-foreground">
                          修改了 {task.editedFiles.length} 个文件：
                          <div className="truncate opacity-70">
                            {task.editedFiles.map(f => f.split(/[/\\]/).pop()).join(', ')}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {session.status === 'completed' && (
                  <div className="flex gap-2">
                    <button
                      className={ICON_BUTTON_CLASS}
                      onClick={() => handleMergeSession(session)}
                    >
                      <GitMerge size={13} strokeWidth={1.8} />
                      合并
                    </button>
                    <button
                      className={ICON_BUTTON_CLASS}
                      onClick={() => handleCleanupSession(session)}
                    >
                      <Trash2 size={13} strokeWidth={1.8} />
                      清理
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
