import React, { useEffect, useRef, useCallback, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Eraser, X } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';

interface Props {
  cwd: string;
  onClose: () => void;
}

export default function TerminalPanel({ cwd, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  // Tracks whether the component is still mounted. The pty session is created
  // asynchronously, so without this we'd leak a session if the panel unmounts
  // before `terminal.create` resolves.
  const mountedRef = useRef(true);
  const [terminalUnavailable, setTerminalUnavailable] = useState('');
  const { theme } = useTheme();
  const themeRef = useRef(theme);
  themeRef.current = theme;

  // 主题切换时同步 xterm 调色板（xterm v5 支持运行时更新 options）
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = { ...theme.terminal };
    }
  }, [theme]);

  const initTerminal = useCallback(async () => {
    if (!containerRef.current || termRef.current) return;

    setTerminalUnavailable('');
    const id = await window.api.terminal.create(cwd).catch(() => null);
    if (!id) {
      setTerminalUnavailable('终端不可用（node-pty 未加载）');
      return;
    }
    if (!containerRef.current) {
      await window.api.terminal.close(id).catch(() => undefined);
      return;
    }

    const term = new Terminal({
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
      theme: { ...themeRef.current.terminal },
      cursorBlink: true,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitRef.current = fitAddon;

    // If the panel unmounted while we were creating the pty/terminal, tear
    // down what we built so neither the term nor the pty session leaks.
    if (!mountedRef.current) {
      window.api.terminal.close(id);
      term.dispose();
      return;
    }
    sessionIdRef.current = id;

    term.onData((data) => {
      if (sessionIdRef.current) {
        window.api.terminal.write(sessionIdRef.current, data);
      }
    });

    const unsubData = window.api.terminal.onData((sid, data) => {
      if (sid === sessionIdRef.current) {
        term.write(data);
      }
    });

    const unsubExit = window.api.terminal.onExit((sid, code) => {
      if (sid === sessionIdRef.current) {
        term.writeln(`\r\n[进程已退出，退出码 ${code}]`);
        sessionIdRef.current = null;
      }
    });

    const handleResize = () => {
      if (!fitRef.current) return;
      fitRef.current.fit();
      if (sessionIdRef.current && termRef.current) {
        window.api.terminal.resize(
          sessionIdRef.current,
          termRef.current.cols,
          termRef.current.rows
        );
      }
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(containerRef.current);

    return () => {
      unsubData();
      unsubExit();
      resizeObserver.disconnect();
    };
  }, [cwd]);

  // Re-fit whenever the container resizes is handled by the ResizeObserver in
  // initTerminal; MainLayout unmounts/remounts this panel on toggle, so there is
  // no hidden→visible transition for a live instance to recover from.
  useEffect(() => {
    mountedRef.current = true;
    const cleanup = initTerminal();
    return () => {
      mountedRef.current = false;
      cleanup?.then?.((fn) => fn?.());
      if (sessionIdRef.current) {
        window.api.terminal.close(sessionIdRef.current);
        sessionIdRef.current = null;
      }
      termRef.current?.dispose();
      termRef.current = null;
    };
  }, [cwd, initTerminal]);

  return (
    <div className="flex flex-col h-full bg-editor-bg border-t border-editor-border">
      <div className="flex h-8 items-center justify-between border-b border-editor-border bg-editor-sidebar px-3">
        <span className="text-10 font-semibold uppercase tracking-wide text-muted-foreground">
          终端
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              // Clear only the visible buffer — do NOT close the pty session,
              // which would kill the shell and leave the panel dead.
              termRef.current?.clear();
            }}
            className="flex h-6 w-6 items-center justify-center text-muted-foreground hover:bg-editor-active hover:text-foreground"
            title="清屏"
            aria-label="清屏"
          >
            <Eraser size={14} strokeWidth={1.8} />
          </button>
          <button
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center text-muted-foreground hover:bg-editor-active hover:text-foreground"
            title="关闭终端"
            aria-label="关闭终端"
          >
            <X size={14} strokeWidth={1.8} />
          </button>
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden">
        {terminalUnavailable && (
          <div className="absolute inset-0 flex items-start border-t border-editor-border bg-editor-bg px-3 py-3 font-mono text-xs text-muted-foreground">
            {terminalUnavailable}
          </div>
        )}
        <div
          ref={containerRef}
          className={`absolute inset-0 p-1 overflow-hidden ${terminalUnavailable ? 'invisible' : ''}`}
        />
      </div>
    </div>
  );
}
