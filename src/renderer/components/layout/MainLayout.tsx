import React, { useState, useRef, useCallback, useEffect } from 'react';
import Sidebar from '../sidebar/Sidebar';
import EditorArea from '../editor/EditorArea';
import TaskPanel from '../task/TaskPanel';
import TerminalPanel from '../terminal/TerminalPanel';
import SearchPanel from '../search/SearchPanel';
import BrowserPreview from '../editor/BrowserPreview';
import TitleBar from './TitleBar';
import StatusBar from './StatusBar';
import { useWorkspace } from '../../context/WorkspaceContext';

interface Props {
  onOpenSettings: () => void;
}

export default function MainLayout({ onOpenSettings }: Props) {
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
  const dragging = useRef<'sidebar' | 'task' | 'search' | 'terminal' | null>(null);
  const { rootPath } = useWorkspace();
  const isCompact = viewportWidth < 760;
  const effectiveSidebarWidth = isCompact ? 160 : sidebarWidth;
  const effectiveTaskPanelWidth = isCompact
    ? Math.max(220, viewportWidth - effectiveSidebarWidth - 6)
    : taskPanelWidth;
  const effectiveSearchWidth = isCompact
    ? Math.max(220, viewportWidth - effectiveSidebarWidth - 6)
    : searchWidth;

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
      }
      return next;
    });
  }, [isCompact, rootPath]);

  const handleToggleTaskPanel = useCallback(() => {
    setShowTaskPanel((prev) => !prev);
    setShowBrowser(false);
    if (isCompact) setShowSearch(false);
  }, [isCompact]);

  const handleToggleBrowser = useCallback(() => {
    setShowBrowser((prev) => !prev);
    setShowTaskPanel(false);
    if (isCompact) setShowSearch(false);
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
    const handlePreviewUrl = (e: Event) => {
      const url = (e as CustomEvent<{ url?: string }>).detail?.url;
      if (!url) return;
      setBrowserUrl(url);
      setShowBrowser(true);
      setShowTaskPanel(false);
      if (isCompact) setShowSearch(false);
    };
    window.addEventListener('preview-url', handlePreviewUrl);
    return () => window.removeEventListener('preview-url', handlePreviewUrl);
  }, [isCompact]);

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

  return (
    <div className="flex flex-col h-full bg-editor-bg">
      <TitleBar
        onOpenSettings={onOpenSettings}
        onToggleTaskPanel={handleToggleTaskPanel}
        onToggleTerminal={() => setShowTerminal(!showTerminal)}
        onToggleSearch={handleToggleSearch}
        onToggleBrowser={handleToggleBrowser}
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
              <EditorArea />
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
              <div
                className="resize-handle w-[3px] h-full"
                onMouseDown={() => handleMouseDown('task')}
              />
              <div style={{ width: effectiveTaskPanelWidth }} className="flex-shrink-0 h-full">
                {showBrowser ? (
                  <BrowserPreview
                    visible={showBrowser}
                    onClose={() => setShowBrowser(false)}
                    initialUrl={browserUrl}
                  />
                ) : (
                  <TaskPanel />
                )}
              </div>
            </>
          )}
        </div>
      </div>
      <StatusBar />
    </div>
  );
}
