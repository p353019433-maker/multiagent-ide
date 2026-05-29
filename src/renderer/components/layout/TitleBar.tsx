import React from 'react';
import { useAI } from '../../context/AIContext';

interface Props {
  onOpenSettings: () => void;
  onToggleChat: () => void;
  onToggleTerminal: () => void;
  onToggleSearch: () => void;
  showChat: boolean;
  showTerminal: boolean;
  showSearch: boolean;
}

export default function TitleBar({
  onOpenSettings,
  onToggleChat,
  onToggleTerminal,
  onToggleSearch,
  showChat,
  showTerminal,
  showSearch,
}: Props) {
  const { providers, activeProviderId, activeModel, setActiveProvider, setActiveModel } = useAI();
  const activeProvider = providers.find((p) => p.id === activeProviderId);

  return (
    <div className="h-10 flex items-center justify-between px-4 bg-editor-sidebar border-b border-editor-border drag-region">
      {/* Left: app title */}
      <div className="flex items-center gap-3 no-drag">
        <span className="text-sm font-semibold text-white">AI Code IDE</span>
      </div>

      {/* Center: provider + model selector */}
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

      {/* Right: actions */}
      <div className="flex items-center gap-2 no-drag">
        <button
          onClick={onToggleSearch}
          className={`text-xs px-2 py-1 rounded transition-colors ${
            showSearch ? 'bg-editor-active text-white' : 'hover:bg-editor-active text-gray-400'
          }`}
          title={'Search (Cmd+Shift+F)'}
        >
          🔍
        </button>
        <button
          onClick={onToggleTerminal}
          className={`text-xs px-2 py-1 rounded transition-colors ${
            showTerminal ? 'bg-editor-active text-white' : 'hover:bg-editor-active text-gray-400'
          }`}
          title={showTerminal ? 'Hide terminal' : 'Show terminal'}
        >
          &gt;_
        </button>
        <button
          onClick={onToggleChat}
          className={`text-xs px-2 py-1 rounded transition-colors ${
            showChat ? 'bg-editor-active text-white' : 'hover:bg-editor-active text-gray-400'
          }`}
          title={showChat ? 'Hide chat' : 'Show chat'}
        >
          💬
        </button>
        <button
          onClick={onOpenSettings}
          className="text-xs px-2 py-1 rounded hover:bg-editor-active transition-colors"
          title="Settings"
        >
          ⚙️
        </button>
      </div>
    </div>
  );
}