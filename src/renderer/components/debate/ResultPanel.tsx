import React from 'react';
import { CircleCheck, RotateCcw } from 'lucide-react';

interface ResultPanelProps {
  files: string[];
  diff?: string;
  verified?: boolean;
  onAdopt: () => void;
  onRollback: () => void;
}

export function ResultPanel({ files, diff, verified, onAdopt, onRollback }: ResultPanelProps) {
  if (!files.length) return null;
  return (
    <div className="flex-shrink-0 border-t border-border px-4 py-3">
      <div className="mb-2 text-xs font-semibold text-foreground">执行结果</div>
      <div className="mb-2 text-11 text-muted-foreground">
        改动文件（{files.length}）：{files.join('、')}
      </div>
      {verified !== undefined && (
        <div className={`mb-2 text-11 ${verified ? 'text-status-green' : 'text-red-400'}`}>
          验证：{verified ? '通过' : '未通过'}
        </div>
      )}
      {diff && (
        <pre className="mb-2 max-h-[200px] overflow-auto whitespace-pre-wrap break-all rounded-lg bg-[#1e293b] px-3 py-2 font-mono text-11 leading-relaxed text-[#e2e8f0]">
          {diff}
        </pre>
      )}
      <div className="flex gap-2">
        <button onClick={onAdopt} className="flex h-7 items-center gap-1.5 rounded-lg bg-status-green px-3 text-xs font-medium text-primary-foreground hover:opacity-90">
          <CircleCheck size={13} strokeWidth={2} />
          采纳
        </button>
        <button onClick={onRollback} className="flex h-7 items-center gap-1.5 rounded-lg border border-red-400/50 px-3 text-xs text-red-400 hover:bg-red-400/10">
          <RotateCcw size={13} strokeWidth={2} />
          回滚
        </button>
      </div>
    </div>
  );
}
