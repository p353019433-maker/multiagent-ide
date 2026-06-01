import React, { useState } from 'react';
import { useAI } from '../../context/AIContext';
import { useWorkspace } from '../../context/WorkspaceContext';
import type { OrchestrationSession } from '@shared/types';

export default function MultiAgentPanel() {
  const { orchestrationSessions, orchestrate, updateOrchestrationSession } = useAI();
  const { rootPath } = useWorkspace();
  const [goal, setGoal] = useState('');
  const [subTasks, setSubTasks] = useState<string[]>(['', '', '']);
  const [isOrchestrating, setIsOrchestrating] = useState(false);

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
    if (!goal.trim() || subTasks.filter((t) => t.trim()).length === 0) return;

    setIsOrchestrating(true);
    try {
      await orchestrate(goal, subTasks.filter((t) => t.trim()));
      setGoal('');
      setSubTasks(['', '', '']);
    } catch (err) {
      console.error('Orchestration failed:', err);
    } finally {
      setIsOrchestrating(false);
    }
  };

  const handleMergeSession = async (session: OrchestrationSession) => {
    if (!rootPath) return;
    try {
      for (let i = 0; i < session.tasks.length; i++) {
        const task = session.tasks[i];
        if (task.status === 'completed') {
          const branch = `agent-${session.id.slice(0, 6)}-task-${i + 1}`;
          const wtPath = `${rootPath.endsWith('/') ? rootPath.slice(0, -1) : rootPath}_wt/${branch}`;
          await window.api.git.worktreeMerge(rootPath, branch, 'squash');
          await window.api.git.worktreeRemove(rootPath, wtPath, branch).catch(() => {});
          task.status = 'merged';
        }
      }
      updateOrchestrationSession(session.id, { tasks: [...session.tasks], status: 'completed' });
    } catch (err: any) {
      console.error('Merge failed', err);
      window.alert(`合并失败：${err.message}`);
    }
  };

  const handleCleanupSession = async (session: OrchestrationSession) => {
    if (!rootPath) return;
    try {
      for (let i = 0; i < session.tasks.length; i++) {
        const task = session.tasks[i];
        if (task.status !== 'pending' && task.status !== 'running') {
          const branch = `agent-${session.id.slice(0, 6)}-task-${i + 1}`;
          const wtPath = `${rootPath.endsWith('/') ? rootPath.slice(0, -1) : rootPath}_wt/${branch}`;
          await window.api.git.worktreeRemove(rootPath, wtPath, branch).catch(() => {});
        }
      }
      await window.api.git.worktreePrune(rootPath).catch(() => {});
      updateOrchestrationSession(session.id, { status: 'failed' }); // Mark failed so it hides buttons if cleaned without merge
    } catch (err: any) {
      console.error('Cleanup failed', err);
    }
  };

  return (
    <div className="flex flex-col h-full p-4 overflow-y-auto">
      <h2 className="text-lg font-semibold mb-4 text-white">🎯 多 Agent 并行</h2>

      {/* Orchestration Form */}
      <div className="mb-6 p-4 bg-editor-sidebar rounded-xl border border-editor-border">
        <label className="block text-sm text-gray-400 mb-2">大目标</label>
        <textarea
          className="w-full bg-editor-bg border border-editor-border rounded-xl px-3 py-2 text-white text-sm mb-4 focus:outline-none focus:border-editor-accent"
          rows={3}
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="例如：做一个用户系统，包含注册、登录、JWT 认证"
        />

        <label className="block text-sm text-gray-400 mb-2">子任务（每个任务一个 agent 并行执行）</label>
        {subTasks.map((task, idx) => (
          <div key={idx} className="flex gap-2 mb-2">
            <input
              className="flex-1 bg-editor-bg border border-editor-border rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-editor-accent"
              value={task}
              onChange={(e) => handleSubTaskChange(idx, e.target.value)}
              placeholder={`子任务 ${idx + 1}`}
            />
            {subTasks.length > 1 && (
              <button
                className="px-2 text-red-400 hover:text-red-300"
                onClick={() => handleRemoveSubTask(idx)}
              >
                ✕
              </button>
            )}
          </div>
        ))}

        <button
          className="text-xs text-editor-accent hover:underline mb-4"
          onClick={handleAddSubTask}
        >
          + 添加子任务
        </button>

        <button
          className="w-full bg-editor-accent hover:bg-opacity-80 text-white font-medium py-2 rounded-xl transition"
          onClick={handleOrchestrate}
          disabled={isOrchestrating || !goal.trim() || subTasks.filter((t) => t.trim()).length === 0}
        >
          {isOrchestrating ? '启动中...' : '🚀 启动并行 Agent'}
        </button>
      </div>

      {/* Active Sessions */}
      <div className="flex-1">
        <h3 className="text-sm font-medium text-gray-400 mb-3">进行中的会话</h3>
        {orchestrationSessions.length === 0 ? (
          <p className="text-xs text-gray-500">暂无并行会话</p>
        ) : (
          <div className="space-y-3">
            {orchestrationSessions.map((session) => (
              <div
                key={session.id}
                className={`p-3 border rounded-xl flex flex-col gap-2 transition-all glass-panel ${
                session.status === 'running' 
                  ? 'bg-editor-active/50 border-editor-accent/50 animate-glow-pulse' 
                  : session.status === 'completed'
                  ? 'bg-green-900/10 border-green-700/30'
                  : session.status === 'failed'
                  ? 'bg-red-900/10 border-red-700/30'
                  : 'bg-editor-hover/50 border-editor-border/50'
              }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-white truncate flex-1">
                    {session.goal}
                  </span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-xl ${
                      session.status === 'completed'
                        ? 'bg-green-500/20 text-green-400'
                        : session.status === 'failed'
                        ? 'bg-red-500/20 text-red-400'
                        : 'bg-blue-500/20 text-blue-400 animate-pulse'
                    }`}
                  >
                    {session.status === 'completed' ? '✅ 完成' : session.status === 'failed' ? '❌ 失败' : '🔄 运行中'}
                  </span>
                </div>

                <div className="space-y-2 mb-3">
                  {session.tasks.map((task, idx) => (
                    <div key={task.id} className="text-xs">
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            task.status === 'completed' || task.status === 'merged'
                              ? 'bg-green-400'
                              : task.status === 'failed'
                              ? 'bg-red-400'
                              : task.status === 'running'
                              ? 'bg-blue-400 animate-pulse'
                              : 'bg-gray-500'
                          }`}
                        />
                        <span className="text-gray-300 truncate flex-1">{task.description}</span>
                        <span className="text-gray-500 text-[10px]">
                          {task.status === 'merged' ? '已合并' : task.status}
                        </span>
                      </div>
                      {task.error && <div className="text-red-400 text-[10px] ml-3 mt-1">{task.error}</div>}
                      {task.editedFiles && task.editedFiles.length > 0 && (
                        <div className="ml-3 mt-1 text-[10px] text-gray-400">
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
                      className="flex-1 text-xs bg-green-600/20 text-green-400 hover:bg-green-600/30 py-1.5 rounded-xl transition"
                      onClick={() => handleMergeSession(session)}
                    >
                      ⥄ 合并
                    </button>
                    <button
                      className="flex-1 text-xs bg-red-600/20 text-red-400 hover:bg-red-600/30 py-1.5 rounded-xl transition"
                      onClick={() => handleCleanupSession(session)}
                    >
                      🗑 清理
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