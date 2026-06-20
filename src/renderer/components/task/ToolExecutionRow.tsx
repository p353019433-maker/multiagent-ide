import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { TaskToolExecution } from '@shared/types';

interface Props {
  execution: TaskToolExecution;
}

const STATUS_NAMES: Record<string, string> = {
  pending: '等待中',
  running: '执行中',
  success: '成功',
  error: '失败',
  rejected: '已拒绝',
};

export default function ToolExecutionRow({ execution }: Props) {
  const [expanded, setExpanded] = useState(false);

  const statusMark = {
    pending: 'wait',
    running: 'run',
    success: 'ok',
    error: 'err',
    rejected: 'no',
  }[execution.status];

  const statusColor = {
    pending: 'text-muted-foreground',
    running: 'text-yellow-400',
    success: 'text-green-400',
    error: 'text-red-400',
    rejected: 'text-orange-400',
  }[execution.status];

  const argKeys = Object.keys(execution.arguments);

  return (
    <div className="border-b border-editor-border bg-editor-sidebar text-xs">
      <button
        className="grid w-full min-h-8 cursor-pointer grid-cols-[64px_minmax(0,1fr)_minmax(0,120px)_auto_auto] items-center gap-2 text-left transition-colors hover:bg-editor-hover"
        onClick={() => setExpanded(!expanded)}
      >
        <span className={`border-r border-editor-border/70 px-2 py-2 font-mono text-10 ${statusColor}`}>
          {statusMark}
        </span>
        <span className="min-w-0 truncate font-mono text-editor-accent">{execution.name}</span>
        <span className="hidden min-w-0 truncate text-11 text-muted-foreground sm:block">
          {argKeys.slice(0, 3).join(', ')}
          {argKeys.length > 3 && ` +${argKeys.length - 3}`}
        </span>
        <span className={`px-2 text-11 font-medium ${statusColor}`}>
          {STATUS_NAMES[execution.status] || execution.status}
        </span>
        <span className="pr-2 text-muted-foreground">
          {expanded ? <ChevronDown size={13} strokeWidth={1.8} /> : <ChevronRight size={13} strokeWidth={1.8} />}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-editor-border bg-editor-bg">
          <div>
            <div className="border-b border-editor-border px-3 py-1.5 font-mono text-10 uppercase tracking-wide text-muted-foreground">
              参数
            </div>
            <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap border-b border-editor-border bg-editor-bg px-4 py-3 font-mono text-11 leading-relaxed text-foreground">
              {JSON.stringify(execution.arguments, null, 2).slice(0, 800)}
            </pre>
          </div>
          {execution.result && (
            <div>
              <div className="border-b border-editor-border px-3 py-1.5 font-mono text-10 uppercase tracking-wide text-muted-foreground">
                返回值
              </div>
              <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap border-b border-editor-border bg-editor-bg px-4 py-3 font-mono text-11 leading-relaxed text-foreground">
                {execution.result.slice(0, 1200)}
              </pre>
            </div>
          )}
          {execution.error && (
            <div>
              <div className="border-b border-editor-border px-3 py-1.5 font-mono text-10 uppercase tracking-wide text-red-400">
                错误信息
              </div>
              <div className="border-b border-editor-border bg-red-950/20 px-4 py-3 text-11 leading-relaxed text-red-400">
                {execution.error}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
