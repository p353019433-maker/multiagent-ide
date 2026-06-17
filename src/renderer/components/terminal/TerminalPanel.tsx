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
<<<<<<< HEAD
  // Tracks whether the component is still mounted. The pty session is created
  // asynchronously, so without this we'd leak a session if the panel unmounts
  // before `terminal.create` resolves.
  const mountedRef = useRef(true);
  const [visible, setVisible] = useState(true);
=======
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
>>>>>>> claude/review-repo-contents-tkoLx

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
<<<<<<< HEAD

    const id = await window.api.terminal.create(cwd);
    // If the panel unmounted while we were creating the pty, tear down
    // everything we just built so neither the term nor the pty leaks.
    if (!mountedRef.current) {
      if (id) window.api.terminal.close(id);
      term.dispose();
      return;
    }
    if (!id) {
      term.writeln('\r\n⚠️  终端不可用（node-pty 未加载）');
      return;
    }
=======
>>>>>>> claude/review-repo-contents-tkoLx
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

  // Re-fit the terminal whenever it becomes visible again — xterm measures its
  // dimensions from the DOM, and while hidden (display:none) those are zero.
  useEffect(() => {
    if (!visible) return;
    const fit = fitRef.current;
    const term = termRef.current;
    const sid = sessionIdRef.current;
    if (!fit || !term) return;
    try {
      fit.fit();
      if (sid) window.api.terminal.resize(sid, term.cols, term.rows);
    } catch {
      // term not ready yet — ResizeObserver will handle it once mounted
    }
  }, [visible]);

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
<<<<<<< HEAD
              // Clear only the visible buffer — do NOT close the pty session,
              // which would kill the shell and leave the panel dead.
=======
>>>>>>> claude/review-repo-contents-tkoLx
              termRef.current?.clear();
            }}
            className="flex h-6 w-6 items-center justify-center text-muted-foreground hover:bg-editor-active hover:text-foreground"
            title="清屏"
            aria-label="清屏"
          >
            <Eraser size={14} strokeWidth={1.8} />
          </button>
          <button
<<<<<<< HEAD
            onClick={() => setVisible((v) => !v)}
            className="text-xs px-1.5 py-0.5 rounded hover:bg-editor-active text-gray-400 hover:text-white"
            title={visible ? '收起终端' : '展开终端'}
=======
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center text-muted-foreground hover:bg-editor-active hover:text-foreground"
            title="关闭终端"
            aria-label="关闭终端"
>>>>>>> claude/review-repo-contents-tkoLx
          >
            <X size={14} strokeWidth={1.8} />
          </button>
        </div>
      </div>

<<<<<<< HEAD
      {/*
        The terminal container is always mounted; visibility toggles via CSS.
        Conditionally unmounting it would discard the DOM node xterm rendered
        into, leaving a blank panel after collapse/expand.
      */}
      <div
        ref={containerRef}
        className="flex-1 p-1 overflow-hidden"
        style={{ display: visible ? 'block' : 'none' }}
      />
=======
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
>>>>>>> claude/review-repo-contents-tkoLx
    </div>
  );
}
