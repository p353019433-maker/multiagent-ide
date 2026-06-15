import React, { useState, useCallback } from 'react';

interface Props {
  visible: boolean;
  onClose: () => void;
  initialUrl?: string;
}

/**
 * Built-in browser preview. Uses a sandboxed <iframe> (NOT <webview>):
 *   - <webview> requires `webviewTag: true` in webPreferences, which is
 *     explicitly disabled in main/index.ts. The previous implementation was
 *     dead code that would have opened an un-sandboxed web container the
 *     moment that flag was flipped.
 *   - iframe with `sandbox="allow-scripts allow-same-origin"` keeps the
 *     preview functional but isolates it from the host Electron process.
 *
 * Agent's preview_url tool opens pages here instead of system browser.
 */
export default function BrowserPreview({ visible, onClose, initialUrl }: Props) {
  const [url, setUrl] = useState(initialUrl || '');
  const [inputUrl, setInputUrl] = useState(initialUrl || '');
  const [title, setTitle] = useState('浏览器预览');
  const [loading, setLoading] = useState(false);
  const [navHistory, setNavHistory] = useState<string[]>([initialUrl || '']);
  const [navIndex, setNavIndex] = useState(0);

  const navigate = useCallback((targetUrl: string) => {
    if (!targetUrl) return;
    let formatted = targetUrl.trim();
    if (!formatted.startsWith('http://') && !formatted.startsWith('https://')) {
      formatted = 'https://' + formatted;
    }
    // Defense-in-depth: keep iframe src as a plain https/http URL, strip
    // any control characters that some prompt-injection payloads attempt.
    formatted = formatted.replace(/[\u0000-\u001f\u007f]/g, '');
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
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { url?: string } | undefined;
      if (detail?.url) navigate(detail.url);
    };
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

      {/* Iframe (sandboxed). Replaces the broken <webview> tag. */}
      {url ? (
        <iframe
          src={url}
          sandbox="allow-scripts allow-same-origin"
          referrerPolicy="no-referrer"
          onLoad={() => setLoading(false)}
          onLoadStart={() => setLoading(true)}
          title={title}
          style={{ flex: 1, border: 'none', background: '#fff' }}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-gray-500">输入网址以开始浏览</p>
        </div>
      )}
    </div>
  );
}
