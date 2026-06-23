import React from 'react';
import type { DebateStageState } from '@shared/types';

const STAGE_LABELS: Record<string, string> = {
  analyst: '解析员',
  proposer: '方案者',
  critic: '异议者',
  synthesizer: '综合者',
  executor: '执行者',
};

const STATUS_COLORS: Record<string, string> = {
  pending: '#888',
  running: '#2563eb',
  done: '#16a34a',
  error: '#dc2626',
};

export function DebateStageCard({ stage }: { stage: DebateStageState }) {
  const label = STAGE_LABELS[stage.name] ?? stage.name;
  const color = STATUS_COLORS[stage.status] ?? '#888';
  const isRevision = stage.name === 'proposer' && stage.output?.includes('修订');
  return (
    <div style={{ borderLeft: `3px solid ${color}`, padding: '8px 12px', margin: '4px 0', background: '#f9fafb' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 600 }}>{label}{isRevision ? '（修订）' : ''}</span>
        <span style={{ color, fontSize: 12 }}>{stage.status}</span>
      </div>
      {stage.output && <pre style={{ fontSize: 12, marginTop: 4, whiteSpace: 'pre-wrap' }}>{stage.output}</pre>}
    </div>
  );
}
