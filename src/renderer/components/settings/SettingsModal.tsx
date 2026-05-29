import React, { useState } from 'react';
import { v4 as uuid } from 'uuid';
import { useAI } from '../../context/AIContext';
import { useTheme } from '../../context/ThemeContext';
import { THEMES } from '../../theme';
import type { AIProvider, ProviderType } from '@shared/types';
import type { ThemeName } from '../../theme';

interface Props {
  onClose: () => void;
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
    name: 'Ollama (Local)',
    type: 'openai',
    baseURL: 'http://localhost:11434/v1',
    models: ['llama3', 'codellama', 'mistral', 'deepseek-coder-v2'],
  },
];

export default function SettingsModal({ onClose }: Props) {
  const { providers, saveProvider, deleteProvider, testProvider } = useAI();
  const { themeName, setThemeName } = useTheme();
  const [tab, setTab] = useState<'providers' | 'editor'>('providers');
  const [editing, setEditing] = useState<AIProvider | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [testing, setTesting] = useState(false);

  const handleAddPreset = (preset: typeof PRESET_PROVIDERS[0]) => {
    const provider: AIProvider = {
      id: uuid(),
      name: preset.name,
      type: preset.type,
      baseURL: preset.baseURL,
      apiKeyRef: `apikey_${uuid()}`,
      models: preset.models,
      defaultModel: preset.models[0],
    };
    setEditing(provider);
    setApiKey('');
    setTestResult(null);
  };

  const handleAddCustom = () => {
    const provider: AIProvider = {
      id: uuid(),
      name: 'Custom Provider',
      type: 'custom',
      baseURL: '',
      apiKeyRef: `apikey_${uuid()}`,
      models: [''],
      defaultModel: '',
    };
    setEditing(provider);
    setApiKey('');
    setTestResult(null);
  };

  const handleSave = async () => {
    if (!editing) return;
    await saveProvider(editing, apiKey);
    setEditing(null);
    setApiKey('');
    setTestResult(null);
  };

  const handleTest = async () => {
    if (!editing) return;
    setTesting(true);
    // Save first so the main process can access it
    await saveProvider(editing, apiKey);
    const result = await testProvider(editing.id);
    setTestResult(result);
    setTesting(false);
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-editor-sidebar border border-editor-border rounded-lg w-[640px] max-h-[80vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-editor-border">
          <h2 className="text-sm font-semibold text-white">Settings</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-lg">
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-editor-border">
          <button
            className={`px-4 py-2 text-xs ${tab === 'providers' ? 'text-white border-b-2 border-editor-accent' : 'text-gray-400'}`}
            onClick={() => setTab('providers')}
          >
            AI Providers
          </button>
          <button
            className={`px-4 py-2 text-xs ${tab === 'editor' ? 'text-white border-b-2 border-editor-accent' : 'text-gray-400'}`}
            onClick={() => setTab('editor')}
          >
            Editor
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {tab === 'providers' && !editing && (
            <div className="space-y-4">
              {/* Existing providers */}
              {providers.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-gray-400 mb-2">Configured Providers</h3>
                  <div className="space-y-2">
                    {providers.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between bg-editor-bg rounded px-3 py-2 border border-editor-border"
                      >
                        <div>
                          <span className="text-sm text-white">{p.name}</span>
                          <span className="text-xs text-gray-500 ml-2">{p.defaultModel}</span>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => { setEditing(p); setApiKey(''); setTestResult(null); }}
                            className="text-xs text-editor-accent hover:underline"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => deleteProvider(p.id)}
                            className="text-xs text-red-400 hover:underline"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Add preset */}
              <div>
                <h3 className="text-xs font-semibold text-gray-400 mb-2">Add Provider</h3>
                <div className="grid grid-cols-2 gap-2">
                  {PRESET_PROVIDERS.map((preset) => (
                    <button
                      key={preset.name}
                      onClick={() => handleAddPreset(preset)}
                      className="text-left bg-editor-bg border border-editor-border rounded px-3 py-2 hover:border-editor-accent transition-colors"
                    >
                      <span className="text-sm text-white">{preset.name}</span>
                      <p className="text-[11px] text-gray-500 mt-0.5 truncate">{preset.baseURL}</p>
                    </button>
                  ))}
                  <button
                    onClick={handleAddCustom}
                    className="text-left bg-editor-bg border border-dashed border-editor-border rounded px-3 py-2 hover:border-editor-accent transition-colors"
                  >
                    <span className="text-sm text-white">Custom Endpoint</span>
                    <p className="text-[11px] text-gray-500 mt-0.5">Any OpenAI-compatible API</p>
                  </button>
                </div>
              </div>
            </div>
          )}

          {tab === 'providers' && editing && (
            <div className="space-y-3">
              <button
                onClick={() => { setEditing(null); setTestResult(null); }}
                className="text-xs text-gray-400 hover:text-white"
              >
                ← Back
              </button>

              <div>
                <label className="text-xs text-gray-400 block mb-1">Name</label>
                <input
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  className="w-full bg-editor-bg border border-editor-border rounded px-3 py-1.5 text-sm text-white outline-none focus:border-editor-accent"
                />
              </div>

              <div>
                <label className="text-xs text-gray-400 block mb-1">Base URL</label>
                <input
                  value={editing.baseURL}
                  onChange={(e) => setEditing({ ...editing, baseURL: e.target.value })}
                  placeholder="https://api.openai.com/v1"
                  className="w-full bg-editor-bg border border-editor-border rounded px-3 py-1.5 text-sm text-white outline-none focus:border-editor-accent"
                />
              </div>

              <div>
                <label className="text-xs text-gray-400 block mb-1">API Key</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-..."
                  className="w-full bg-editor-bg border border-editor-border rounded px-3 py-1.5 text-sm text-white outline-none focus:border-editor-accent"
                />
                <p className="text-[11px] text-gray-600 mt-1">Stored encrypted on your machine</p>
              </div>

              <div>
                <label className="text-xs text-gray-400 block mb-1">
                  Models (comma-separated)
                </label>
                <input
                  value={editing.models.join(', ')}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      models: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                    })
                  }
                  className="w-full bg-editor-bg border border-editor-border rounded px-3 py-1.5 text-sm text-white outline-none focus:border-editor-accent"
                />
              </div>

              <div>
                <label className="text-xs text-gray-400 block mb-1">Default Model</label>
                <select
                  value={editing.defaultModel}
                  onChange={(e) => setEditing({ ...editing, defaultModel: e.target.value })}
                  className="w-full bg-editor-bg border border-editor-border rounded px-3 py-1.5 text-sm text-white outline-none focus:border-editor-accent"
                >
                  {editing.models.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs text-gray-400 block mb-1">Provider Type</label>
                <select
                  value={editing.type}
                  onChange={(e) => setEditing({ ...editing, type: e.target.value as ProviderType })}
                  className="w-full bg-editor-bg border border-editor-border rounded px-3 py-1.5 text-sm text-white outline-none focus:border-editor-accent"
                >
                  <option value="openai">OpenAI Compatible</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="custom">Custom</option>
                </select>
              </div>

              {/* Test result */}
              {testResult && (
                <div className={`text-xs px-3 py-2 rounded ${testResult.ok ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'}`}>
                  {testResult.ok ? '✅ Connection successful!' : `❌ ${testResult.error}`}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2 pt-2">
                <button
                  onClick={handleTest}
                  disabled={testing}
                  className="px-3 py-1.5 text-xs border border-editor-border rounded text-gray-300 hover:bg-editor-active disabled:opacity-40"
                >
                  {testing ? 'Testing...' : 'Test Connection'}
                </button>
                <button
                  onClick={handleSave}
                  className="px-3 py-1.5 text-xs bg-editor-accent text-white rounded hover:opacity-90"
                >
                  Save
                </button>
              </div>
            </div>
          )}

          {tab === 'editor' && (
            <div className="space-y-4">
              <div className="space-y-4">
                {/* Theme selector */}
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Theme</label>
                  <div className="flex gap-2">
                    {Object.values(THEMES).map((t) => (
                      <button
                        key={t.name}
                        onClick={() => setThemeName(t.name)}
                        className={`px-3 py-2 text-xs rounded border transition-colors ${
                          themeName === t.name
                            ? 'border-editor-accent bg-editor-active text-white'
                            : 'border-editor-border text-gray-400 hover:border-gray-500'
                        }`}
                      >
                        <div
                          className="w-4 h-4 rounded-full inline-block mr-1.5 align-middle"
                          style={{ background: t.colors.accent }}
                        />
                        {t.display}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="border-t border-editor-border pt-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-300">Font Size</span>
                    <span className="text-sm text-gray-500">14px</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-300">Tab Size</span>
                  <span className="text-sm text-gray-500">2</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-300">Word Wrap</span>
                  <span className="text-sm text-gray-500">On</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}