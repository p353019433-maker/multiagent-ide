import React, { useState } from 'react';
import { useAI } from '../../context/AIContext';
import { useWorkspace } from '../../context/WorkspaceContext';
import type { OrchestrationSession } from '@shared/types';

export default function MultiAgentPanel() {
  const { orchestrationSessions, orchestrate } = useAI();
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
    // TODO: Show merge dialog, call git worktree merge
    console.log('Merge session:', session.id);
  };

  const handleCleanupSession = async (session: OrchestrationSession) => {
    // TODO: Call git worktree remove --force for each task's worktree
    console.log('Cleanup session:', session.id);
  };

  return (
    <div className="flex flex-col h-full p-4 overflow-y-auto">
      <h2 className="text-lg font-semibold mb-4 text-white">🎯 多 Agent 并行</h2>

      {/* Orchestration Form */}
      <div className="mb-6 p-4 bg-editor-sidebar rounded-lg border border-editor-border">
        <label className="block text-sm text-gray-400 mb-2">大目标</label>
        <textarea
          className="w-full bg-editor-bg border border-editor-border rounded px-3 py-2 text-white text-sm mb-4 focus:outline-none focus:border-editor-accent"
          rows={3}
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="例如：做一个用户系统，包含注册、登录、JWT 认证"
        />

        <label className="block text-sm text-gray-400 mb-2">子任务（每个任务一个 agent 并行执行）</label>
        {subTasks.map((task, idx) => (
          <div key={idx} className="flex gap-2 mb-2">
            <input
              className="flex-1 bg-editor-bg border border-editor-border rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-editor-accent"
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
          className="w-full bg-editor-accent hover:bg-opacity-80 text-white font-medium py-2 rounded transition"
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
                className="p-3 bg-editor-bg rounded-lg border border-editor-border"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-white truncate flex-1">
                    {session.goal}
                  </span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded ${
                      session.status === 'completed'
                        ? 'bg-green-500/20 text-green-400'
                        : session.status === 'failed'
                        ? 'bg-red-500/20 text-red-400'
                        : 'bg-blue-500/20 text-blue-400'
                    }`}
                  >
                    {session.status === 'completed' ? '✅ 完成' : session.status === 'failed' ? '❌ 失败' : '🔄 运行中'}
                  </span>
                </div>

                <div className="space-y-1 mb-3">
                  {session.tasks.map((task, idx) => (
                    <div key={task.id} className="text-xs flex items-center gap-2">
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          task.status === 'completed'
                            ? 'bg-green-400'
                            : task.status === 'failed'
                            ? 'bg-red-400'
                            : 'bg-blue-400'
                        }`}
                      />
                      <span className="text-gray-300 truncate flex-1">{task.description}</span>
                      {task.error && <span className="text-red-400 text-[10px]">{task.error}</span>}
                    </div>
                  ))}
                </div>

                {session.status === 'completed' && (
                  <div className="flex gap-2">
                    <button
                      className="flex-1 text-xs bg-green-600/20 text-green-400 hover:bg-green-600/30 py-1.5 rounded transition"
                      onClick={() => handleMergeSession(session)}
                    >
                      ⥄ 合并
                    </button>
                    <button
                      className="flex-1 text-xs bg-red-600/20 text-red-400 hover:bg-red-600/30 py-1.5 rounded transition"
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