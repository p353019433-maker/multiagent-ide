import React, { useState, useRef, useCallback, useEffect } from 'react';
import Sidebar from '../sidebar/Sidebar';
import EditorArea from '../editor/EditorArea';
import ChatPanel from '../chat/ChatPanel';
import TerminalPanel from '../terminal/TerminalPanel';
import SearchPanel from '../search/SearchPanel';
import BrowserPreview from '../editor/BrowserPreview';
import TitleBar from './TitleBar';
import { useWorkspace } from '../../context/WorkspaceContext';

interface Props {
  onOpenSettings: () => void;
}

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
  const dragging = useRef<'sidebar' | 'chat' | 'search' | 'terminal' | null>(null);
  const { rootPath } = useWorkspace();

  const handleMouseDown = useCallback((panel: 'sidebar' | 'chat' | 'search' | 'terminal') => {
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
      } else if (dragging.current === 'chat') {
        setChatWidth(Math.max(280, Math.min(600, window.innerWidth - e.clientX)));
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

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.shiftKey && e.key === 'f') {
        e.preventDefault();
        setShowSearch((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="flex flex-col h-full bg-editor-bg">
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
        {/* Main area: sidebar + editor + panels */}
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          <div style={{ width: sidebarWidth }} className="flex-shrink-0 h-full">
            <Sidebar />
          </div>

          {/* Sidebar resize handle */}
          <div
            className="resize-handle w-[3px] h-full"
            onMouseDown={() => handleMouseDown('sidebar')}
          />

          {/* Editor + Terminal vertical split */}
          <div className="flex-1 flex flex-col overflow-hidden">
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
                  <TerminalPanel cwd={rootPath} />
                </div>
              </>
            )}
          </div>

          {/* Search panel */}
          {showSearch && rootPath && (
            <>
              <div
                className="resize-handle w-[3px] h-full"
                onMouseDown={() => handleMouseDown('search')}
              />
              <div style={{ width: searchWidth }} className="flex-shrink-0 h-full">
                <SearchPanel />
              </div>
            </>
          )}

          {/* Chat or Browser panel */}
          {(showChat || showBrowser) && (
            <>
              <div
                className="resize-handle w-[3px] h-full"
                onMouseDown={() => handleMouseDown('chat')}
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
      </div>
    </div>
  );
}