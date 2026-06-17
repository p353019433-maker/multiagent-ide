import React, { useState, useRef, useCallback, useEffect } from 'react';
import Sidebar from '../sidebar/Sidebar';
import EditorArea from '../editor/EditorArea';
import TaskPanel from '../task/TaskPanel';
import TerminalPanel from '../terminal/TerminalPanel';
import SearchPanel from '../search/SearchPanel';
import BrowserPreview from '../editor/BrowserPreview';
import TitleBar from './TitleBar';
<<<<<<< HEAD
import StatusBar from '../status/StatusBar';
=======
import StatusBar from './StatusBar';
>>>>>>> claude/review-repo-contents-tkoLx
import { useWorkspace } from '../../context/WorkspaceContext';
import { useTaskWorkspace } from '../../context/TaskContext';
import { getAuxPanelWidth, normalizeWorkbenchPanels } from './layoutState';
import { getAgentReadiness, type ReadinessActionId } from '../../readiness/agentReadiness';
import type { SettingsTab } from '../settings/SettingsWorkbench';

interface Props {
  onOpenSettings: (tab?: SettingsTab) => void;
  settingsVersion: number;
}

<<<<<<< HEAD
type Panel = 'sidebar' | 'chat' | 'search' | 'terminal';

export default function MainLayout({ onOpenSettings }: Props) {
=======
export default function MainLayout({ onOpenSettings, settingsVersion }: Props) {
>>>>>>> claude/review-repo-contents-tkoLx
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
<<<<<<< HEAD
  const dragging = useRef<Panel | null>(null);
  const { rootPath } = useWorkspace();

  const handleMouseDown = useCallback((panel: Panel) => {
=======
  const dragging = useRef<'sidebar' | 'task' | 'search' | 'terminal' | null>(null);
  const { rootPath, openFolder } = useWorkspace();
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
>>>>>>> claude/review-repo-contents-tkoLx
    dragging.current = panel;
    document.body.style.cursor = panel === 'terminal' ? 'row-resize' : 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (e: MouseEvent) => {
<<<<<<< HEAD
      switch (dragging.current) {
        case 'sidebar':
          setSidebarWidth(Math.max(160, Math.min(400, e.clientX)));
          break;
        case 'chat':
          setChatWidth(Math.max(280, Math.min(600, window.innerWidth - e.clientX)));
          break;
        case 'search':
          setSearchWidth(Math.max(240, Math.min(500, window.innerWidth - e.clientX)));
          break;
        case 'terminal':
          setTerminalHeight(Math.max(80, Math.min(500, window.innerHeight - e.clientY)));
          break;
=======
      if (dragging.current === 'sidebar') {
        setSidebarWidth(Math.max(160, Math.min(400, e.clientX)));
      } else if (dragging.current === 'task') {
        setTaskPanelWidth(Math.max(280, Math.min(600, window.innerWidth - e.clientX)));
      } else if (dragging.current === 'search') {
        setSearchWidth(Math.max(240, Math.min(500, window.innerWidth - e.clientX)));
      } else if (dragging.current === 'terminal') {
        setTerminalHeight(Math.max(80, Math.min(500, window.innerHeight - e.clientY)));
>>>>>>> claude/review-repo-contents-tkoLx
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

  // Bridge panel-toggle commands (emitted by commands/installCommands.ts
  // via window CustomEvents) to the panel state. The keymap itself lives
  // in App.tsx so it survives MainLayout remounts.
  useEffect(() => {
    const toggles: Array<[string, () => void]> = [
      ['panel:toggle-sidebar', () => {/* sidebar is always visible — reserved for future */}],
      ['panel:toggle-chat', () => { setShowChat((v) => !v); setShowBrowser(false); }],
      ['panel:toggle-terminal', () => setShowTerminal((v) => !v)],
      ['panel:toggle-search', () => setShowSearch((v) => !v)],
      ['panel:toggle-browser', () => { setShowBrowser((v) => !v); setShowChat(false); }],
    ];
    const cleanups = toggles.map(([type, fn]) => {
      const handler = () => fn();
      window.addEventListener(type, handler);
      return () => window.removeEventListener(type, handler);
    });
    return () => cleanups.forEach((c) => c());
  }, []);

  // Preview URL events (kept here for now — fired by the AI agent).
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

<<<<<<< HEAD
=======
  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.shiftKey && e.key === 'f') {
        e.preventDefault();
        handleToggleSearch();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleToggleSearch]);

>>>>>>> claude/review-repo-contents-tkoLx
  return (
    <div className="flex flex-col h-full bg-editor-bg">
      <TitleBar
        onOpenSettings={onOpenSettings}
        onToggleTaskPanel={handleToggleTaskPanel}
        onToggleTerminal={handleToggleTerminal}
        onToggleSearch={handleToggleSearch}
        onToggleBrowser={handleToggleBrowser}
        showTaskPanel={showTaskPanel}
        showTerminal={showTerminal}
        showSearch={showSearch}
        showBrowser={showBrowser}
      />
      <div className="flex flex-col flex-1 overflow-hidden">
        <div className="flex flex-1 overflow-hidden">
<<<<<<< HEAD
          <div style={{ width: sidebarWidth }} className="flex-shrink-0 h-full">
            <Sidebar />
          </div>
          <div
            className="resize-handle w-[3px] h-full"
            onMouseDown={() => handleMouseDown('sidebar')}
            role="separator"
            aria-orientation="vertical"
            aria-label="调整侧边栏宽度"
          />

          <div className="flex-1 flex flex-col overflow-hidden">
=======
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
>>>>>>> claude/review-repo-contents-tkoLx
            <div className="flex-1 overflow-hidden">
              <EditorArea readiness={readiness} onReadinessAction={runReadinessAction} />
            </div>

            {showTerminal && rootPath && (
              <>
                <div
                  className="resize-handle h-[3px] w-full"
                  onMouseDown={() => handleMouseDown('terminal')}
                  role="separator"
                  aria-orientation="horizontal"
                  aria-label="调整终端高度"
                />
                <div style={{ height: terminalHeight }} className="flex-shrink-0">
                  <TerminalPanel cwd={rootPath} onClose={() => setShowTerminal(false)} />
                </div>
              </>
            )}
          </div>

          {showSearch && rootPath && (
            <>
<<<<<<< HEAD
              <div
                className="resize-handle w-[3px] h-full"
                onMouseDown={() => handleMouseDown('search')}
                role="separator"
                aria-orientation="vertical"
                aria-label="调整搜索面板宽度"
              />
              <div style={{ width: searchWidth }} className="flex-shrink-0 h-full">
                <SearchPanel />
=======
              {!isCompact && (
                <div
                  className="resize-handle w-[3px] h-full"
                  onMouseDown={() => handleMouseDown('search')}
                />
              )}
              <div style={{ width: effectiveSearchWidth }} className="flex-shrink-0 h-full">
                <SearchPanel onClose={() => setShowSearch(false)} />
>>>>>>> claude/review-repo-contents-tkoLx
              </div>
            </>
          )}

<<<<<<< HEAD
          {(showChat || showBrowser) && (
            <>
              <div
                className="resize-handle w-[3px] h-full"
                onMouseDown={() => handleMouseDown('chat')}
                role="separator"
                aria-orientation="vertical"
                aria-label="调整右侧面板宽度"
              />
              <div style={{ width: chatWidth }} className="flex-shrink-0 h-full">
=======
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
>>>>>>> claude/review-repo-contents-tkoLx
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
        {/* Status bar at the very bottom — non-intrusive glance feedback */}
        <StatusBar />
      </div>
      <StatusBar />
    </div>
  );
}
