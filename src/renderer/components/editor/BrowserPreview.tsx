import React, { useState, useCallback } from 'react';
import { ArrowLeft, ArrowRight, Globe, LoaderCircle, RotateCw, X } from 'lucide-react';

interface Props {
  visible: boolean;
  onClose: () => void;
  initialUrl?: string;
}

/** The preview_url tool opens pages here instead of the system browser. */
export default function BrowserPreview({ visible, onClose, initialUrl }: Props) {
  const [url, setUrl] = useState(initialUrl || '');
  const [inputUrl, setInputUrl] = useState(initialUrl || '');
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [navHistory, setNavHistory] = useState<string[]>([initialUrl || '']);
  const [navIndex, setNavIndex] = useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

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
      <div className="flex h-8 flex-shrink-0 items-center gap-1 border-b border-editor-border px-2">
        {/* Nav buttons */}
        <button
          onClick={goBack}
          disabled={navIndex <= 0}
          className="flex h-6 w-6 items-center justify-center text-gray-400 hover:bg-editor-active hover:text-white disabled:opacity-30"
          title="后退"
          aria-label="后退"
        >
          <ArrowLeft size={14} strokeWidth={1.8} />
        </button>
        <button
          onClick={goForward}
          disabled={navIndex >= navHistory.length - 1}
          className="flex h-6 w-6 items-center justify-center text-gray-400 hover:bg-editor-active hover:text-white disabled:opacity-30"
          title="前进"
          aria-label="前进"
        >
          <ArrowRight size={14} strokeWidth={1.8} />
        </button>
        <button
          onClick={() => navigate(inputUrl)}
          className="flex h-6 w-6 items-center justify-center text-gray-400 hover:bg-editor-active hover:text-white"
          title="刷新"
          aria-label="刷新预览"
        >
          <RotateCw size={14} strokeWidth={1.8} />
        </button>

        {/* URL bar */}
        <div className="flex-1 flex items-center gap-1">
          {loading && <LoaderCircle size={13} strokeWidth={1.8} className="animate-spin text-editor-accent" />}
          <input
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && navigate(inputUrl)}
            placeholder="地址"
            spellCheck={false}
            ref={inputRef}
            className="flex-1 border border-editor-border bg-editor-sidebar px-2 py-0.5 font-mono text-[12px] text-editor-text focus:border-editor-accent focus:outline-none"
          />
        </div>

        {/* Close */}
        <button
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center text-gray-400 hover:bg-editor-active hover:text-red-400"
          title="关闭"
          aria-label="关闭浏览器"
        >
          <X size={14} strokeWidth={1.8} />
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
        <div className="flex-1 bg-editor-bg">
          <div className="grid grid-cols-[64px_minmax(0,1fr)] border-b border-editor-border text-sm">
            <div className="border-r border-editor-border bg-editor-sidebar px-2 py-2 font-mono text-[10px] leading-5 text-gray-600">
              READY
            </div>
            <button
              onClick={() => inputRef.current?.focus()}
              className="flex min-h-9 items-center gap-2 bg-editor-bg px-3 text-left text-editor-text hover:bg-editor-hover"
            >
              <Globe size={15} strokeWidth={1.8} className="flex-shrink-0 text-gray-500" />
              <span>地址栏</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
