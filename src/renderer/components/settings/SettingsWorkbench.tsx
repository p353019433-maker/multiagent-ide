import React, { useState, useEffect, useRef } from 'react';
import { v4 as uuid } from 'uuid';
import { useTaskWorkspace } from '../../context/TaskContext';
import { useWorkspace } from '../../context/WorkspaceContext';
import { useTheme } from '../../context/ThemeContext';
import { useEditorState, useEditorActions } from '../../context/EditorContext';
import { THEMES } from '../../theme';
import type { ModelProvider, ProviderType } from '@shared/types';
import type { ThemeName } from '../../theme';
import { ArrowLeft, Boxes, Search, Settings as SettingsIcon, Users } from 'lucide-react';
import AgentsTab from './AgentsTab';
import { FIELD as FIELD_CLASS } from '../../styles/recipes';

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
    models: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini', 'o3', 'o4-mini'],
  },
  {
    name: 'Anthropic',
    type: 'anthropic',
    baseURL: 'https://api.anthropic.com',
    models: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-3-5-haiku-20241022'],
  },
  {
    name: 'DeepSeek',
    type: 'openai',
    baseURL: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
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
    models: ['llama3.3', 'qwen2.5-coder', 'deepseek-r1', 'mistral'],
  },
];

const THEME_DISPLAY_NAME: Record<ThemeName, string> = {
  dark: '暗色',
  light: '亮色',
  'high-contrast': '高对比度',
};

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
  const { rootPath, rootName } = useWorkspace();
  const { themeName, setThemeName } = useTheme();
  const { editorSettings } = useEditorState();
  const { updateEditorSettings } = useEditorActions();
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
    window.api.store.get('embeddingConfig').then((c: unknown) => {
      const cfg = c as { providerId?: string; model?: string } | null;
      if (cfg?.providerId) setEmbedProviderId(cfg.providerId);
      if (cfg?.model) setEmbedModel(cfg.model);
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

  const navItems: { id: typeof tab; label: string; icon: typeof Users }[] = [
    { id: 'providers', label: '模型供应商', icon: Boxes },
    { id: 'agents', label: '智能体', icon: Users },
    { id: 'editor', label: '编辑器 / 外观', icon: SettingsIcon },
    { id: 'index', label: '代码索引', icon: Search },
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
          className="no-drag flex items-center gap-1.5 rounded-lg border border-border-strong bg-background px-2.5 py-[5px] text-xs font-medium text-foreground shadow-[0_1px_2px_rgba(0,0,0,.04)] transition-colors hover:bg-surface-1"
          title="返回主界面 (Esc)"
          aria-label="返回主界面"
        >
          <ArrowLeft size={14} strokeWidth={1.8} />
          返回
        </button>
        <div id="settings-title" className="text-13 font-semibold text-foreground">
          设置
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="flex w-full flex-shrink-0 flex-col border-b border-border lg:w-[220px] lg:border-b-0 lg:border-r" style={{ background: 'var(--app-bg)' }}>
          <div className="px-3 pb-1 pt-3 text-10 font-bold uppercase tracking-[0.06em] text-foreground/40">设置</div>
          <div className="flex gap-1 overflow-x-auto px-2 lg:block lg:space-y-0.5">
            {navItems.map((item) => {
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setTab(item.id)}
                  className={`flex flex-shrink-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-13 transition-colors lg:w-full ${
                    active
                      ? 'bg-background font-medium text-foreground shadow-[0_1px_2px_rgba(0,0,0,.06)]'
                      : 'text-foreground/55 hover:bg-foreground/[0.04] hover:text-foreground'
                  }`}
                >
                  <item.icon size={15} strokeWidth={1.7} className={active ? '' : 'text-foreground/45'} />
                  {item.label}
                </button>
              );
            })}
          </div>
          <div className="mt-auto flex items-center gap-2.5 border-t border-border px-3 py-3">
            <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-foreground text-11 font-semibold text-background">
              AI
            </span>
            <div className="min-w-0">
              <div className="truncate text-xs font-medium text-foreground">{rootName || 'AI Code IDE'}</div>
              <div className="truncate text-10 text-foreground/45">本地工作区</div>
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto">
          {tab !== 'agents' && (
            <div className="flex h-[46px] items-center justify-between border-b border-border px-6">
              <span className="text-sm font-semibold text-foreground">{activeNavLabel}</span>
              {tab === 'providers' && (
                <span className="font-mono text-10 text-muted-foreground">{providers.length} 个服务</span>
              )}
            </div>
          )}
          <div className="w-full">
          {tab === 'providers' && !editing && (
            <div>
              <div className={SECTION_HEADER_CLASS}>已配置的服务</div>
              {providers.length > 0 ? (
                providers.map((p) => (
                  <div
                    key={p.id}
                    className="cv-row grid min-h-10 grid-cols-1 items-center border-b border-editor-border sm:grid-cols-[160px_minmax(0,1fr)_96px] lg:grid-cols-[180px_minmax(0,1fr)_96px]"
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
                <label className={SETTING_LABEL_CLASS} htmlFor="editor-fontsize">字号</label>
                <div className={`${SETTING_VALUE_CLASS} flex items-center gap-2`}>
                  <input
                    id="editor-fontsize"
                    type="range"
                    min={10}
                    max={24}
                    step={1}
                    value={editorSettings.fontSize}
                    onChange={(e) => updateEditorSettings({ fontSize: Number(e.target.value) })}
                    className="h-1.5 w-40 cursor-pointer accent-foreground/70"
                  />
                  <span className="font-mono text-sm tabular-nums text-foreground/80">
                    {editorSettings.fontSize}px
                  </span>
                </div>
              </div>
              <div className={SETTING_ROW_CLASS}>
                <label className={SETTING_LABEL_CLASS} htmlFor="editor-tabsize">缩进宽度</label>
                <div className={`${SETTING_VALUE_CLASS} flex items-center gap-2`}>
                  <select
                    id="editor-tabsize"
                    value={editorSettings.tabSize}
                    onChange={(e) => updateEditorSettings({ tabSize: Number(e.target.value) })}
                    className={FIELD_CLASS}
                    style={{ width: 100 }}
                  >
                    {[2, 4, 8].map((n) => (
                      <option key={n} value={n}>{n} 空格</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className={SETTING_ROW_CLASS}>
                <span className={SETTING_LABEL_CLASS}>自动换行</span>
                <div className={`${SETTING_VALUE_CLASS} flex items-center`}>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={editorSettings.wordWrap}
                    onClick={() => updateEditorSettings({ wordWrap: !editorSettings.wordWrap })}
                    className="relative flex-none rounded-full transition-colors"
                    style={{
                      width: 34,
                      height: 19,
                      background: editorSettings.wordWrap ? 'var(--status-green)' : 'rgba(13,13,13,.18)',
                    }}
                    title="自动换行"
                  >
                    <span
                      className="absolute rounded-full bg-white transition-all"
                      style={{
                        top: 2,
                        left: editorSettings.wordWrap ? 17 : 2,
                        width: 15,
                        height: 15,
                        boxShadow: '0 1px 2px rgba(0,0,0,.25)',
                      }}
                    />
                  </button>
                </div>
              </div>
            </div>
          )}

          </div>
        </main>
      </div>
    </div>
  );
}
