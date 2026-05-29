import React, { useState } from 'react';
import type { AgentToolExecution } from '@shared/types';

interface Props {
  execution: AgentToolExecution;
}

export default function AgentToolView({ execution }: Props) {
  const [expanded, setExpanded] = useState(false);

  const statusIcon = {
    pending: '⏳',
    running: '⚡',
    success: '✅',
    error: '❌',
    rejected: '🚫',
  }[execution.status];

  const statusColor = {
    pending: 'text-gray-400',
    running: 'text-yellow-400',
    success: 'text-green-400',
    error: 'text-red-400',
    rejected: 'text-orange-400',
  }[execution.status];

  return (
    <div className="bg-black/20 rounded px-2 py-1.5 text-xs border border-editor-border fade-in">
      <div
        className="flex items-center gap-2 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <span>{statusIcon}</span>
        <span className="font-mono text-editor-accent">{execution.name}</span>
        <span className={`ml-auto ${statusColor}`}>
          {execution.status}
        </span>
        <span className="text-gray-600">{expanded ? '▾' : '▸'}</span>
      </div>

      {expanded && (
        <div className="mt-2 space-y-1">
          <div>
            <span className="text-gray-500">Args: </span>
            <code className="text-gray-300 text-[11px]">
              {JSON.stringify(execution.arguments, null, 2).slice(0, 500)}
            </code>
          </div>
          {execution.result && (
            <div>
              <span className="text-gray-500">Result: </span>
              <pre className="text-gray-300 text-[11px] whitespace-pre-wrap max-h-32 overflow-y-auto">
                {execution.result.slice(0, 1000)}
              </pre>
            </div>
          )}
          {execution.error && (
            <div className="text-red-400">
              Error: {execution.error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
