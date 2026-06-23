import React from 'react';
import { useTaskWorkspace } from '../../context/TaskContext';
import type { DebateStageName } from '@shared/types';

const ROLE_LABELS: Record<DebateStageName, string> = {
  analyst: '解析员',
  proposer: '方案者',
  critic: '异议者',
  synthesizer: '综合者',
  executor: '执行者',
};

const ROLE_HINTS: Record<DebateStageName, string> = {
  analyst: '便宜快的模型即可',
  proposer: '强推理模型',
  critic: '跟方案者不同的强模型，避免同源 bias',
  synthesizer: '最强的模型',
  executor: '执行阶段用的模型',
};

export function RolesSettings() {
  const ctx = useTaskWorkspace();
  const roles: DebateStageName[] = ['analyst', 'proposer', 'critic', 'synthesizer', 'executor'];

  return (
    <div style={{ padding: 16 }}>
      <h3 style={{ marginTop: 0 }}>辩论角色配置</h3>
      <p style={{ color: '#6b7280', fontSize: 13 }}>给每个角色指定供应商和模型。不同角色用不同模型能减少盲区。</p>
      {roles.map((role) => {
        const cfg = ctx.debateConfig[role];
        return (
          <div key={role} style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: 12, marginBottom: 12 }}>
            <div style={{ fontWeight: 600 }}>{ROLE_LABELS[role]}</div>
            <div style={{ color: '#9ca3af', fontSize: 12, marginBottom: 8 }}>{ROLE_HINTS[role]}</div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <select
                value={cfg.providerId}
                onChange={(e) => ctx.setDebateRoleConfig(role, { providerId: e.target.value })}
                style={{ padding: 4, border: '1px solid #d1d5db', borderRadius: 4 }}
              >
                {ctx.providers.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <select
                value={cfg.model}
                onChange={(e) => ctx.setDebateRoleConfig(role, { model: e.target.value })}
                style={{ padding: 4, border: '1px solid #d1d5db', borderRadius: 4 }}
              >
                {ctx.providers.find((p) => p.id === cfg.providerId)?.models.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <label style={{ fontSize: 12 }}>
                温度
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="2"
                  value={cfg.temperature ?? 0.3}
                  onChange={(e) => ctx.setDebateRoleConfig(role, { temperature: parseFloat(e.target.value) })}
                  style={{ width: 50, marginLeft: 4, padding: 4, border: '1px solid #d1d5db', borderRadius: 4 }}
                />
              </label>
            </div>
          </div>
        );
      })}
    </div>
  );
}
