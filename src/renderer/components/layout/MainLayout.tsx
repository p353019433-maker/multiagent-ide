import React, { useState, useRef, useCallback, useEffect } from 'react';
import TitleBar from './TitleBar';
import StatusBar from './StatusBar';
import TaskPanel from '../task/TaskPanel';
import EditorArea from '../editor/EditorArea';
import CommandPalette, { type PaletteCommand } from '../palette/CommandPalette';
import { onOpenPalette, openPalette, type PaletteMode } from '../palette/paletteEvents';
import { useWorkspace } from '../../context/WorkspaceContext';
import { useTaskWorkspace } from '../../context/TaskContext';
import { useTheme } from '../../context/ThemeContext';
import { useEditorActions } from '../../context/EditorContext';
import { THEMES } from '../../theme';
import { getAgentReadiness, type ReadinessActionId } from '../../readiness/agentReadiness';
import type { SettingsTab } from '../settings/SettingsWorkbench';
import { Code2, MessageSquare, Settings } from 'lucide-react';

interface Props {
  onOpenSettings: (tab?: SettingsTab) => void;
  settingsVersion: number;
  shortcutsDisabled?: boolean;
}

/**
 * Codex-style layout: left conversation sidebar + center chat flow (main) +
 * right optional Monaco panel + bottom input bar. The chat replaces the code
 * editor as the primary focus — Monaco becomes an auxiliary code viewer.
 */
export default function MainLayout({ onOpenSettings, settingsVersion, shortcutsDisabled }: Props) {
  const [showEditor, setShowEditor] = useState(false);
  const [editorWidth, setEditorWidth] = useState(480);
  const [paletteMode, setPaletteMode] = useState<PaletteMode | null>(null);
  const { rootPath, openFolder } = useWorkspace();
  const { themeName, setThemeName } = useTheme();
  const { saveActiveFile } = useEditorActions();
  const { providers, activeProviderId, activeModel, conversations, activeConversationId, setActiveConversation, newConversation, deleteConversation } = useTaskWorkspace();
  const [embeddingConfig, setEmbeddingConfig] = useState<{
    providerId?: string | null;
    model?: string | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.api.store
      .get('embeddingConfig')
      .then((config) => {
        if (!cancelled) {
          setEmbeddingConfig((config as { providerId?: string; model?: string } | null) || null);
        }
      })
      .catch(() => {
        if (!cancelled) setEmbeddingConfig(null);
      });
    return () => {
      cancelled = true;
    };
  }, [settingsVersion]);

  const readiness = getAgentReadiness({
    rootPath,
    providers,
    activeProviderId,
    activeModel,
    embeddingConfig,
  });

  const runReadinessAction = useCallback(
    (actionId: ReadinessActionId) => {
      if (actionId === 'openWorkspace') {
        void openFolder();
      } else if (actionId === 'openSettings') {
        onOpenSettings('providers');
      } else if (actionId === 'openIndexSettings') {
        onOpenSettings('index');
      }
    },
    [onOpenSettings, openFolder]
  );

  // Command palette
  useEffect(() => {
    const dispose = onOpenPalette((mode) => setPaletteMode(mode));
    return dispose;
  }, []);

  const handlePaletteClose = useCallback(() => setPaletteMode(null), []);

  const paletteCommands: PaletteCommand[] = [
    { id: 'settings', label: '打开设置', hint: '⌘,', run: () => onOpenSettings() },
    { id: 'newConv', label: '新对话', hint: '⌘N', run: () => newConversation() },
    { id: 'toggleEditor', label: showEditor ? '关闭代码查看器' : '打开代码查看器', hint: '⌘E', run: () => setShowEditor((p) => !p) },
    ...Object.values(THEMES).map((t) => ({
      id: `theme-${t.name}`,
      label: `切换主题: ${t.name}`,
      run: () => setThemeName(t.name),
    })),
  ];

  // Global shortcuts (⌘S save, ⌘, settings, etc.)
  useEffect(() => {
    if (shortcutsDisabled) return;
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault();
        onOpenSettings();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        void saveActiveFile();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setPaletteMode((p) => (p ? null : 'commands'));
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault();
        newConversation();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'e') {
        e.preventDefault();
        setShowEditor((p) => !p);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [shortcutsDisabled, onOpenSettings, saveActiveFile, newConversation]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <TitleBar
        onOpenSettings={onOpenSettings}
        onToggleTaskPanel={() => {}}
        onToggleTerminal={() => {}}
        onToggleSearch={() => {}}
        onToggleBrowser={() => setShowEditor((p) => !p)}
        onOpenQuickOpen={() => setPaletteMode('files')}
        showTaskPanel={false}
        showTerminal={false}
        showSearch={false}
        showBrowser={showEditor}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar: conversation list */}
        <aside className="flex w-60 flex-col border-r border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">对话</h2>
            <button onClick={() => newConversation()} className="btn-codex h-6 px-2 text-10" title="新对话">
              <MessageSquare size={12} strokeWidth={1.8} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {conversations.map((conv) => (
              <div
                key={conv.id}
                onClick={() => setActiveConversation(conv.id)}
                className={`cursor-pointer border-b border-border px-3 py-2 text-xs transition-colors hover:bg-muted ${
                  conv.id === activeConversationId ? 'bg-muted text-primary' : 'text-foreground'
                }`}
              >
                <div className="truncate font-medium">{conv.title}</div>
                <div className="truncate text-10 text-muted-foreground">{conv.messages.length} 条消息</div>
              </div>
            ))}
          </div>
          <div className="border-t border-border p-2">
            <button onClick={() => onOpenSettings()} className="btn-codex-secondary w-full text-xs">
              <Settings size={12} strokeWidth={1.8} />
              设置
            </button>
          </div>
        </aside>

        {/* Center: main chat flow (TaskPanel as primary) */}
        <main className="flex flex-1 flex-col overflow-hidden">
          <TaskPanel readiness={readiness} onReadinessAction={runReadinessAction} />
        </main>

        {/* Right: optional Monaco editor panel */}
        {showEditor && (
          <>
            <div
              className="w-[3px] cursor-col-resize bg-transparent hover:bg-ring"
              onMouseDown={() => {
                const startX = 0;
                const startW = editorWidth;
                const onMove = (e: MouseEvent) => setEditorWidth(Math.max(320, startW - (e.clientX - startX)));
                const onUp = () => {
                  document.removeEventListener('mousemove', onMove);
                  document.removeEventListener('mouseup', onUp);
                };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
              }}
            />
            <aside className="flex flex-col border-l border-border bg-background" style={{ width: editorWidth }}>
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">代码查看器</h2>
                <button onClick={() => setShowEditor(false)} className="btn-codex-secondary h-6 px-2 text-10" title="关闭">
                  <Code2 size={12} strokeWidth={1.8} />
                </button>
              </div>
              <div className="flex-1 overflow-hidden">
                <EditorArea readiness={readiness} onReadinessAction={runReadinessAction} />
              </div>
            </aside>
          </>
        )}
      </div>

      <StatusBar />

      {paletteMode && (
        <CommandPalette
          initialMode={paletteMode}
          commands={paletteCommands}
          onClose={handlePaletteClose}
        />
      )}
    </div>
  );
}
