import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

interface Props {
  cwd: string;
}

export default function TerminalPanel({ cwd }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  // Tracks whether the component is still mounted. The pty session is created
  // asynchronously, so without this we'd leak a session if the panel unmounts
  // before `terminal.create` resolves.
  const mountedRef = useRef(true);
  const [visible, setVisible] = useState(true);

  const initTerminal = useCallback(async () => {
    if (!containerRef.current || termRef.current) return;

    const term = new Terminal({
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
      theme: {
        background: '#1e1e1e',
        foreground: '#cccccc',
        cursor: '#ffffff',
        selectionBackground: '#264f78',
        black: '#000000',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
        magenta: '#bc3fbc',
        cyan: '#11a8cd',
        white: '#e5e5e5',
        brightBlack: '#666666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#e5e5e5',
      },
      cursorBlink: true,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitRef.current = fitAddon;

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
  }, [cwd]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col h-full bg-editor-bg border-t border-editor-border">
      <div className="flex items-center justify-between px-3 py-1 bg-editor-sidebar border-b border-editor-border">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
          终端
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              // Clear only the visible buffer — do NOT close the pty session,
              // which would kill the shell and leave the panel dead.
              termRef.current?.clear();
            }}
            className="text-xs px-1.5 py-0.5 rounded hover:bg-editor-active text-gray-400 hover:text-white"
            title="清屏"
          >
            🗑
          </button>
          <button
            onClick={() => setVisible((v) => !v)}
            className="text-xs px-1.5 py-0.5 rounded hover:bg-editor-active text-gray-400 hover:text-white"
            title={visible ? '收起终端' : '展开终端'}
          >
            {visible ? '▼' : '▲'}
          </button>
        </div>
      </div>

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
    </div>
  );
}