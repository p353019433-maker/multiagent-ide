import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Eraser, X } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';

interface Props {
  cwd: string;
  onClose: () => void;
}

/**
 * Terminal panel backed by a node-pty session.
 *
 * The pty/terminal lifecycle is tricky: `terminal.create` is async, the pty
 * can exit before our ref is set, and the panel can unmount mid-init. To make
 * all of these safe we:
 *   - assign `sessionIdRef` synchronously the moment the pty id resolves, so
 *     `onExit` is never lost,
 *   - guard the whole teardown with a single `disposedRef` so a late-resolving
 *     init never touches a disposed term/pty,
 *   - run all teardown synchronously in the effect cleanup (no Promise return),
 *     so an unmount immediately kills the session without waiting on init.
 */
export default function TerminalPanel({ cwd, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  // Teardown resources captured during init; the effect cleanup runs these
  // synchronously, so they must be ref-stored rather than returned.
  const unsubDataRef = useRef<() => void>(() => {});
  const unsubExitRef = useRef<() => void>(() => {});
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  // Set to true the moment the effect cleanup begins. Any async init still in
  // flight after this point must NOT touch the term/pty.
  const disposedRef = useRef(false);
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

  useEffect(() => {
    disposedRef.current = false;
    // `cancelled` guards the window between unmount and the async create()
    // resolving: if it resolves after we've torn down, we must still close the
    // pty we created but must NOT wire it into the (now-disposed) term.
    let cancelled = false;

    (async () => {
      setTerminalUnavailable('');
      const id = await window.api.terminal.create(cwd).catch(() => null);
      if (cancelled) {
        // Unmounted during create — still release the pty if we got one.
        if (id) window.api.terminal.close(id).catch(() => undefined);
        return;
      }
      if (!id) {
        setTerminalUnavailable('终端不可用（node-pty 未加载）');
        return;
      }
      if (!containerRef.current || disposedRef.current) {
        window.api.terminal.close(id).catch(() => undefined);
        return;
      }

      // Assign the session ref BEFORE opening the term / registering onExit,
      // so an early pty exit is observed instead of dropped.
      sessionIdRef.current = id;

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

      unsubDataRef.current = unsubData;
      unsubExitRef.current = unsubExit;
      resizeObserverRef.current = resizeObserver;
    })();

    return () => {
      // Synchronous teardown. By setting these flags first, any still-pending
      // init (awaiting create()) will self-cancel on its next tick.
      cancelled = true;
      disposedRef.current = true;

      unsubDataRef.current();
      unsubExitRef.current();
      resizeObserverRef.current?.disconnect();

      if (sessionIdRef.current) {
        window.api.terminal.close(sessionIdRef.current).catch(() => undefined);
        sessionIdRef.current = null;
      }

      termRef.current?.dispose();
      termRef.current = null;
      fitRef.current = null;

      // Reset the captured teardown handles so a subsequent mount starts clean.
      unsubDataRef.current = () => {};
      unsubExitRef.current = () => {};
      resizeObserverRef.current = null;
    };
  }, [cwd]);

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
