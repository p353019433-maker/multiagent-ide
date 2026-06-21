import React, { useState, useCallback, useEffect } from 'react';
import TitleBar from './TitleBar';
import TaskPanel from '../task/TaskPanel';
import WorkbenchLeft, { type WorkbenchView } from '../workbench/WorkbenchLeft';
import RoundTableThread from '../workbench/RoundTableThread';
import ParallelImplTray from '../workbench/ParallelImplTray';
import CommandPalette, { type PaletteCommand } from '../palette/CommandPalette';
import { onOpenPalette, type PaletteMode } from '../palette/paletteEvents';
import { useWorkspace } from '../../context/WorkspaceContext';
import { useTaskWorkspace } from '../../context/TaskContext';
import { useTheme } from '../../context/ThemeContext';
import { useEditorActions } from '../../context/EditorContext';
import { useRoundTable } from '../../task-engine/useRoundTable';
import { THEMES } from '../../theme';
import { getAgentReadiness, type ReadinessActionId } from '../../readiness/agentReadiness';
import type { SettingsTab } from '../settings/SettingsWorkbench';

interface Props {
  onOpenSettings: (tab?: SettingsTab) => void;
  settingsVersion: number;
  shortcutsDisabled?: boolean;
}

/**
 * Codex-style agent workbench: 46px title bar over a three-column body —
 * left 300 (sessions / agent roster + skills), center (agent thread or
 * round-table discussion, bounded to ~760), right 340 (round parallel impls).
 * Top-level `view` ('chat' | 'round') swaps every column.
 */
export default function MainLayout({ onOpenSettings, settingsVersion, shortcutsDisabled }: Props) {
  const [view, setView] = useState<WorkbenchView>('chat');
  const [paletteMode, setPaletteMode] = useState<PaletteMode | null>(null);
  const [branch, setBranch] = useState<string | null>(null);
  const { rootPath, openFolder } = useWorkspace();
  const { themeName, setThemeName } = useTheme();
  const { saveActiveFile } = useEditorActions();
  const { providers, activeProviderId, activeModel, newConversation } = useTaskWorkspace();
  const [embeddingConfig, setEmbeddingConfig] = useState<{ providerId?: string | null; model?: string | null } | null>(null);

  // Shared round-table instance so center (discussion) + right (impls) stay in sync.
  const rt = useRoundTable();

  useEffect(() => {
    let cancelled = false;
    window.api.store
      .get('embeddingConfig')
      .then((config) => {
        if (!cancelled) setEmbeddingConfig((config as { providerId?: string; model?: string } | null) || null);
      })
      .catch(() => {
        if (!cancelled) setEmbeddingConfig(null);
      });
    return () => {
      cancelled = true;
    };
  }, [settingsVersion]);

  // Current git branch for the title-bar pill.
  useEffect(() => {
    let cancelled = false;
    if (!rootPath) {
      setBranch(null);
      return;
    }
    Promise.resolve(window.api.git.currentBranch(rootPath))
      .then((b: unknown) => {
        if (cancelled) return;
        const name = typeof b === 'string' ? b : (b as { branch?: string } | null)?.branch;
        setBranch(name || null);
      })
      .catch(() => {
        if (!cancelled) setBranch(null);
      });
    return () => {
      cancelled = true;
    };
  }, [rootPath, settingsVersion]);

  // Restore / persist the active view.
  useEffect(() => {
    let cancelled = false;
    window.api.store
      .get('workbenchView')
      .then((v) => {
        if (!cancelled && (v === 'chat' || v === 'round')) setView(v);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const changeView = useCallback((v: WorkbenchView) => {
    setView(v);
    void window.api.store.set('workbenchView', v);
  }, []);

  const readiness = getAgentReadiness({ rootPath, providers, activeProviderId, activeModel, embeddingConfig });

  const runReadinessAction = useCallback(
    (actionId: ReadinessActionId) => {
      if (actionId === 'openWorkspace') void openFolder();
      else if (actionId === 'openSettings') onOpenSettings('providers');
      else if (actionId === 'openIndexSettings') onOpenSettings('index');
    },
    [onOpenSettings, openFolder]
  );

  useEffect(() => {
    const dispose = onOpenPalette((mode) => setPaletteMode(mode));
    return dispose;
  }, []);
  const handlePaletteClose = useCallback(() => setPaletteMode(null), []);

  const paletteCommands: PaletteCommand[] = [
    { id: 'settings', label: '打开设置', hint: '⌘,', run: () => onOpenSettings() },
    { id: 'newConv', label: '新对话', hint: '⌘N', run: () => newConversation() },
    { id: 'chatView', label: '切换到 对话', run: () => changeView('chat') },
    { id: 'roundView', label: '切换到 圆桌', run: () => changeView('round') },
    ...Object.values(THEMES).map((t) => ({ id: `theme-${t.name}`, label: `切换主题: ${t.name}`, run: () => setThemeName(t.name) })),
  ];

  useEffect(() => {
    if (shortcutsDisabled) return;
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault();
        onOpenSettings();
      } else if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        void saveActiveFile();
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setPaletteMode((p) => (p ? null : 'commands'));
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault();
        newConversation();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [shortcutsDisabled, onOpenSettings, saveActiveFile, newConversation]);

  const indexStatus = embeddingConfig?.model ? `${embeddingConfig.model} 索引` : rootPath ? '本地索引' : '未打开项目';
  const statusText = rt.running ? '圆桌进行中' : rt.implementing ? '并行实现中' : null;

  return (
    <div className="flex h-screen flex-col overflow-hidden text-foreground" style={{ background: 'var(--app-bg)' }}>
      <TitleBar onOpenSettings={() => onOpenSettings()} branch={branch} statusText={statusText} running={rt.running || rt.implementing} />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* LEFT 300 */}
        <aside className="flex w-[300px] flex-none flex-col border-r border-border">
          <WorkbenchLeft
            view={view}
            setView={changeView}
            rootPath={rootPath}
            indexStatus={indexStatus}
            onAddAgent={() => onOpenSettings('agents')}
          />
        </aside>

        {/* CENTER flex */}
        {view === 'chat' ? (
          <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
            <TaskPanel readiness={readiness} onReadinessAction={runReadinessAction} />
          </main>
        ) : (
          <RoundTableThread rt={rt} />
        )}

        {/* RIGHT 340 (round only) */}
        {view === 'round' && (
          <aside className="w-[340px] flex-none border-l border-border">
            <ParallelImplTray rt={rt} />
          </aside>
        )}
      </div>

      {paletteMode && <CommandPalette initialMode={paletteMode} commands={paletteCommands} onClose={handlePaletteClose} />}
    </div>
  );
}
