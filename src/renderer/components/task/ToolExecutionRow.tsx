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

  const statusHex =
    {
      pending: '#c08a14',
      running: '#c08a14',
      success: '#3f8a2e',
      error: '#c1374a',
      rejected: '#9a4a00',
    }[execution.status] || '#c08a14';

  const argKeys = Object.keys(execution.arguments);

  return (
    <div className="border-b border-border/50 bg-background text-xs">
      <button
        className="grid min-h-[34px] w-full cursor-pointer grid-cols-[46px_minmax(0,1fr)_auto] items-center gap-2.5 px-1 text-left transition-colors hover:bg-foreground/[0.03]"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="font-mono text-10 font-semibold" style={{ color: statusHex }}>
          {statusMark}
        </span>
        <span className="flex min-w-0 items-center gap-2">
          <span className="flex-none font-mono text-xs text-tool">{execution.name}</span>
          <span className="min-w-0 truncate text-11 text-foreground/45">
            {argKeys.slice(0, 3).join(', ')}
            {argKeys.length > 3 && ` +${argKeys.length - 3}`}
          </span>
        </span>
        <span className="flex items-center gap-1 pr-0.5 text-foreground/35">
          <span className="font-mono text-10" style={{ color: statusHex }}>
            {STATUS_NAMES[execution.status] || execution.status}
          </span>
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
