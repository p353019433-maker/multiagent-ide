import React from 'react';
import { useTaskWorkspace } from '../../context/TaskContext';
import type { DebateStageName } from '@shared/types';
import { Sparkles } from 'lucide-react';
import { FIELD as FIELD_CLASS } from '../../styles/recipes';

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

const SETTING_ROW_CLASS =
  'grid min-h-10 grid-cols-1 border-b border-editor-border lg:grid-cols-[180px_minmax(0,1fr)]';
const SETTING_LABEL_CLASS =
  'border-b border-editor-border px-3 py-2 text-xs text-muted-foreground lg:border-b-0 lg:border-r';
const SETTING_VALUE_CLASS = 'min-w-0 px-3 py-1.5';
const SECTION_HEADER_CLASS =
  'flex h-8 items-center border-b border-editor-border bg-editor-sidebar px-3 text-10 font-semibold uppercase tracking-wide text-muted-foreground';

export function RolesSettings() {
  const ctx = useTaskWorkspace();
  const roles: DebateStageName[] = ['analyst', 'proposer', 'critic', 'synthesizer', 'executor'];

  return (
    <div>
      <div className={SECTION_HEADER_CLASS}>
        <Sparkles size={12} strokeWidth={1.7} className="mr-1.5" />
        多角色流程
      </div>
      <div className="border-b border-editor-border px-3 py-2 text-11 text-muted-foreground">
        单个 Agent 任务内部会按解析、方案、异议、综合、执行分阶段处理；这里给每个阶段指定供应商和模型。
      </div>
      {roles.map((role) => {
        const cfg = ctx.debateConfig[role];
        const providerHasModel = (providerId: string) => {
          if (!providerId) return [];
          const p = ctx.providers.find((x) => x.id === providerId);
          return p?.models ?? [];
        };

        return (
          <div key={role} className={SETTING_ROW_CLASS}>
            <label className={SETTING_LABEL_CLASS}>
              <div className="font-medium text-foreground">{ROLE_LABELS[role]}</div>
              <div className="text-10 text-muted-foreground">{ROLE_HINTS[role]}</div>
            </label>
            <div className={SETTING_VALUE_CLASS}>
              <div className="flex items-center gap-2">
                <select
                  value={cfg.providerId}
                  onChange={(e) => {
                    const pid = e.target.value;
                    const models = providerHasModel(pid);
                    ctx.setDebateRoleConfig(role, {
                      providerId: pid,
                      model: models.includes(cfg.model) ? cfg.model : (models[0] ?? ''),
                    });
                  }}
                  className={FIELD_CLASS}
                >
                  {ctx.providers.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <select
                  value={cfg.model}
                  onChange={(e) => ctx.setDebateRoleConfig(role, { model: e.target.value })}
                  className={FIELD_CLASS}
                >
                  {providerHasModel(cfg.providerId).map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <div className="flex items-center gap-1.5">
                  <span className="text-10 text-muted-foreground">温度</span>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="2"
                    value={cfg.temperature ?? 0.3}
                    onChange={(e) => {
                      const parsed = parseFloat(e.target.value);
                      // parseFloat('') is NaN, which would poison the role
                      // config; fall back to the default when the field is empty.
                      ctx.setDebateRoleConfig(role, { temperature: Number.isFinite(parsed) ? parsed : undefined });
                    }}
                    className="h-8 w-16 border border-editor-border bg-editor-bg px-2 text-xs text-foreground outline-none focus:border-editor-accent"
                  />
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
