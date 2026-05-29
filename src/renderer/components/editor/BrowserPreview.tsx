import React, { useState, useRef, useCallback } from 'react';

interface Props {
  visible: boolean;
  onClose: () => void;
  initialUrl?: string;
}

/**
 * Built-in browser preview using Electron's <webview> tag.
 * Agent's preview_url tool opens pages here instead of system browser.
 */
export default function BrowserPreview({ visible, onClose, initialUrl }: Props) {
  const [url, setUrl] = useState(initialUrl || '');
  const [inputUrl, setInputUrl] = useState(initialUrl || '');
  const [title, setTitle] = useState('浏览器预览');
  const [loading, setLoading] = useState(false);
  const [navHistory, setNavHistory] = useState<string[]>([initialUrl || '']);
  const [navIndex, setNavIndex] = useState(0);
  const webviewRef = useRef<any>(null);

  const navigate = useCallback((targetUrl: string) => {
    if (!targetUrl) return;
    let formatted = targetUrl;
    if (!formatted.startsWith('http://') && !formatted.startsWith('https://')) {
      formatted = 'https://' + formatted;
    }
    setUrl(formatted);
    setInputUrl(formatted);
    const newHistory = navHistory.slice(0, navIndex + 1);
    newHistory.push(formatted);
    setNavHistory(newHistory);
    setNavIndex(newHistory.length - 1);
  }, [navHistory, navIndex]);

  const goBack = () => {
    if (navIndex > 0) {
      const newIdx = navIndex - 1;
      setNavIndex(newIdx);
      setUrl(navHistory[newIdx]);
      setInputUrl(navHistory[newIdx]);
    }
  };

  const goForward = () => {
    if (navIndex < navHistory.length - 1) {
      const newIdx = navIndex + 1;
      setNavIndex(newIdx);
      setUrl(navHistory[newIdx]);
      setInputUrl(navHistory[newIdx]);
    }
  };

  // Listen for preview_url events from the renderer
  React.useEffect(() => {
    const handler = (e: CustomEvent) => navigate(e.detail.url);
    window.addEventListener('preview-url', handler as EventListener);
    return () => window.removeEventListener('preview-url', handler as EventListener);
  }, [navigate]);

  if (!visible) return null;

  return (
    <div className="h-full flex flex-col bg-editor-bg border-l border-editor-border">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-editor-border flex-shrink-0">
        {/* Nav buttons */}
        <button
          onClick={goBack}
          disabled={navIndex <= 0}
          className="text-sm px-1 py-0.5 rounded hover:bg-editor-active text-gray-400 hover:text-white disabled:opacity-30"
        >
          ◀
        </button>
        <button
          onClick={goForward}
          disabled={navIndex >= navHistory.length - 1}
          className="text-sm px-1 py-0.5 rounded hover:bg-editor-active text-gray-400 hover:text-white disabled:opacity-30"
        >
          ▶
        </button>
        <button
          onClick={() => navigate(inputUrl)}
          className="text-sm px-1 py-0.5 rounded hover:bg-editor-active text-gray-400 hover:text-white"
          title="刷新"
        >
          🔄
        </button>

        {/* URL bar */}
        <div className="flex-1 flex items-center gap-1">
          {loading && <span className="text-xs text-editor-accent animate-pulse">⟳</span>}
          <input
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && navigate(inputUrl)}
            placeholder="输入网址..."
            spellCheck={false}
            className="flex-1 text-[12px] bg-editor-sidebar border border-editor-border rounded px-2 py-0.5 text-editor-text font-mono focus:outline-none focus:border-editor-accent"
          />
        </div>

        {/* Close */}
        <button
          onClick={onClose}
          className="text-sm px-2 py-0.5 rounded hover:bg-red-900/50 text-gray-400 hover:text-white"
        >
          ✕
        </button>
      </div>

      {/* Webview */}
      {url ? (
        <webview
          ref={webviewRef}
          src={url}
          // @ts-ignore — webview is an Electron-specific tag
          webpreferences="contextIsolation=yes"
          style={{ flex: 1, background: '#fff' }}
          onLoadStart={() => setLoading(true)}
          onLoadStop={() => setLoading(false)}
          onPageTitleUpdated={(e: any) => setTitle(e.title)}
          onDidNavigate={(e: any) => {
            const newUrl = e.url;
            setUrl(newUrl);
            setInputUrl(newUrl);
          }}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-gray-500">输入网址以开始浏览</p>
        </div>
      )}
    </div>
  );
}