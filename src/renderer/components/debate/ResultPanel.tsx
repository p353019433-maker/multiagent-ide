import React from 'react';

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
    <div style={{ borderTop: '1px solid #e5e7eb', padding: 12 }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>执行结果</div>
      <div style={{ fontSize: 13, marginBottom: 8 }}>
        改动文件（{files.length}）：{files.join('、')}
      </div>
      {verified !== undefined && (
        <div style={{ fontSize: 12, color: verified ? '#16a34a' : '#dc2626', marginBottom: 8 }}>
          验证：{verified ? '通过' : '未通过'}
        </div>
      )}
      {diff && (
        <pre style={{ fontSize: 11, background: '#1e293b', color: '#e2e8f0', padding: 8, maxHeight: 200, overflow: 'auto' }}>
          {diff}
        </pre>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button onClick={onAdopt} style={{ padding: '6px 16px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 4 }}>
          采纳
        </button>
        <button onClick={onRollback} style={{ padding: '6px 16px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 4 }}>
          回滚
        </button>
      </div>
    </div>
  );
}
