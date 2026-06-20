import React, { useState } from 'react';
import { v4 as uuid } from 'uuid';
import { Bot, Plus, Terminal, Trash2 } from 'lucide-react';
import { useTaskWorkspace } from '../../context/TaskContext';

const FIELD =
  'h-8 border border-editor-border bg-editor-bg px-2 text-sm text-foreground outline-none focus:border-editor-accent';

/**
 * Agent roster (Phase 1 of the multi-agent system). Lists every agent — built-in
 * CLI agents plus API agents (each = a provider + model) — with an enable toggle
 * that decides who joins the next discussion. Sits on top of the existing
 * provider config: an API agent references a configured "模型服务" connection.
 */
export default function AgentsTab() {
  const { agents, providers, saveAgent, deleteAgent, toggleAgent } = useTaskWorkspace();
  const [pickProvider, setPickProvider] = useState('');
  const [pickModel, setPickModel] = useState('');

  const provider = providers.find((p) => p.id === pickProvider);
  const enabledCount = agents.filter((a) => a.enabled).length;

  const addApiAgent = () => {
    if (!pickProvider || !pickModel) return;
    const p = providers.find((x) => x.id === pickProvider);
    saveAgent({
      id: uuid(),
      name: `${p?.name ?? 'API'} · ${pickModel}`,
      enabled: true,
      kind: 'api',
      providerId: pickProvider,
      model: pickModel,
    });
    setPickModel('');
  };

  return (
    <div>
      <div className="flex h-8 items-center gap-2 border-b border-editor-border bg-editor-sidebar px-3 text-10 font-semibold uppercase tracking-wide text-muted-foreground">
        智能体
        <span className="font-mono normal-case tabular-nums">{enabledCount}/{agents.length} 启用</span>
      </div>
      <p className="border-b border-editor-border px-3 py-2 text-11 text-muted-foreground">
        每个智能体 = 一个 API(模型服务 + 模型)或一个本地 CLI。开启的智能体会参与下一次多 agent 讨论;关掉就这轮不带它。
      </p>

      {agents.map((a) => {
        const prov = a.kind === 'api' ? providers.find((p) => p.id === a.providerId) : null;
        return (
          <div
            key={a.id}
            className="grid grid-cols-[56px_minmax(0,1fr)_140px_40px] items-center border-b border-editor-border"
          >
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
                {a.kind === 'cli' ? (
                  <Terminal size={12} strokeWidth={1.8} className="flex-shrink-0 text-muted-foreground" />
                ) : (
                  <Bot size={12} strokeWidth={1.8} className="flex-shrink-0 text-muted-foreground" />
                )}
                <span className="truncate text-sm text-foreground">{a.name}</span>
                <span className="flex-shrink-0 border border-editor-border px-1 text-10 text-muted-foreground">
                  {a.kind === 'cli' ? 'CLI' : 'API'}
                </span>
              </div>
              <div className="truncate font-mono text-10 text-muted-foreground">
                {a.kind === 'api'
                  ? `${prov?.name ?? '未知服务（已删除?）'} · ${a.model}`
                  : `${a.cliTool}${a.model ? ' · ' + a.model : ' · 默认模型'}`}
              </div>
            </div>

            <div className="px-2">
              {a.kind === 'cli' && (
                <input
                  defaultValue={a.model}
                  onBlur={(e) => {
                    const m = e.target.value.trim();
                    if (m !== a.model) saveAgent({ ...a, model: m });
                  }}
                  placeholder="模型(可选)"
                  spellCheck={false}
                  className="h-6 w-full border border-editor-border bg-editor-bg px-1.5 font-mono text-11 text-editor-text outline-none focus:border-editor-accent"
                />
              )}
            </div>

            <div className="flex justify-center">
              {a.kind === 'api' && (
                <button
                  onClick={() => deleteAgent(a.id)}
                  className="flex h-6 w-6 items-center justify-center text-muted-foreground hover:bg-editor-active hover:text-red-400"
                  title="移除"
                  aria-label={`移除 ${a.name}`}
                >
                  <Trash2 size={13} strokeWidth={1.8} />
                </button>
              )}
            </div>
          </div>
        );
      })}

      <div className="flex h-8 items-center border-b border-editor-border bg-editor-sidebar px-3 text-10 font-semibold uppercase tracking-wide text-muted-foreground">
        添加 API 智能体
      </div>
      {providers.length === 0 ? (
        <p className="px-3 py-2 text-11 text-muted-foreground">
          先在「模型服务」里添加一个 API 连接,然后这里就能基于它(选服务 + 模型)创建智能体。
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2 px-3 py-2">
          <select
            className={`${FIELD} max-w-[170px]`}
            value={pickProvider}
            onChange={(e) => {
              setPickProvider(e.target.value);
              setPickModel('');
            }}
            aria-label="选择模型服务"
          >
            <option value="">选择服务…</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select
            className={`${FIELD} max-w-[170px]`}
            value={pickModel}
            onChange={(e) => setPickModel(e.target.value)}
            disabled={!provider}
            aria-label="选择模型"
          >
            <option value="">选择模型…</option>
            {provider?.models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <button
            onClick={addApiAgent}
            disabled={!pickProvider || !pickModel}
            className="inline-flex h-8 items-center gap-1 bg-editor-accent px-3 text-xs text-primary-foreground hover:opacity-90 disabled:opacity-40"
          >
            <Plus size={13} strokeWidth={1.8} />
            添加
          </button>
        </div>
      )}
    </div>
  );
}
