import React, { useState } from 'react';
import { v4 as uuid } from 'uuid';
import { Plus, Trash2, X, Pencil } from 'lucide-react';
import { useTaskWorkspace } from '../../context/TaskContext';
import { agentVisual } from '../workbench/agentTheme';
import type { Agent, AgentKind, AgentRole, ModelProvider, ProviderType } from '@shared/types';
import { ROLE_LABELS } from '@shared/types';
import { FIELD } from '../../styles/recipes';

const TYPE_LABEL: Record<AgentKind, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  antigravity: 'Antigravity',
  opencode: 'OpenCode',
  api: '纯 API',
};

/** Provider "format" used for a configured backend of each shell kind. */
const BACKEND_FORMAT: Partial<Record<AgentKind, ProviderType>> = {
  'claude-code': 'anthropic',
  codex: 'openai',
};

const ADD_TYPES: AgentKind[] = ['claude-code', 'codex', 'antigravity', 'opencode', 'api'];

/** One-line backend descriptor, matching the design wording. */
function subline(a: Agent, providers: ModelProvider[]): string {
  if (a.kind === 'antigravity') return '用本机 Google 登录(agy)驱动，无需 API key。';
  if (a.kind === 'opencode') return '用 opencode 自身 provider 登录，无需在此填 API key。';
  if (a.kind === 'api') {
    const p = a.providerId ? providers.find((x) => x.id === a.providerId) : undefined;
    if (a.providerId && !p) return '连接已删除';
    return `${a.model || '模型'} · 纯 API`;
  }
  // claude-code / codex shells
  const label = agentVisual(a.kind).label; // "Claude Code" / "Codex CLI"
  return `${label} 外壳${a.model ? ' · ' + a.model : ''}`;
}

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      className="relative flex-none rounded-full transition-colors"
      style={{ width: 34, height: 19, background: on ? 'var(--status-green)' : 'rgba(13,13,13,.18)' }}
    >
      <span
        className="absolute rounded-full bg-white transition-all"
        style={{ top: 2, left: on ? 17 : 2, width: 15, height: 15, boxShadow: '0 1px 2px rgba(0,0,0,.25)' }}
      />
    </button>
  );
}

/**
 * Agent roster (settings): enable toggles + type-first "add agent" flow. Styled
 * to the gray-white workbench — card of rows with type chips/badges, pill add
 * buttons, and the Antigravity single-instance note.
 */
export default function AgentsTab() {
  const { agents, providers, saveProvider, saveAgent, deleteAgent, deleteProvider, toggleAgent } = useTaskWorkspace();
  const [addingType, setAddingType] = useState<AgentKind | null>(null);
  /** When set, the form is editing an existing agent (by id) instead of creating. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [baseURL, setBaseURL] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [format, setFormat] = useState<ProviderType>('openai');
  const [role, setRole] = useState<AgentRole>('general');
  const [err, setErr] = useState('');

  const enabledCount = agents.filter((a) => a.enabled).length;
  const editing = editingId ? agents.find((a) => a.id === editingId) ?? null : null;

  const resetForm = () => {
    setAddingType(null);
    setEditingId(null);
    setName('');
    setBaseURL('');
    setApiKey('');
    setModel('');
    setFormat('openai');
    setRole('general');
    setErr('');
  };

  const openForm = (kind: AgentKind, existing?: Agent) => {
    resetForm();
    setAddingType(kind);
    setFormat(kind === 'claude-code' ? 'anthropic' : 'openai');
    if (existing) {
      setEditingId(existing.id);
      setName(existing.name);
      setModel(existing.model);
      setRole(existing.role || 'general');
      // Prefill the backing provider's baseURL (apiKey stays blank — we can't
      // decrypt into the field; "留空=保持不变" tells the user that).
      if (existing.providerId) {
        const p = providers.find((x) => x.id === existing.providerId);
        if (p) {
          setBaseURL(p.baseURL);
          setFormat(p.type);
        }
      }
    }
  };

  const submit = async () => {
    if (!addingType) return;
    const kind = addingType;
    const isEdit = !!editing;
    if (kind === 'api' && (!baseURL.trim() || !model.trim())) {
      setErr('纯 API 需要填写接口地址和模型');
      return;
    }
    // antigravity and opencode use their own login; we never store backend creds for them.
    const ownLogin = kind === 'antigravity' || kind === 'opencode';
    const wantsBackend = kind === 'api' || (!ownLogin && !!baseURL.trim());
    const oldProviderId = editing?.providerId;

    let providerId: string | undefined;
    if (wantsBackend) {
      // Reuse the existing provider id on edit (upsert); only mint a new one on create.
      providerId = (isEdit && oldProviderId) || uuid();
      const type: ProviderType = kind === 'api' ? format : BACKEND_FORMAT[kind] ?? 'openai';
      const prov: ModelProvider = {
        id: providerId,
        name: name.trim() || `${TYPE_LABEL[kind]} 后端`,
        type,
        baseURL: baseURL.trim(),
        apiKeyRef: `apiKey:${providerId}`,
        models: model.trim() ? [model.trim()] : [],
        defaultModel: model.trim(),
      };
      // saveProvider only writes the encrypted key when apiKey is non-empty, so
      // leaving the field blank on edit preserves the previously stored key.
      await saveProvider(prov, apiKey);
    } else if (isEdit && oldProviderId && !wantsBackend) {
      // Edit removed the baseURL that used to back this shell — drop the orphan provider.
      deleteProvider(oldProviderId);
    }

    const finalName =
      name.trim() ||
      (kind === 'antigravity' ? 'Antigravity' :
       kind === 'opencode' ? (model.trim() ? `OpenCode · ${model.trim()}` : 'OpenCode') :
       `${TYPE_LABEL[kind]}${model.trim() ? ' · ' + model.trim() : ''}`);
    // On edit, preserve id + enabled; on create, mint a new id and enable by default.
    saveAgent({
      id: editing?.id ?? uuid(),
      name: finalName,
      enabled: editing?.enabled ?? true,
      kind,
      role,
      providerId,
      model: model.trim(),
    });
    resetForm();
  };

  const remove = (a: Agent) => {
    if (a.providerId) deleteProvider(a.providerId);
    deleteAgent(a.id);
  };

  const isBuiltin = (a: Agent) => a.id.startsWith('cli-');
  const addable = ADD_TYPES.filter((k) => (k === 'antigravity' ? !agents.some((a) => a.kind === 'antigravity') : true));

  return (
    <div>
      <div className="border-b border-border px-6 py-5">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-[22px] font-bold tracking-tight text-foreground">智能体</h1>
          <span className="flex-none font-mono text-11 text-foreground/45">
            {enabledCount}/{agents.length || 4} 启用
          </span>
        </div>
        <p className="mt-1 text-[13px] leading-relaxed text-foreground/55">
          每个 = 一个 CLI 外壳或纯 API。启用的参与下一次圆桌。
        </p>
      </div>

      <div className="px-6 py-5">
        {agents.length > 0 && (
          <div className="overflow-hidden rounded-[14px] border border-border bg-background shadow-card">
            {agents.map((a, i) => {
              const v = agentVisual(a.kind);
              return (
                <div key={a.id} className={`cv-row ${i < agents.length - 1 ? 'border-b border-border/60' : ''}`}>
                  <div className="flex items-center gap-3 px-4 py-3.5">
                    <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px]" style={{ background: v.iconBg }}>
                      <v.Icon size={18} strokeWidth={1.7} style={{ color: v.iconColor }} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold text-foreground">{a.name}</span>
                        <span
                          className="flex-none rounded font-mono text-[9px] font-semibold"
                          style={{ color: v.badgeColor, background: v.badgeBg, padding: '1px 5px' }}
                        >
                          {v.badge}
                        </span>
                        <span
                          className="flex-none rounded font-mono text-[9px] font-semibold"
                          style={{ color: '#0d0d0d', background: '#eef0e6', padding: '1px 5px' }}
                          title="圆桌评审角色"
                        >
                          {ROLE_LABELS[a.role || 'general']}
                        </span>
                      </div>
                      <div className="mt-0.5 truncate text-[12px] text-foreground/50">{subline(a, providers)}</div>
                    </div>
                    <Toggle on={a.enabled} onClick={() => toggleAgent(a.id, !a.enabled)} label={`切换 ${a.name}`} />
                    <button
                      onClick={() => openForm(a.kind, a)}
                      className="flex h-7 w-7 flex-none items-center justify-center rounded-md text-foreground/40 transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
                      title="编辑"
                      aria-label={`编辑 ${a.name}`}
                    >
                      <Pencil size={14} strokeWidth={1.8} />
                    </button>
                    {!isBuiltin(a) && (
                      <button
                        onClick={() => remove(a)}
                          className="flex h-7 w-7 flex-none items-center justify-center rounded-md text-foreground/40 transition-colors hover:bg-foreground/[0.05] hover:text-destructive"
                        title="移除"
                        aria-label={`移除 ${a.name}`}
                      >
                        <Trash2 size={14} strokeWidth={1.8} />
                      </button>
                    )}
                  </div>
                  {a.kind === 'antigravity' && (
                    <div className="mx-4 mb-3 flex items-center gap-1.5 rounded-lg bg-warn-surface px-3 py-1.5 text-[11px] text-warn">
                      ⚠ 共享同一登录，多开会互相影响，只允许一个。
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* add buttons */}
        {!addingType && (
          <div className="mt-3 flex flex-wrap gap-2">
            {addable.map((k) => {
              const v = agentVisual(k);
              return (
                <button
                  key={k}
                  onClick={() => openForm(k)}
                  className="flex items-center gap-2 rounded-lg border border-border-strong bg-background px-3 py-2 text-xs font-medium text-foreground shadow-[0_1px_2px_rgba(0,0,0,.04)] transition-colors hover:bg-surface-1"
                >
                  <span className="rounded font-mono text-[9px] font-semibold" style={{ color: v.badgeColor, background: v.badgeBg, padding: '1px 5px' }}>
                    {v.badge}
                  </span>
                  添加 {TYPE_LABEL[k]}
                </button>
              );
            })}
          </div>
        )}

        {/* add form */}
        {addingType && (
          <div className="mt-3 rounded-[14px] border border-border bg-background p-4 shadow-card">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold text-foreground">{editing ? '编辑' : '新建'} {TYPE_LABEL[addingType]}</span>
              <button
                onClick={resetForm}
                className="flex h-6 w-6 items-center justify-center rounded-md text-foreground/45 transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
                aria-label="取消"
              >
                <X size={15} strokeWidth={1.8} />
              </button>
            </div>
            <div className="space-y-2">
              <input className={FIELD} placeholder="名称(可选)" value={name} onChange={(e) => setName(e.target.value)} />
              {addingType === 'antigravity' ? (
                <p className="text-11 leading-relaxed text-foreground/50">
                  用本机 Google 登录(agy)驱动，无需 API key。共享同一登录，多开会互相影响，只允许添加一个。
                </p>
              ) : addingType === 'opencode' ? (
                <p className="text-11 leading-relaxed text-foreground/50">
                  用 opencode 自身的 provider 系统登录。先在终端跑一次 <code>opencode providers login</code>，再在下方可选填模型(格式 <code>provider/model</code>)。
                </p>
              ) : (
                <>
                  <input
                    className={FIELD}
                    placeholder={addingType === 'api' ? '接口地址 baseURL(必填)' : '后端 baseURL(留空=用自身登录)'}
                    value={baseURL}
                    onChange={(e) => setBaseURL(e.target.value)}
                    spellCheck={false}
                  />
                  {(addingType === 'api' || !!baseURL.trim()) && (
                    <input
                      className={FIELD}
                      type="password"
                      placeholder={editing ? 'API Key（留空=保持不变）' : 'API Key'}
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      autoComplete="new-password"
                    />
                  )}
                  {addingType === 'api' && (
                    <select className={FIELD} value={format} onChange={(e) => setFormat(e.target.value as ProviderType)}>
                      <option value="openai">OpenAI 兼容</option>
                      <option value="anthropic">Anthropic</option>
                    </select>
                  )}
                </>
              )}
              <input
                className={FIELD}
                placeholder={addingType === 'api' ? '模型(必填)' : '模型(可选)'}
                value={model}
                onChange={(e) => setModel(e.target.value)}
                spellCheck={false}
              />
              <label className="block">
                <span className="mb-1 block font-mono text-[10px] text-foreground/50">圆桌评审角色</span>
                <select
                  className={FIELD}
                  value={role}
                  onChange={(e) => setRole(e.target.value as AgentRole)}
                >
                  {(Object.keys(ROLE_LABELS) as AgentRole[]).map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </label>
              {err && <p className="text-11 text-destructive">{err}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <button
                  onClick={resetForm}
                  className="rounded-lg border border-border-strong bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-1"
                >
                  取消
                </button>
                <button onClick={submit} className="btn-codex px-3 py-1.5 text-xs">
                  <Plus size={13} strokeWidth={2} />
                  保存
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
