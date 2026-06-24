import React from 'react';
import type { DebateStageState } from '@shared/types';
import { Loader2, CheckCircle2, Circle, XCircle } from 'lucide-react';

const STAGE_LABELS: Record<string, string> = {
  analyst: '解析员',
  proposer: '方案者',
  critic: '异议者',
  synthesizer: '综合者',
  executor: '执行者',
};

const STATUS_ICON = {
  pending: Circle,
  running: Loader2,
  done: CheckCircle2,
  error: XCircle,
} as const;

const STATUS_CLASS = {
  pending: 'text-foreground/30',
  running: 'text-blue-500',
  done: 'text-status-green',
  error: 'text-red-400',
} as const;

const STATUS_BORDER = {
  pending: 'border-l-foreground/20',
  running: 'border-l-blue-500',
  done: 'border-l-status-green',
  error: 'border-l-red-400',
} as const;

export function DebateStageCard({ stage }: { stage: DebateStageState }) {
  const label = STAGE_LABELS[stage.name] ?? stage.name;
  const Icon = STATUS_ICON[stage.status] ?? Circle;
  const statusClass = STATUS_CLASS[stage.status] ?? 'text-foreground/30';
  const borderClass = STATUS_BORDER[stage.status] ?? 'border-l-foreground/20';
  const isRevision = stage.name === 'proposer' && stage.output?.includes('修订');

  return (
    <div className={`border-l-[3px] pl-3 py-2 pr-2 rounded-r-lg ${borderClass} bg-editor-sidebar/40`}>
      <div className="flex items-center gap-2">
        <Icon size={13} strokeWidth={2} className={`flex-shrink-0 ${stage.status === 'running' ? 'animate-spin' : ''} ${statusClass}`} />
        <span className="text-xs font-medium text-foreground">
          {label}{isRevision ? '（修订）' : ''}
        </span>
        <span className={`text-10 capitalize ${statusClass}`}>{stage.status}</span>
      </div>
      {stage.output && (
        <pre className="mt-1.5 whitespace-pre-wrap break-all text-11 text-muted-foreground leading-relaxed font-mono">
          {stage.output}
        </pre>
      )}
    </div>
  );
}
