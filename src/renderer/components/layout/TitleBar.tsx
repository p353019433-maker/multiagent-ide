import React from 'react';
import { useAI } from '../../context/AIContext';

interface Props {
  onOpenSettings: () => void;
  onToggleChat: () => void;
  onToggleTerminal: () => void;
  onToggleSearch: () => void;
  onToggleBrowser: () => void;
  showChat: boolean;
  showTerminal: boolean;
  showSearch: boolean;
  showBrowser: boolean;
}

export default function TitleBar({
  onOpenSettings,
  onToggleChat,
  onToggleTerminal,
  onToggleSearch,
  onToggleBrowser,
  showChat,
  showTerminal,
  showSearch,
  showBrowser,
}: Props) {
  const { providers, activeProviderId, activeModel, setActiveProvider, setActiveModel } = useAI();
  const activeProvider = providers.find((p) => p.id === activeProviderId);

  return (
    <div className="h-10 flex items-center justify-between px-4 bg-editor-sidebar border-b border-editor-border drag-region">
      <div className="flex items-center gap-3 no-drag">
        <span className="text-sm font-semibold text-white">AI Code IDE</span>
      </div>

      <div className="flex items-center gap-2 no-drag">
        {providers.length > 0 && (
          <>
            <select
              className="bg-editor-active text-xs text-editor-text px-2 py-1 rounded border border-editor-border outline-none"
              value={activeProviderId || ''}
              onChange={(e) => setActiveProvider(e.target.value)}
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {activeProvider && (
              <select
                className="bg-editor-active text-xs text-editor-text px-2 py-1 rounded border border-editor-border outline-none"
                value={activeModel || ''}
                onChange={(e) => setActiveModel(e.target.value)}
              >
                {activeProvider.models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            )}
          </>
        )}
      </div>

      <div className="flex items-center gap-2 no-drag">
        <button
          onClick={onToggleSearch}
          className={`text-xs px-2 py-1 rounded transition-colors ${
            showSearch ? 'bg-editor-active text-white' : 'hover:bg-editor-active text-gray-400'
          }`}
          title="搜索 (Cmd+Shift+F)"
        >
          🔍
        </button>
        <button
          onClick={onToggleTerminal}
          className={`text-xs px-2 py-1 rounded transition-colors ${
            showTerminal ? 'bg-editor-active text-white' : 'hover:bg-editor-active text-gray-400'
          }`}
          title={showTerminal ? '收起终端' : '显示终端'}
        >
          &gt;_
        </button>
        <button
          onClick={onToggleChat}
          className={`text-xs px-2 py-1 rounded transition-colors ${
            showChat ? 'bg-editor-active text-white' : 'hover:bg-editor-active text-gray-400'
          }`}
          title={showChat ? '收起对话' : '显示对话'}
        >
          💬
        </button>
        <button
          onClick={onToggleBrowser}
          className={`text-xs px-2 py-1 rounded transition-colors ${
            showBrowser ? 'bg-editor-active text-white' : 'hover:bg-editor-active text-gray-400'
          }`}
          title={showBrowser ? '收起浏览器' : '内置浏览器'}
        >
          🌐
        </button>
        <button
          onClick={onOpenSettings}
          className="text-xs px-2 py-1 rounded hover:bg-editor-active transition-colors"
          title="设置"
        >
          ⚙️
        </button>
      </div>
    </div>
  );
}