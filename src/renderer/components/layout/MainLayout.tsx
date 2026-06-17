import React, { useState, useRef, useCallback, useEffect } from 'react';
import Sidebar from '../sidebar/Sidebar';
import EditorArea from '../editor/EditorArea';
import ChatPanel from '../chat/ChatPanel';
import TerminalPanel from '../terminal/TerminalPanel';
import SearchPanel from '../search/SearchPanel';
import BrowserPreview from '../editor/BrowserPreview';
import TitleBar from './TitleBar';
import StatusBar from '../status/StatusBar';
import { useWorkspace } from '../../context/WorkspaceContext';

interface Props {
  onOpenSettings: () => void;
}

type Panel = 'sidebar' | 'chat' | 'search' | 'terminal';

export default function MainLayout({ onOpenSettings }: Props) {
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [chatWidth, setChatWidth] = useState(380);
  const [searchWidth, setSearchWidth] = useState(320);
  const [terminalHeight, setTerminalHeight] = useState(200);
  const [showChat, setShowChat] = useState(true);
  const [showTerminal, setShowTerminal] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showBrowser, setShowBrowser] = useState(false);
  const [browserUrl, setBrowserUrl] = useState('');
  const dragging = useRef<Panel | null>(null);
  const { rootPath } = useWorkspace();

  const handleMouseDown = useCallback((panel: Panel) => {
    dragging.current = panel;
    document.body.style.cursor = panel === 'terminal' ? 'row-resize' : 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (e: MouseEvent) => {
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
    const handlePreviewUrl = (e: Event) => {
      const url = (e as CustomEvent<{ url?: string }>).detail?.url;
      if (!url) return;
      setBrowserUrl(url);
      setShowBrowser(true);
      setShowChat(false);
    };
    window.addEventListener('preview-url', handlePreviewUrl);
    return () => window.removeEventListener('preview-url', handlePreviewUrl);
  }, []);

  return (
    <div className="flex flex-col h-full">
      <TitleBar
        onOpenSettings={onOpenSettings}
        onToggleChat={() => { setShowChat(!showChat); setShowBrowser(false); }}
        onToggleTerminal={() => setShowTerminal(!showTerminal)}
        onToggleSearch={() => setShowSearch(!showSearch)}
        onToggleBrowser={() => { setShowBrowser(!showBrowser); setShowChat(false); }}
        showChat={showChat}
        showTerminal={showTerminal}
        showSearch={showSearch}
        showBrowser={showBrowser}
      />
      <div className="flex flex-col flex-1 overflow-hidden">
        <div className="flex flex-1 overflow-hidden">
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
            <div className="flex-1 overflow-hidden">
              <EditorArea />
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
                  <TerminalPanel cwd={rootPath} />
                </div>
              </>
            )}
          </div>

          {showSearch && rootPath && (
            <>
              <div
                className="resize-handle w-[3px] h-full"
                onMouseDown={() => handleMouseDown('search')}
                role="separator"
                aria-orientation="vertical"
                aria-label="调整搜索面板宽度"
              />
              <div style={{ width: searchWidth }} className="flex-shrink-0 h-full">
                <SearchPanel />
              </div>
            </>
          )}

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
                {showBrowser ? (
                  <BrowserPreview
                    visible={showBrowser}
                    onClose={() => setShowBrowser(false)}
                    initialUrl={browserUrl}
                  />
                ) : (
                  <ChatPanel />
                )}
              </div>
            </>
          )}
        </div>
        {/* Status bar at the very bottom — non-intrusive glance feedback */}
        <StatusBar />
      </div>
    </div>
  );
}
