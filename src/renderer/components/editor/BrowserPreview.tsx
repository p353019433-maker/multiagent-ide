import React, { useState, useCallback } from 'react';

interface Props {
  visible: boolean;
  onClose: () => void;
  initialUrl?: string;
}

/** Agent's preview_url tool opens pages here instead of system browser. */
export default function BrowserPreview({ visible, onClose, initialUrl }: Props) {
  const [url, setUrl] = useState(initialUrl || '');
  const [inputUrl, setInputUrl] = useState(initialUrl || '');
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [navHistory, setNavHistory] = useState<string[]>([initialUrl || '']);
  const [navIndex, setNavIndex] = useState(0);

  const navigate = useCallback((targetUrl: string) => {
    if (!targetUrl) return;
    let formatted = targetUrl;
    if (!formatted.startsWith('http://') && !formatted.startsWith('https://')) {
      formatted = 'https://' + formatted;
    }
    setLoading(true);
    setLoadFailed(false);
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
      setLoading(true);
      setLoadFailed(false);
      setUrl(navHistory[newIdx]);
      setInputUrl(navHistory[newIdx]);
    }
  };

  const goForward = () => {
    if (navIndex < navHistory.length - 1) {
      const newIdx = navIndex + 1;
      setNavIndex(newIdx);
      setLoading(true);
      setLoadFailed(false);
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

      {/* Preview */}
      {url ? (
        <div className="relative flex-1 bg-white">
          <iframe
            key={url}
            src={url}
            title="浏览器预览"
            sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
            className="h-full w-full border-0 bg-white"
            onLoad={() => setLoading(false)}
            onError={() => {
              setLoading(false);
              setLoadFailed(true);
            }}
          />
          {loadFailed && (
            <div className="absolute inset-0 flex items-center justify-center bg-editor-bg text-center text-sm text-gray-400">
              <div>
                <p>无法在预览面板中加载该页面</p>
                <p className="mt-1 text-xs text-gray-500">目标页面可能禁止 iframe 嵌入。</p>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-gray-500">输入网址以开始浏览</p>
        </div>
      )}
    </div>
  );
}
