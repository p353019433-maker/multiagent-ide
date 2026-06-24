import React, { useState } from 'react';
import { useTaskWorkspace } from '../../context/TaskContext';
import { useWorkspace } from '../../context/WorkspaceContext';
import { DebateStageCard } from './DebateStageCard';
import { ResultPanel } from './ResultPanel';
import { Settings } from 'lucide-react';

export function DebateView({ onOpenSettings }: { onOpenSettings?: () => void }) {
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
    <div className="flex flex-col h-full">
      <div className="flex-shrink-0 border-b border-border px-4 py-3">
        <div className="flex items-start gap-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="描述你要完成的事…（Enter 发送，Shift+Enter 换行）"
            disabled={!!isRunning}
            className="min-h-[60px] flex-1 resize-vertical rounded-lg border border-editor-border bg-editor-bg px-3 py-2 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-editor-accent"
          />
          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              title="设置"
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-editor-border text-muted-foreground hover:bg-editor-hover hover:text-foreground"
            >
              <Settings size={14} strokeWidth={1.7} />
            </button>
          )}
        </div>
        <div className="mt-2 flex justify-end gap-2">
          {isRunning && (
            <button
              onClick={ctx.stopDebate}
              className="h-7 px-3 text-xs border border-red-400/50 text-red-400 rounded-lg hover:bg-red-400/10"
            >
              停止
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-4 py-3">
        {ctx.currentDebate?.stages.map((stage, i) => (
          <DebateStageCard key={i} stage={stage} />
        ))}
        {ctx.currentDebate?.error && (
          <div className="rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-400">
            {ctx.currentDebate.error}
          </div>
        )}
      </div>

      <ResultPanel
        files={[]}
        onAdopt={() => {}}
        onRollback={() => {}}
      />
    </div>
  );
}
