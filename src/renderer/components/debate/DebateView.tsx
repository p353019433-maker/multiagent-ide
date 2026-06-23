import React, { useState } from 'react';
import { useTaskWorkspace } from '../../context/TaskContext';
import { useWorkspace } from '../../context/WorkspaceContext';
import { DebateStageCard } from './DebateStageCard';
import { ResultPanel } from './ResultPanel';

export function DebateView() {
  const ctx = useTaskWorkspace();
  const { rootPath } = useWorkspace();
  const [input, setInput] = useState('');

  const handleSend = async () => {
    if (!input.trim() || !rootPath) return;
    const req = input.trim();
    setInput('');
    await ctx.runDebateTask(req, rootPath);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const isRunning = ctx.currentDebate && !ctx.currentDebate.finishedAt;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* 顶部：任务输入 */}
      <div style={{ padding: 12, borderBottom: '1px solid #e5e7eb' }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="描述你要完成的事…（Enter 发送，Shift+Enter 换行）"
          disabled={!!isRunning}
          style={{ width: '100%', minHeight: 60, padding: 8, border: '1px solid #d1d5db', borderRadius: 4, resize: 'vertical' }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          {isRunning && (
            <button onClick={ctx.stopDebate} style={{ padding: '6px 16px', border: '1px solid #dc2626', color: '#dc2626', borderRadius: 4 }}>
              停止
            </button>
          )}
        </div>
      </div>

      {/* 主体：讨论过程 */}
      <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
        {ctx.currentDebate?.stages.map((stage, i) => (
          <DebateStageCard key={i} stage={stage} />
        ))}
        {ctx.currentDebate?.error && (
          <div style={{ color: '#dc2626', padding: 8 }}>{ctx.currentDebate.error}</div>
        )}
      </div>

      {/* 底部：结果验收 */}
      <ResultPanel
        files={[]}
        onAdopt={() => {}}
        onRollback={() => {}}
      />
    </div>
  );
}
