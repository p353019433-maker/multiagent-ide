import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import Sidebar from '../sidebar/Sidebar';
import EditorArea from '../editor/EditorArea';
import TaskPanel from '../task/TaskPanel';
import TerminalPanel from '../terminal/TerminalPanel';
import SearchPanel from '../search/SearchPanel';
import BrowserPreview from '../editor/BrowserPreview';
import TitleBar from './TitleBar';
import StatusBar from './StatusBar';
import CommandPalette, { type PaletteCommand } from '../palette/CommandPalette';
import { onOpenPalette, openPalette, type PaletteMode } from '../palette/paletteEvents';
import { useWorkspace } from '../../context/WorkspaceContext';
import { useTaskWorkspace } from '../../context/TaskContext';
import { useTheme } from '../../context/ThemeContext';
import { useEditorActions } from '../../context/EditorContext';
import { THEMES } from '../../theme';
import { getAuxPanelWidth, normalizeWorkbenchPanels } from './layoutState';
import { getAgentReadiness, type ReadinessActionId } from '../../readiness/agentReadiness';
import type { SettingsTab } from '../settings/SettingsWorkbench';

interface Props {
  onOpenSettings: (tab?: SettingsTab) => void;
  settingsVersion: number;
  /** 模态层（如设置页）打开时禁用全局快捷键与命令面板 */
  shortcutsDisabled?: boolean;
}

export default function MainLayout({ onOpenSettings, settingsVersion, shortcutsDisabled }: Props) {
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [taskPanelWidth, setTaskPanelWidth] = useState(380);
  const [searchWidth, setSearchWidth] = useState(320);
  const [terminalHeight, setTerminalHeight] = useState(200);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [showTaskPanel, setShowTaskPanel] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showBrowser, setShowBrowser] = useState(false);
  const [browserUrl, setBrowserUrl] = useState('');
  const [paletteMode, setPaletteMode] = useState<PaletteMode | null>(null);
  const dragging = useRef<'sidebar' | 'task' | 'search' | 'terminal' | null>(null);
  const { rootPath, openFolder } = useWorkspace();
  const { themeName, setThemeName } = useTheme();
  const { saveActiveFile } = useEditorActions();
  const { providers, activeProviderId, activeModel } = useTaskWorkspace();
  const [embeddingConfig, setEmbeddingConfig] = useState<{
    providerId?: string | null;
    model?: string | null;
  } | null>(null);
  const isCompact = viewportWidth < 760;
  const effectiveSidebarWidth = isCompact ? 160 : sidebarWidth;
  const effectiveTaskPanelWidth = getAuxPanelWidth({
    isCompact,
    viewportWidth,
    sidebarWidth: effectiveSidebarWidth,
    preferredWidth: taskPanelWidth,
  });
  const effectiveSearchWidth = getAuxPanelWidth({
    isCompact,
    viewportWidth,
    sidebarWidth: effectiveSidebarWidth,
    preferredWidth: searchWidth,
  });

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

  const openTaskPanel = useCallback(() => {
    setShowTaskPanel(true);
    setShowBrowser(false);
    if (isCompact) {
      setShowSearch(false);
      setShowTerminal(false);
    }
  }, [isCompact]);

  const runReadinessAction = useCallback(
    (actionId: ReadinessActionId) => {
      if (actionId === 'openWorkspace') {
        void openFolder();
      } else if (actionId === 'openSettings') {
        onOpenSettings('providers');
      } else if (actionId === 'openIndexSettings') {
        onOpenSettings('index');
      } else if (actionId === 'openTaskPanel') {
        openTaskPanel();
      }
    },
    [onOpenSettings, openFolder, openTaskPanel]
  );

  const handleToggleSearch = useCallback(() => {
    if (!rootPath) {
      setShowSearch(false);
      return;
    }
    setShowSearch((prev) => {
      const next = !prev;
      if (next && isCompact) {
        setShowTaskPanel(false);
        setShowBrowser(false);
        setShowTerminal(false);
      }
      return next;
    });
  }, [isCompact, rootPath]);

  const handleToggleTaskPanel = useCallback(() => {
    setShowTaskPanel((prev) => {
      const next = !prev;
      if (next && isCompact) {
        setShowSearch(false);
        setShowTerminal(false);
      }
      return next;
    });
    setShowBrowser(false);
  }, [isCompact]);

  const handleToggleBrowser = useCallback(() => {
    setShowBrowser((prev) => {
      const next = !prev;
      if (next && isCompact) {
        setShowSearch(false);
        setShowTerminal(false);
      }
      return next;
    });
    setShowTaskPanel(false);
  }, [isCompact]);

  const handleToggleTerminal = useCallback(() => {
    setShowTerminal((prev) => {
      const next = !prev;
      if (next && isCompact) {
        setShowSearch(false);
        setShowTaskPanel(false);
        setShowBrowser(false);
      }
      return next;
    });
  }, [isCompact]);

  const handleMouseDown = useCallback((panel: 'sidebar' | 'task' | 'search' | 'terminal') => {
    dragging.current = panel;
    if (panel === 'terminal') {
      document.body.style.cursor = 'row-resize';
    } else {
      document.body.style.cursor = 'col-resize';
    }
    document.body.style.userSelect = 'none';

    const handleMouseMove = (e: MouseEvent) => {
      if (dragging.current === 'sidebar') {
        setSidebarWidth(Math.max(160, Math.min(400, e.clientX)));
      } else if (dragging.current === 'task') {
        setTaskPanelWidth(Math.max(280, Math.min(600, window.innerWidth - e.clientX)));
      } else if (dragging.current === 'search') {
        setSearchWidth(Math.max(240, Math.min(500, window.innerWidth - e.clientX)));
      } else if (dragging.current === 'terminal') {
        setTerminalHeight(Math.max(80, Math.min(500, window.innerHeight - e.clientY)));
      }
    };

    const handleMouseUp = () => {
      dragging.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, []);

  useEffect(() => {
    const handleResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const normalized = normalizeWorkbenchPanels({
      isCompact,
      showSearch,
      showTaskPanel,
      showBrowser,
      showTerminal,
    });

    if (normalized.showSearch !== showSearch) setShowSearch(normalized.showSearch);
    if (normalized.showTaskPanel !== showTaskPanel) setShowTaskPanel(normalized.showTaskPanel);
    if (normalized.showBrowser !== showBrowser) setShowBrowser(normalized.showBrowser);
    if (normalized.showTerminal !== showTerminal) setShowTerminal(normalized.showTerminal);
  }, [isCompact, showSearch, showTaskPanel, showBrowser, showTerminal]);

  useEffect(() => {
    const handlePreviewUrl = (e: Event) => {
      const url = (e as CustomEvent<{ url?: string }>).detail?.url;
      if (!url) return;
      setBrowserUrl(url);
      setShowBrowser(true);
      setShowTaskPanel(false);
      if (isCompact) {
        setShowSearch(false);
        setShowTerminal(false);
      }
    };
    window.addEventListener('preview-url', handlePreviewUrl);
    return () => window.removeEventListener('preview-url', handlePreviewUrl);
  }, [isCompact]);

  const handleOpenPalette = useCallback((mode: PaletteMode) => {
    setPaletteMode((prev) => (prev === mode ? null : mode));
  }, []);

  const closePalette = useCallback(() => setPaletteMode(null), []);

  // Monaco 等处通过 CustomEvent 唤起命令面板
  useEffect(() => {
    if (shortcutsDisabled) return;
    return onOpenPalette(handleOpenPalette);
  }, [handleOpenPalette, shortcutsDisabled]);

  // 模态层（设置页）打开时收起命令面板，避免叠层
  useEffect(() => {
    if (shortcutsDisabled) setPaletteMode(null);
  }, [shortcutsDisabled]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (shortcutsDisabled) return;
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (e.shiftKey && key === 'f') {
        e.preventDefault();
        handleToggleSearch();
      } else if (!e.shiftKey && key === 'p') {
        e.preventDefault();
        handleOpenPalette('files');
      } else if ((e.shiftKey && key === 'p') || (!e.shiftKey && key === 'k')) {
        e.preventDefault();
        handleOpenPalette('commands');
      } else if (!e.shiftKey && key === 'j') {
        e.preventDefault();
        handleToggleTaskPanel();
      } else if (!e.shiftKey && key === '`') {
        e.preventDefault();
        handleToggleTerminal();
      } else if (!e.shiftKey && key === ',') {
        e.preventDefault();
        onOpenSettings('providers');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleToggleSearch, handleOpenPalette, handleToggleTaskPanel, handleToggleTerminal, onOpenSettings, shortcutsDisabled]);

  // 命令面板命令表
  const paletteCommands = useMemo<PaletteCommand[]>(() => {
    const themeCommands = Object.values(THEMES).map((t) => ({
      id: `theme-${t.name}`,
      label: `主题：${t.display}`,
      hint: themeName === t.name ? '当前' : undefined,
      keywords: `theme color ${t.name}`,
      run: () => setThemeName(t.name),
    }));
    return [
      {
        id: 'quick-open',
        label: '转到文件…',
        hint: 'Cmd P',
        keywords: 'quick open goto file',
        run: () => openPalette('files'),
      },
      {
        id: 'save-file',
        label: '保存当前文件',
        hint: 'Cmd S',
        keywords: 'save file write',
        run: () => {
          void saveActiveFile();
        },
      },
      {
        id: 'open-folder',
        label: '打开文件夹…',
        keywords: 'open folder workspace',
        run: () => {
          void openFolder();
        },
      },
      {
        id: 'toggle-task',
        label: showTaskPanel ? '收起 AI 任务面板' : '打开 AI 任务面板',
        keywords: 'task panel agent chat ai',
        run: handleToggleTaskPanel,
      },
      {
        id: 'toggle-terminal',
        label: showTerminal ? '收起终端' : '打开终端',
        keywords: 'terminal shell',
        run: handleToggleTerminal,
      },
      {
        id: 'toggle-search',
        label: showSearch ? '收起文本搜索' : '打开文本搜索',
        hint: 'Cmd Shift F',
        keywords: 'search find text grep',
        run: handleToggleSearch,
      },
      {
        id: 'toggle-browser',
        label: showBrowser ? '收起浏览器预览' : '打开浏览器预览',
        keywords: 'browser preview web',
        run: handleToggleBrowser,
      },
      {
        id: 'open-settings',
        label: '打开设置',
        keywords: 'settings preferences providers model',
        run: () => onOpenSettings('providers'),
      },
      {
        id: 'open-index-settings',
        label: '打开索引设置',
        keywords: 'settings index embedding',
        run: () => onOpenSettings('index'),
      },
      ...themeCommands,
    ];
  }, [
    themeName,
    setThemeName,
    saveActiveFile,
    openFolder,
    showTaskPanel,
    showTerminal,
    showSearch,
    showBrowser,
    handleToggleTaskPanel,
    handleToggleTerminal,
    handleToggleSearch,
    handleToggleBrowser,
    onOpenSettings,
  ]);

  return (
    <div className="flex flex-col h-full bg-editor-bg">
      <TitleBar
        onOpenSettings={onOpenSettings}
        onToggleTaskPanel={handleToggleTaskPanel}
        onToggleTerminal={handleToggleTerminal}
        onToggleSearch={handleToggleSearch}
        onToggleBrowser={handleToggleBrowser}
        onOpenQuickOpen={() => handleOpenPalette('files')}
        showTaskPanel={showTaskPanel}
        showTerminal={showTerminal}
        showSearch={showSearch}
        showBrowser={showBrowser}
      />
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Main area: sidebar + editor + panels */}
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          <div style={{ width: effectiveSidebarWidth }} className="flex-shrink-0 h-full">
            <Sidebar />
          </div>

          {/* Sidebar resize handle */}
          {!isCompact && (
            <div
              className="resize-handle w-[3px] h-full"
              onMouseDown={() => handleMouseDown('sidebar')}
            />
          )}

          {/* Editor + Terminal vertical split */}
          <div className="min-w-0 flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-hidden">
              <EditorArea readiness={readiness} onReadinessAction={runReadinessAction} />
            </div>

            {/* Terminal */}
            {showTerminal && rootPath && (
              <>
                <div
                  className="resize-handle h-[3px] w-full"
                  onMouseDown={() => handleMouseDown('terminal')}
                />
                <div style={{ height: terminalHeight }} className="flex-shrink-0">
                  <TerminalPanel cwd={rootPath} onClose={() => setShowTerminal(false)} />
                </div>
              </>
            )}
          </div>

          {/* Search panel */}
          {showSearch && rootPath && (
            <>
              {!isCompact && (
                <div
                  className="resize-handle w-[3px] h-full"
                  onMouseDown={() => handleMouseDown('search')}
                />
              )}
              <div style={{ width: effectiveSearchWidth }} className="flex-shrink-0 h-full">
                <SearchPanel onClose={() => setShowSearch(false)} />
              </div>
            </>
          )}

          {/* Task or browser panel */}
          {(showTaskPanel || showBrowser) && (
            <>
              {!isCompact && (
                <div
                  className="resize-handle w-[3px] h-full"
                  onMouseDown={() => handleMouseDown('task')}
                />
              )}
              <div style={{ width: effectiveTaskPanelWidth }} className="flex-shrink-0 h-full">
                {showBrowser ? (
                  <BrowserPreview
                    visible={showBrowser}
                    onClose={() => setShowBrowser(false)}
                    initialUrl={browserUrl}
                  />
                ) : (
                  <TaskPanel readiness={readiness} onReadinessAction={runReadinessAction} />
                )}
              </div>
            </>
          )}
        </div>
      </div>
      <StatusBar />

      {paletteMode && (
        <CommandPalette
          key={paletteMode}
          initialMode={paletteMode}
          commands={paletteCommands}
          onClose={closePalette}
        />
      )}
    </div>
  );
}
