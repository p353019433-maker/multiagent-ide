import React, { useState, useEffect, useRef } from 'react';
import { v4 as uuid } from 'uuid';
import { useTaskWorkspace } from '../../context/TaskContext';
import { useWorkspace } from '../../context/WorkspaceContext';
import { useTheme } from '../../context/ThemeContext';
import { THEMES } from '../../theme';
import type { ModelProvider, ProviderType } from '@shared/types';
import type { ThemeName } from '../../theme';
import { ArrowLeft } from 'lucide-react';
import AgentsTab from './AgentsTab';

/** Common embedding model names by provider, shown as quick hints. */
const EMBEDDING_MODEL_HINTS = [
  'deepseek-embedding-v2',
  'text-embedding-3-small',
  'text-embedding-3-large',
  'nomic-embed-text',
  'bge-m3',
];

export type SettingsTab = 'providers' | 'agents' | 'editor' | 'index';

interface Props {
  onClose: () => void;
  initialTab?: SettingsTab;
}

const PRESET_PROVIDERS: { name: string; type: ProviderType; baseURL: string; models: string[] }[] = [
  {
    name: 'OpenAI',
    type: 'openai',
    baseURL: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo', 'o1', 'o1-mini'],
  },
  {
    name: 'Anthropic',
    type: 'anthropic',
    baseURL: 'https://api.anthropic.com',
    models: ['claude-sonnet-4-20250514', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
  },
  {
    name: 'DeepSeek',
    type: 'openai',
    baseURL: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-coder', 'deepseek-reasoner'],
  },
  {
    name: 'Google Gemini',
    type: 'openai',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'],
  },
  {
    name: 'Ollama（本地）',
    type: 'openai',
    baseURL: 'http://localhost:11434/v1',
    models: ['llama3', 'codellama', 'mistral', 'deepseek-coder-v2'],
  },
];

const THEME_DISPLAY_NAME: Record<ThemeName, string> = {
  dark: '暗色',
  light: '亮色',
  'high-contrast': '高对比度',
};

const FIELD_CLASS =
  'h-8 w-full border border-editor-border bg-editor-bg px-2 text-sm text-foreground outline-none focus:border-editor-accent';
const SECONDARY_BUTTON_CLASS =
  'h-7 px-3 text-xs border border-editor-border text-foreground hover:bg-editor-active disabled:opacity-40';
const PRIMARY_BUTTON_CLASS =
  'h-7 px-3 text-xs bg-editor-accent text-primary-foreground hover:opacity-90 disabled:opacity-40';
const SECTION_HEADER_CLASS =
  'flex h-8 items-center border-b border-editor-border bg-editor-sidebar px-3 text-10 font-semibold uppercase tracking-wide text-muted-foreground';
const SETTING_ROW_CLASS =
  'grid min-h-10 grid-cols-1 border-b border-editor-border lg:grid-cols-[180px_minmax(0,1fr)]';
const SETTING_LABEL_CLASS =
  'border-b border-editor-border px-3 py-2 text-xs text-muted-foreground lg:border-b-0 lg:border-r';
const SETTING_VALUE_CLASS = 'min-w-0 px-3 py-1.5';

const createApiKeyRef = () => `apiKey:${uuid()}`;

export default function SettingsWorkbench({ onClose, initialTab = 'providers' }: Props) {
  const { providers, saveProvider, deleteProvider, testProvider } = useTaskWorkspace();
  const { rootPath } = useWorkspace();
  const { themeName, setThemeName } = useTheme();
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [editing, setEditing] = useState<ModelProvider | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [testing, setTesting] = useState(false);

  // ── Embedding (codebase semantic index) config ──
  const [embedProviderId, setEmbedProviderId] = useState('');
  const [embedModel, setEmbedModel] = useState('');
  const [reindexState, setReindexState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [reindexMsg, setReindexMsg] = useState('');
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    window.api.store.get('embeddingConfig').then((c: any) => {
      if (c?.providerId) setEmbedProviderId(c.providerId);
      if (c?.model) setEmbedModel(c.model);
    });
  }, []);

  const saveEmbeddingConfig = (providerId: string, model: string) => {
    setEmbedProviderId(providerId);
    setEmbedModel(model);
    if (providerId && model) {
      window.api.store.set('embeddingConfig', { providerId, model });
    } else {
      window.api.store.set('embeddingConfig', null);
    }
  };

  const handleReindex = async () => {
    if (!rootPath) {
      setReindexState('error');
      setReindexMsg('请先打开一个工作区');
      return;
    }
    if (!embedProviderId || !embedModel) {
      setReindexState('error');
      setReindexMsg('请先选择 embedding 服务和模型');
      return;
    }
    setReindexState('running');
    setReindexMsg('正在构建向量索引（首次可能较慢）...');
    const res = await window.api.codebase.reindex(rootPath);
    if (res.ok) {
      setReindexState('done');
      setReindexMsg('索引已构建完成');
    } else {
      setReindexState('error');
      setReindexMsg(res.error || '索引失败');
    }
  };

  const handleAddPreset = (preset: typeof PRESET_PROVIDERS[0]) => {
    const provider: ModelProvider = {
      id: uuid(),
      name: preset.name,
      type: preset.type,
      baseURL: preset.baseURL,
      apiKeyRef: createApiKeyRef(),
      models: preset.models,
      defaultModel: preset.models[0],
    };
    setEditing(provider);
    setApiKey('');
    setTestResult(null);
  };

  const handleAddCustom = () => {
    const provider: ModelProvider = {
      id: uuid(),
      name: '自定义服务',
      type: 'custom',
      baseURL: '',
      apiKeyRef: createApiKeyRef(),
      models: [''],
      defaultModel: '',
    };
    setEditing(provider);
    setApiKey('');
    setTestResult(null);
  };

  const handleSave = async (event?: React.FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (!editing) return;
    try {
      await saveProvider(editing, apiKey);
      setEditing(null);
      setApiKey('');
      setTestResult(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setTestResult({ ok: false, error: message || '保存失败' });
    }
  };

  const handleTest = async () => {
    if (!editing) return;
    setTesting(true);
    try {
      await saveProvider(editing, apiKey);
      const result = await testProvider(editing.id);
      setTestResult(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setTestResult({ ok: false, error: message || '测试失败' });
    } finally {
      setTesting(false);
    }
  };

  const navItems: { id: typeof tab; label: string }[] = [
    { id: 'providers', label: '模型服务' },
    { id: 'agents', label: '智能体' },
    { id: 'editor', label: '编辑器' },
    { id: 'index', label: '代码索引' },
  ];
  const activeNavLabel = navItems.find((item) => item.id === tab)?.label || '设置';

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-editor-bg"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <div className="drag-region flex h-[46px] flex-shrink-0 items-center gap-3 border-b border-border pl-[82px] pr-4" style={{ background: 'var(--app-bg)' }}>
        <button
          ref={closeButtonRef}
          onClick={onClose}
          className="no-drag flex items-center gap-1.5 rounded-lg border border-border-strong bg-background px-2.5 py-[5px] text-xs font-medium text-foreground shadow-[0_1px_2px_rgba(0,0,0,.04)] transition-colors hover:bg-[#fcfcfc]"
          title="返回主界面 (Esc)"
          aria-label="返回主界面"
        >
          <ArrowLeft size={14} strokeWidth={1.8} />
          返回
        </button>
        <div id="settings-title" className="text-[13px] font-semibold text-foreground">
          设置
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="w-full flex-shrink-0 border-b border-editor-border bg-editor-sidebar lg:w-52 lg:border-b-0 lg:border-r">
          <div className="flex h-8 items-center border-b border-editor-border px-3 text-10 font-semibold uppercase tracking-wide text-muted-foreground">
            首选项
          </div>
          <div className="flex overflow-x-auto lg:block">
            {navItems.map((item) => (
              <button
                key={item.id}
                className={`flex h-8 flex-shrink-0 items-center border-r border-editor-border px-3 text-left text-xs transition-colors lg:w-full lg:border-b lg:border-r-0 ${
                  tab === item.id
                    ? 'bg-editor-active text-foreground'
                    : 'text-muted-foreground hover:bg-editor-hover hover:text-foreground'
                }`}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="flex h-8 items-center justify-between border-b border-editor-border bg-editor-bg px-3">
            <span className="text-10 font-semibold uppercase tracking-wide text-muted-foreground">
              {activeNavLabel}
            </span>
            {tab === 'providers' && (
              <span className="font-mono text-10 text-muted-foreground">
                {providers.length} SERVICES
              </span>
            )}
          </div>
          <div className="w-full">
          {tab === 'providers' && !editing && (
            <div>
              <div className={SECTION_HEADER_CLASS}>已配置的服务</div>
              {providers.length > 0 ? (
                providers.map((p) => (
                  <div
                    key={p.id}
                    className="grid min-h-10 grid-cols-1 items-center border-b border-editor-border sm:grid-cols-[160px_minmax(0,1fr)_96px] lg:grid-cols-[180px_minmax(0,1fr)_96px]"
                  >
                    <div className="border-b border-editor-border px-3 py-2 text-sm text-foreground sm:border-b-0 sm:border-r">
                      {p.name}
                    </div>
                    <div className="min-w-0 px-3 py-2">
                      <span className="truncate font-mono text-11 text-muted-foreground">
                        {p.defaultModel}
                      </span>
                    </div>
                    <div className="flex h-full border-t border-editor-border sm:border-l sm:border-t-0">
                      <button
                        onClick={() => { setEditing(p); setApiKey(''); setTestResult(null); }}
                        className="flex flex-1 items-center justify-center text-xs text-editor-accent hover:bg-editor-hover"
                      >
                        编辑
                      </button>
                      <button
                        onClick={() => deleteProvider(p.id)}
                        className="flex flex-1 items-center justify-center border-l border-editor-border text-xs text-red-400 hover:bg-editor-hover"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="border-b border-editor-border px-3 py-2 text-xs text-muted-foreground">
                  未配置模型服务
                </div>
              )}

              <div className={SECTION_HEADER_CLASS}>添加服务</div>
              {PRESET_PROVIDERS.map((preset) => (
                <button
                  key={preset.name}
                  onClick={() => handleAddPreset(preset)}
                  className="grid min-h-10 w-full grid-cols-1 items-center border-b border-editor-border text-left transition-colors hover:bg-editor-hover sm:grid-cols-[160px_minmax(0,1fr)] lg:grid-cols-[180px_minmax(0,1fr)]"
                >
                  <span className="border-b border-editor-border px-3 py-2 text-sm text-foreground sm:border-b-0 sm:border-r">
                    {preset.name}
                  </span>
                  <span className="min-w-0 truncate px-3 py-2 font-mono text-11 text-muted-foreground">
                    {preset.baseURL}
                  </span>
                </button>
              ))}
              <button
                onClick={handleAddCustom}
                className="grid min-h-10 w-full grid-cols-1 items-center border-b border-editor-border text-left transition-colors hover:bg-editor-hover sm:grid-cols-[160px_minmax(0,1fr)] lg:grid-cols-[180px_minmax(0,1fr)]"
              >
                <span className="border-b border-editor-border px-3 py-2 text-sm text-foreground sm:border-b-0 sm:border-r">
                  自定义接口
                </span>
                <span className="min-w-0 truncate px-3 py-2 text-11 text-muted-foreground">
                  兼容 OpenAI API 的服务端点
                </span>
              </button>
            </div>
          )}

          {tab === 'providers' && editing && (
            <form onSubmit={handleSave}>
              <div className={SECTION_HEADER_CLASS}>
                <button
                  type="button"
                  onClick={() => { setEditing(null); setTestResult(null); }}
                  className="mr-2 flex h-6 w-6 items-center justify-center text-muted-foreground hover:bg-editor-hover hover:text-foreground"
                  title="返回服务列表"
                  aria-label="返回服务列表"
                >
                  <ArrowLeft size={13} strokeWidth={1.8} />
                </button>
                编辑服务
              </div>

              <div className={SETTING_ROW_CLASS}>
                <label className={SETTING_LABEL_CLASS}>名称</label>
                <div className={SETTING_VALUE_CLASS}>
                  <input
                    name="provider-name"
                    autoComplete="username"
                    value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    className={FIELD_CLASS}
                  />
                </div>
              </div>

              <div className={SETTING_ROW_CLASS}>
                <label className={SETTING_LABEL_CLASS}>接口地址</label>
                <div className={SETTING_VALUE_CLASS}>
                  <input
                    name="provider-base-url"
                    autoComplete="off"
                    value={editing.baseURL}
                    onChange={(e) => setEditing({ ...editing, baseURL: e.target.value })}
                    placeholder="https://api.openai.com/v1"
                    className={FIELD_CLASS}
                  />
                </div>
              </div>

              <div className={SETTING_ROW_CLASS}>
                <label className={SETTING_LABEL_CLASS}>API 密钥</label>
                <div className={SETTING_VALUE_CLASS}>
                  <input
                    type="password"
                    name="provider-api-key"
                    autoComplete="new-password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="sk-..."
                    className={FIELD_CLASS}
                  />
                  <p className="mt-1 text-11 text-muted-foreground">加密存储在本机上</p>
                </div>
              </div>

              <div className={SETTING_ROW_CLASS}>
                <label className={SETTING_LABEL_CLASS}>模型列表</label>
                <div className={SETTING_VALUE_CLASS}>
                  <input
                    name="provider-models"
                    autoComplete="off"
                    value={editing.models.join(', ')}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        models: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                      })
                    }
                    className={FIELD_CLASS}
                  />
                </div>
              </div>

              <div className={SETTING_ROW_CLASS}>
                <label className={SETTING_LABEL_CLASS}>默认模型</label>
                <div className={SETTING_VALUE_CLASS}>
                  <select
                    value={editing.defaultModel}
                    onChange={(e) => setEditing({ ...editing, defaultModel: e.target.value })}
                    className={FIELD_CLASS}
                  >
                    {editing.models.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className={SETTING_ROW_CLASS}>
                <label className={SETTING_LABEL_CLASS}>服务类型</label>
                <div className={SETTING_VALUE_CLASS}>
                  <select
                    value={editing.type}
                    onChange={(e) => setEditing({ ...editing, type: e.target.value as ProviderType })}
                    className={FIELD_CLASS}
                  >
                    <option value="openai">OpenAI 兼容</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="custom">自定义</option>
                  </select>
                </div>
              </div>

              {testResult && (
                <div className={`border-b border-editor-border px-3 py-2 text-xs ${testResult.ok ? 'text-green-400' : 'text-red-400'}`}>
                  {testResult.ok ? '连接成功' : `连接失败：${testResult.error}`}
                </div>
              )}

              <div className="flex h-10 items-center gap-2 border-b border-editor-border px-3">
                <button
                  onClick={handleTest}
                  type="button"
                  disabled={testing}
                  className={SECONDARY_BUTTON_CLASS}
                >
                  {testing ? '测试中...' : '测试连接'}
                </button>
                <button
                  type="submit"
                  className={PRIMARY_BUTTON_CLASS}
                >
                  保存
                </button>
              </div>
            </form>
          )}

          {tab === 'agents' && <AgentsTab />}

          {tab === 'index' && (
            <div>
              <div className={SECTION_HEADER_CLASS}>语义索引</div>
              <div className={SETTING_ROW_CLASS}>
                <label className={SETTING_LABEL_CLASS}>Embedding 服务</label>
                <div className={SETTING_VALUE_CLASS}>
                  <select
                    value={embedProviderId}
                    onChange={(e) => saveEmbeddingConfig(e.target.value, embedModel)}
                    className={FIELD_CLASS}
                  >
                    <option value="">（不启用，使用关键词检索）</option>
                    {providers.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className={SETTING_ROW_CLASS}>
                <label className={SETTING_LABEL_CLASS}>Embedding 模型</label>
                <div className={SETTING_VALUE_CLASS}>
                  <input
                    value={embedModel}
                    onChange={(e) => saveEmbeddingConfig(embedProviderId, e.target.value)}
                    placeholder="deepseek-embedding-v2"
                    list="embed-model-hints"
                    className={FIELD_CLASS}
                  />
                  <datalist id="embed-model-hints">
                    {EMBEDDING_MODEL_HINTS.map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                </div>
              </div>

              <div className="flex min-h-10 items-center gap-2 border-b border-editor-border px-3">
                <button
                  onClick={handleReindex}
                  disabled={reindexState === 'running'}
                  className={PRIMARY_BUTTON_CLASS}
                >
                  {reindexState === 'running' ? '构建中...' : '重建索引'}
                </button>
                {reindexMsg && (
                  <span
                    className={`min-w-0 truncate text-11 ${
                      reindexState === 'error'
                        ? 'text-red-400'
                        : reindexState === 'done'
                        ? 'text-green-400'
                        : 'text-muted-foreground'
                    }`}
                  >
                    {reindexMsg}
                  </span>
                )}
              </div>
            </div>
          )}

          {tab === 'editor' && (
            <div>
              <div className={SECTION_HEADER_CLASS}>外观</div>
              <div className={SETTING_ROW_CLASS}>
                <label className={SETTING_LABEL_CLASS}>主题</label>
                <div className={`${SETTING_VALUE_CLASS} flex flex-wrap gap-2`}>
                  {Object.entries(THEMES).map(([key, t]) => (
                    <button
                      key={t.name}
                      onClick={() => setThemeName(t.name)}
                      className={`h-8 border px-3 text-xs transition-colors ${
                        themeName === t.name
                          ? 'border-editor-accent bg-editor-active text-foreground'
                          : 'border-editor-border text-muted-foreground hover:border-muted-foreground'
                      }`}
                    >
                      <span
                        className="mr-1.5 inline-block h-3 w-3 border border-editor-border align-middle"
                        style={{ background: t.colors.accent }}
                      />
                      {THEME_DISPLAY_NAME[t.name] || t.display}
                    </button>
                  ))}
                </div>
              </div>

              <div className={SECTION_HEADER_CLASS}>编辑器</div>
              <div className={SETTING_ROW_CLASS}>
                <span className={SETTING_LABEL_CLASS}>字号</span>
                <span className={`${SETTING_VALUE_CLASS} flex items-center text-sm text-muted-foreground`}>14px</span>
              </div>
              <div className={SETTING_ROW_CLASS}>
                <span className={SETTING_LABEL_CLASS}>缩进宽度</span>
                <span className={`${SETTING_VALUE_CLASS} flex items-center text-sm text-muted-foreground`}>2</span>
              </div>
              <div className={SETTING_ROW_CLASS}>
                <span className={SETTING_LABEL_CLASS}>自动换行</span>
                <span className={`${SETTING_VALUE_CLASS} flex items-center text-sm text-muted-foreground`}>开启</span>
              </div>
            </div>
          )}
          </div>
        </main>
      </div>
    </div>
  );
}
