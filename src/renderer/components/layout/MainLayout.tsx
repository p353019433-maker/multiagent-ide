import React, { useState, useCallback, useEffect, useRef } from 'react';
import { TerminalSquare, X } from 'lucide-react';
import TitleBar from './TitleBar';
import TaskPanel from '../task/TaskPanel';
import EditorArea from '../editor/EditorArea';
import TerminalPanel from '../terminal/TerminalPanel';
import WorkbenchLeft, { type WorkbenchView } from '../workbench/WorkbenchLeft';
import RoundTableThread from '../workbench/RoundTableThread';
import ParallelImplTray from '../workbench/ParallelImplTray';
import CommandPalette, { type PaletteCommand } from '../palette/CommandPalette';
import { onOpenPalette, type PaletteMode } from '../palette/paletteEvents';
import { useWorkspace } from '../../context/WorkspaceContext';
import { useTaskWorkspace } from '../../context/TaskContext';
import { useTheme } from '../../context/ThemeContext';
import { useEditorActions, useEditorState } from '../../context/EditorContext';
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
  const { openFiles } = useEditorState();
  const [showEditor, setShowEditor] = useState(false);
  const prevOpenCount = useRef(0);
  const { providers, activeProviderId, activeModel, agents, activeConversationId, newConversation, newWorktreeConversation } = useTaskWorkspace();
  const [showTerminal, setShowTerminal] = useState(false);
  const [worktreeNotice, setWorktreeNotice] = useState<string | null>(null);

  // Create an isolated git-worktree session (same flow as the chat header button).
  const handleNewWorktree = useCallback(async () => {
    setWorktreeNotice(null);
    if (!rootPath) {
      setWorktreeNotice('需要先打开一个 Git 项目');
      return;
    }
    try {
      const baseBranch = await window.api.git.currentBranch(rootPath);
      const branch = `task-${Date.now().toString(36)}`;
      const parentDir = (window as Window & { __WORKTREE_PARENT__?: string }).__WORKTREE_PARENT__ || rootPath;
      const wtPath = `${parentDir}_wt/${branch}`;
      const res = await window.api.git.worktreeAdd(rootPath, wtPath, branch, baseBranch);
      if (!res.success) {
        setWorktreeNotice(`创建 worktree 失败：${res.message}`);
        return;
      }
      await newWorktreeConversation(wtPath, branch, baseBranch);
    } catch (e) {
      setWorktreeNotice(`创建隔离会话失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }, [rootPath, newWorktreeConversation]);

  // Open the editor drawer when a file is opened (e.g. clicking a changed file);
  // close it when the last file is closed.
  useEffect(() => {
    if (openFiles.length > prevOpenCount.current) setShowEditor(true);
    else if (openFiles.length === 0) setShowEditor(false);
    prevOpenCount.current = openFiles.length;
  }, [openFiles.length]);
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
    { id: 'newWorktree', label: '新建隔离会话 (worktree)', keywords: 'worktree git branch isolate', run: () => void handleNewWorktree() },
    { id: 'openFolder', label: '打开文件夹…', keywords: 'open folder workspace project', run: () => void openFolder() },
    { id: 'toggleEditor', label: '切换代码编辑器', hint: '⌘E', keywords: 'editor monaco', run: () => setShowEditor((p) => !p) },
    { id: 'toggleTerminal', label: '切换终端', keywords: 'terminal pty shell', run: () => setShowTerminal((p) => !p) },
    { id: 'saveFile', label: '保存当前文件', hint: '⌘S', keywords: 'save file', run: () => void saveActiveFile() },
    { id: 'chatView', label: '切换到 对话', run: () => changeView('chat') },
    { id: 'roundView', label: '切换到 圆桌', run: () => changeView('round') },
    { id: 'agents', label: '管理智能体…', keywords: 'agent claude codex antigravity api', run: () => onOpenSettings('agents') },
    { id: 'editorSettings', label: '编辑器 / 外观设置…', keywords: 'theme font tab wrap', run: () => onOpenSettings('editor') },
    { id: 'indexSettings', label: '代码索引设置…', keywords: 'embedding index search semantic', run: () => onOpenSettings('index') },
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
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'e') {
        e.preventDefault();
        setShowEditor((p) => !p);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [shortcutsDisabled, onOpenSettings, saveActiveFile, newConversation]);

  const indexStatus = embeddingConfig?.model ? `${embeddingConfig.model} 索引` : rootPath ? '本地索引' : '未打开项目';
  const statusText = rt.running ? '圆桌进行中' : rt.implementing ? '并行实现中' : null;

  return (
    <div className="relative flex h-screen flex-col overflow-hidden text-foreground" style={{ background: 'var(--app-bg)' }}>
      <TitleBar
        onOpenSettings={() => onOpenSettings()}
        onOpenFolder={() => void openFolder()}
        branch={branch}
        statusText={statusText}
        running={rt.running || rt.implementing}
        editorOpen={showEditor}
        onToggleEditor={() => setShowEditor((p) => !p)}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* LEFT 300 */}
        <aside className="flex w-[300px] flex-none flex-col border-r border-border" style={{ background: '#ececea' }}>
          <WorkbenchLeft
            view={view}
            setView={changeView}
            rootPath={rootPath}
            indexStatus={indexStatus}
            onAddAgent={() => onOpenSettings('agents')}
            onNewWorktree={handleNewWorktree}
            onNewRound={rt.reset}
            onOpenTerminal={() => setShowTerminal(true)}
          />
        </aside>

        {/* CENTER (+ its own right tray) */}
        {view === 'chat' ? (
          <TaskPanel readiness={readiness} onReadinessAction={runReadinessAction} />
        ) : (
          <>
            <RoundTableThread rt={rt} onConfigure={() => onOpenSettings('agents')} />
            <aside className="w-[340px] flex-none border-l border-border">
              <ParallelImplTray rt={rt} />
            </aside>
          </>
        )}
      </div>

      {showEditor && (
        <div className="absolute bottom-0 left-0 right-0 top-[46px] z-40 flex">
          <div className="flex-1 bg-black/10" onClick={() => setShowEditor(false)} />
          <div className="flex h-full w-[64%] min-w-[440px] flex-col border-l border-border bg-background shadow-[0_0_24px_rgba(0,0,0,.12)]">
            <div className="flex h-[42px] flex-none items-center justify-between border-b border-border px-4">
              <span className="text-xs font-semibold text-foreground">代码 · 编辑器</span>
              <button
                onClick={() => setShowEditor(false)}
                className="flex h-7 w-7 items-center justify-center rounded-md text-foreground/50 transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
                title="关闭编辑器 (⌘E)"
                aria-label="关闭编辑器"
              >
                <X size={15} strokeWidth={1.8} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <EditorArea readiness={readiness} onReadinessAction={runReadinessAction} />
            </div>
          </div>
        </div>
      )}

      {showTerminal && (
        <div className="absolute bottom-0 left-0 right-0 z-40 flex h-[280px] flex-col border-t border-border bg-background shadow-[0_-4px_16px_rgba(0,0,0,.08)]">
          <div className="flex h-[38px] flex-none items-center justify-between border-b border-border px-4">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <TerminalSquare size={14} strokeWidth={1.7} />
              终端
            </span>
            <button
              onClick={() => setShowTerminal(false)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-foreground/50 transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
              title="关闭终端"
              aria-label="关闭终端"
            >
              <X size={15} strokeWidth={1.8} />
            </button>
          </div>
          <div className="min-h-0 flex-1">
            {rootPath ? (
              <TerminalPanel cwd={rootPath} onClose={() => setShowTerminal(false)} />
            ) : (
              <div className="p-4 text-xs text-foreground/45">打开项目后可用终端。</div>
            )}
          </div>
        </div>
      )}

      {worktreeNotice && (
        <button
          onClick={() => setWorktreeNotice(null)}
          className="absolute bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg px-3 py-2 text-xs text-white shadow-float"
          style={{ background: '#0d0d0d' }}
        >
          {worktreeNotice}
        </button>
      )}

      {paletteMode && <CommandPalette initialMode={paletteMode} commands={paletteCommands} onClose={handlePaletteClose} />}
    </div>
  );
}
