import React, { useState } from 'react';
import { v4 as uuid } from 'uuid';
import { Bot, Plus, Terminal, Trash2, X } from 'lucide-react';
import { useTaskWorkspace } from '../../context/TaskContext';
import type { Agent, AgentKind, ModelProvider, ProviderType } from '@shared/types';

const FIELD =
  'h-8 w-full border border-editor-border bg-editor-bg px-2 text-sm text-foreground outline-none focus:border-editor-accent';

const TYPE_LABEL: Record<AgentKind, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  antigravity: 'Antigravity',
  api: '纯 API',
};

/** Provider "format" used for a configured backend of each shell kind. */
const BACKEND_FORMAT: Partial<Record<AgentKind, ProviderType>> = {
  'claude-code': 'anthropic',
  codex: 'openai',
};

const ADD_TYPES: AgentKind[] = ['claude-code', 'codex', 'antigravity', 'api'];

/**
 * Agent roster + type-first "add agent" flow: pick a type, then configure the
 * API. Shells (Claude Code / Codex) take an optional backend — empty means the
 * tool's own login; Antigravity is Google-login (no key); 纯 API is a raw model.
 * A configured API backend is stored as a backing provider (key encrypted).
 */
export default function AgentsTab() {
  const { agents, providers, saveProvider, saveAgent, deleteAgent, deleteProvider, toggleAgent } = useTaskWorkspace();
  const [addingType, setAddingType] = useState<AgentKind | null>(null);
  const [name, setName] = useState('');
  const [baseURL, setBaseURL] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [format, setFormat] = useState<ProviderType>('openai');
  const [err, setErr] = useState('');

  const enabledCount = agents.filter((a) => a.enabled).length;

  const resetForm = () => {
    setAddingType(null);
    setName('');
    setBaseURL('');
    setApiKey('');
    setModel('');
    setFormat('openai');
    setErr('');
  };

  const openForm = (kind: AgentKind) => {
    resetForm();
    setAddingType(kind);
    setFormat(kind === 'claude-code' ? 'anthropic' : 'openai');
  };

  const submit = async () => {
    if (!addingType) return;
    const kind = addingType;
    if (kind === 'api' && (!baseURL.trim() || !model.trim())) {
      setErr('纯 API 需要填写接口地址和模型');
      return;
    }
    // api always has a backend; shells get one only if a baseURL was entered.
    const wantsBackend = kind === 'api' || (kind !== 'antigravity' && !!baseURL.trim());
    let providerId: string | undefined;
    if (wantsBackend) {
      providerId = uuid();
      const type: ProviderType = kind === 'api' ? format : BACKEND_FORMAT[kind] ?? 'openai';
      const prov: ModelProvider = {
        id: providerId,
        name: name.trim() || `${TYPE_LABEL[kind]} 后端`,
        type,
        baseURL: baseURL.trim(),
        apiKeyRef: `apiKey:${uuid()}`,
        models: model.trim() ? [model.trim()] : [],
        defaultModel: model.trim(),
      };
      await saveProvider(prov, apiKey);
    }
    const finalName =
      name.trim() ||
      (kind === 'antigravity' ? 'Antigravity' : `${TYPE_LABEL[kind]}${model.trim() ? ' · ' + model.trim() : ''}`);
    saveAgent({ id: uuid(), name: finalName, enabled: true, kind, providerId, model: model.trim() });
    resetForm();
  };

  const remove = (a: Agent) => {
    if (a.providerId) deleteProvider(a.providerId);
    deleteAgent(a.id);
  };

  const backendLabel = (a: Agent): string => {
    if (a.providerId) {
      const p = providers.find((x) => x.id === a.providerId);
      return p ? `${p.baseURL || p.name}${a.model ? ' · ' + a.model : ''}` : '连接已删除';
    }
    if (a.kind === 'antigravity') return `Google 登录${a.model ? ' · ' + a.model : ''}`;
    return `自身登录${a.model ? ' · ' + a.model : ''}`;
  };

  const isBuiltin = (a: Agent) => a.id.startsWith('cli-');

  return (
    <div>
      <div className="flex h-8 items-center gap-2 border-b border-editor-border bg-editor-sidebar px-3 text-10 font-semibold uppercase tracking-wide text-muted-foreground">
        智能体
        <span className="font-mono normal-case tabular-nums">{enabledCount}/{agents.length} 启用</span>
      </div>
      <p className="border-b border-editor-border px-3 py-2 text-11 text-muted-foreground">
        每个智能体 = 一个 CLI 外壳(Claude Code / Codex / Antigravity)或纯 API。开启的会参与下一次讨论;兼容性请自行确认。
      </p>

      {agents.map((a) => (
        <div key={a.id} className="grid grid-cols-[56px_minmax(0,1fr)_40px] items-center border-b border-editor-border">
          <button
            onClick={() => toggleAgent(a.id, !a.enabled)}
            role="switch"
            aria-checked={a.enabled}
            aria-label={`切换 ${a.name}`}
            title={a.enabled ? '已启用' : '已禁用'}
            className={`mx-3 flex h-5 w-9 items-center rounded-full px-0.5 transition-colors ${
              a.enabled ? 'justify-end bg-editor-accent' : 'justify-start bg-editor-border'
            }`}
          >
            <span className="h-4 w-4 rounded-full bg-white" />
          </button>
          <div className="min-w-0 py-2">
            <div className="flex items-center gap-1.5">
              {a.kind === 'api' ? (
                <Bot size={12} strokeWidth={1.8} className="flex-shrink-0 text-muted-foreground" />
              ) : (
                <Terminal size={12} strokeWidth={1.8} className="flex-shrink-0 text-muted-foreground" />
              )}
              <span className="truncate text-sm text-foreground">{a.name}</span>
              <span className="flex-shrink-0 border border-editor-border px-1 text-10 text-muted-foreground">
                {TYPE_LABEL[a.kind]}
              </span>
            </div>
            <div className="truncate font-mono text-10 text-muted-foreground">{backendLabel(a)}</div>
          </div>
          <div className="flex justify-center">
            {!isBuiltin(a) && (
              <button
                onClick={() => remove(a)}
                className="flex h-6 w-6 items-center justify-center text-muted-foreground hover:bg-editor-active hover:text-red-400"
                title="移除"
                aria-label={`移除 ${a.name}`}
              >
                <Trash2 size={13} strokeWidth={1.8} />
              </button>
            )}
          </div>
        </div>
      ))}

      <div className="flex h-8 items-center border-b border-editor-border bg-editor-sidebar px-3 text-10 font-semibold uppercase tracking-wide text-muted-foreground">
        添加智能体
      </div>
      {!addingType ? (
        <div className="flex flex-wrap gap-1.5 px-3 py-2">
          {ADD_TYPES.map((k) => (
            <button
              key={k}
              onClick={() => openForm(k)}
              className="inline-flex items-center gap-1 border border-editor-border px-2 py-1 text-xs text-editor-text hover:bg-editor-hover"
            >
              <Plus size={12} strokeWidth={1.8} />
              {TYPE_LABEL[k]}
            </button>
          ))}
        </div>
      ) : (
        <div className="px-3 py-2">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs text-foreground">新建 {TYPE_LABEL[addingType]}</span>
            <button
              onClick={resetForm}
              className="flex h-5 w-5 items-center justify-center text-muted-foreground hover:text-foreground"
              aria-label="取消"
            >
              <X size={13} strokeWidth={1.8} />
            </button>
          </div>
          <div className="space-y-1.5">
            <input className={FIELD} placeholder="名称(可选)" value={name} onChange={(e) => setName(e.target.value)} />
            {addingType === 'antigravity' ? (
              <p className="text-10 text-muted-foreground">用本机 Google 登录(agy)驱动,无需 API key。</p>
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
                    placeholder="API Key"
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
            {err && <p className="text-11 text-red-400">{err}</p>}
            <div className="flex justify-end gap-2 pt-0.5">
              <button onClick={resetForm} className="h-7 border border-editor-border px-3 text-xs text-foreground hover:bg-editor-active">
                取消
              </button>
              <button onClick={submit} className="h-7 bg-editor-accent px-3 text-xs text-primary-foreground hover:opacity-90">
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
