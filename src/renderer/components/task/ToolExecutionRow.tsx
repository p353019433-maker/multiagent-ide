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
    pending: 'text-gray-400',
    running: 'text-yellow-400',
    success: 'text-green-400',
    error: 'text-red-400',
    rejected: 'text-orange-400',
  }[execution.status];

  const argKeys = Object.keys(execution.arguments);

  return (
    <div className="border-b border-editor-border bg-editor-sidebar text-xs">
      <div
        className="grid min-h-7 cursor-pointer grid-cols-[64px_minmax(0,1fr)_minmax(0,120px)_auto_auto] items-center gap-2 hover:bg-editor-hover"
        onClick={() => setExpanded(!expanded)}
      >
        <span className={`border-r border-editor-border/70 px-2 font-mono text-[10px] ${statusColor}`}>
          {statusMark}
        </span>
        <span className="min-w-0 truncate font-mono text-editor-accent">{execution.name}</span>
        <span className="hidden min-w-0 truncate text-[11px] text-gray-600 sm:block">
          {argKeys.join(', ')}
        </span>
        <span className={`px-2 text-[11px] ${statusColor}`}>
          {STATUS_NAMES[execution.status] || execution.status}
        </span>
        <span className="pr-2 text-gray-600">
          {expanded ? <ChevronDown size={13} strokeWidth={1.8} /> : <ChevronRight size={13} strokeWidth={1.8} />}
        </span>
      </div>

      {expanded && (
        <div className="border-t border-editor-border bg-editor-bg">
          <div>
            <div className="border-b border-editor-border px-3 py-1 font-mono text-[10px] text-gray-600">
              PARAMS
            </div>
            <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap border-b border-editor-border bg-editor-bg px-3 py-2 pl-[76px] font-mono text-[11px] text-gray-300">
              {JSON.stringify(execution.arguments, null, 2).slice(0, 500)}
            </pre>
          </div>
          {execution.result && (
            <div>
              <div className="border-b border-editor-border px-3 py-1 font-mono text-[10px] text-gray-600">
                RESULT
              </div>
              <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap border-b border-editor-border bg-editor-bg px-3 py-2 pl-[76px] font-mono text-[11px] text-gray-300">
                {execution.result.slice(0, 1000)}
              </pre>
            </div>
          )}
          {execution.error && (
            <div>
              <div className="border-b border-editor-border px-3 py-1 font-mono text-[10px] text-red-500">
                ERROR
              </div>
              <div className="border-b border-editor-border px-3 py-2 pl-[76px] text-red-400">
                {execution.error}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
