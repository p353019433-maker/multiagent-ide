/**
 * CLI agent driver — spawns a local agent CLI (Claude Code / Codex / Antigravity)
 * headlessly in a worktree to implement a task. The CLI does its own file edits;
 * the caller diffs the worktree afterward.
 *
 * Shell-free: the prompt is passed as a single argv (never through a shell), so
 * a model-authored prompt cannot inject shell commands. The optional backend
 * (baseURL + key) is injected via env for the API-compatible CLIs; an empty
 * backend means the CLI uses its own login (Claude/Codex) or Google login (agy).
 *
 * Two surfaces:
 *  - `run()`         — fire-and-forget Promise that resolves with the full
 *                      stdout/stderr/exit. Backwards-compatible with every
 *                      existing caller. Internally driven by `runStream()`.
 *  - `runStream()`   — event-driven (onStart/onStdout/onStderr/onExit/onError)
 *                      so the UI can show live token deltas, tool-call notices,
 *                      and — crucially — fail fast on connection problems
 *                      instead of silently hanging for the full timeout.
 *
 * Connection diagnostics (the old "silently hangs 5 min" failure mode):
 *   - ENOENT on spawn              → "未安装 <binary>"
 *   - stderr matches login/auth    → "未登录 <tool>"  (within 2s of start)
 *   - 30s after start, 0 stdout    → "CLI 启动后无响应，可能未登录或网络问题"
 *   - exit non-zero                → stderr head + exit code
 *   - timeout (default 5 min)      → SIGTERM the process, surface a clear msg
 *
 * Cancellation: pass an AbortSignal. `runStream` SIGTERMs the subprocess and
 * resolves with an aborted error — no orphan processes (the old fire-and-forget
 * race that left `claude`/`codex` running after the renderer gave up).
 */

import { spawn, type ChildProcess } from 'child_process';

export type CliAgentTool = 'claude-code' | 'codex' | 'antigravity';

export interface RunCliAgentParams {
  tool: CliAgentTool;
  /** Worktree to run in (already path-validated by the IPC layer). */
  cwd: string;
  prompt: string;
  model?: string;
  /** Custom API backend for claude-code/codex; empty = the CLI's own login. */
  baseURL?: string;
  apiKey?: string;
}

export interface CliAgentResult {
  ok: boolean;
  output: string;
  error?: string;
}

/** Per-tool binary + argv + env. Throws on an unknown tool. */
function buildCommand(p: RunCliAgentParams): { file: string; args: string[]; env: Record<string, string> } {
  const env: Record<string, string> = {};
  switch (p.tool) {
    case 'claude-code': {
      const args = ['-p', p.prompt, '--dangerously-skip-permissions'];
      if (p.model) args.push('--model', p.model);
      if (p.baseURL) {
        env.ANTHROPIC_BASE_URL = p.baseURL;
        if (p.apiKey) env.ANTHROPIC_API_KEY = p.apiKey;
        if (p.model) env.ANTHROPIC_MODEL = p.model;
      }
      return { file: 'claude', args, env };
    }
    case 'antigravity': {
      const args = ['-p', p.prompt, '--add-dir', p.cwd, '--dangerously-skip-permissions'];
      if (p.model) args.push('--model', p.model);
      return { file: 'agy', args, env }; // Google login; no API backend
    }
    case 'codex': {
      const args = ['exec', '--dangerously-bypass-approvals-and-sandbox', '-C', p.cwd];
      if (p.model) args.push('-m', p.model);
      args.push(p.prompt);
      if (p.baseURL) {
        env.OPENAI_BASE_URL = p.baseURL;
        if (p.apiKey) env.OPENAI_API_KEY = p.apiKey;
      }
      return { file: 'codex', args, env };
    }
    default:
      throw new Error(`未知 CLI agent: ${(p as { tool?: string }).tool}`);
  }
}

const DEFAULT_TIMEOUT_MS = 5 * 60_000; // CLIs are agentic; match agy's default print timeout
const MAX_OUTPUT = 200_000;
/** If we see this in stderr within 2s of spawn, it's an auth/login failure. */
const AUTH_PATTERN = /not authenticated|not logged in|unauthorized|please (login|sign in|run .* login)|no (api )?key|401|invalid api key/i;
/** Window after start during which auth-pattern stderr is treated as "未登录". */
const AUTH_WINDOW_MS = 2_000;
/** If no stdout at all by this point, the CLI is almost certainly stuck on
 *  login or network — fail fast instead of waiting the full timeout. */
const SILENCE_GUARD_MS = 30_000;

export interface CliAgentStreamCallbacks {
  /** Fired once spawn() succeeded (the binary was found). */
  onStart?: () => void;
  /** Incremental stdout chunk (already string-decoded). */
  onStdout?: (chunk: string) => void;
  /** Incremental stderr chunk. */
  onStderr?: (chunk: string) => void;
  /** Fired when the process exits. `code` is null if terminated by signal. */
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
  /** Fired on a classified error (auth/missing/silent/timeout/exit-nonzero).
   *  After this fires the promise resolves; onExit may or may not also fire. */
  onError?: (kind: CliAgentErrorKind, message: string) => void;
}

export type CliAgentErrorKind =
  | 'missing'      // binary not found (ENOENT)
  | 'unauth'       // not logged in / no API key
  | 'silent'       // started but no stdout within SILENCE_GUARD_MS
  | 'timeout'      // exceeded the timeout, SIGTERM'd
  | 'aborted'      // caller aborted via AbortSignal
  | 'exit'         // exited non-zero
  | 'spawn';       // other spawn error

/** Human-readable Chinese label per error kind, for the UI. */
export const CLI_ERROR_LABEL: Record<CliAgentErrorKind, string> = {
  missing: '未安装',
  unauth: '未登录',
  silent: '无响应',
  timeout: '超时',
  aborted: '已取消',
  exit: '执行失败',
  spawn: '启动失败',
};

/** Friendly tool name for messages. */
const TOOL_LABEL: Record<CliAgentTool, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  antigravity: 'Antigravity',
};

export class CliAgentService {
  /**
   * Event-driven run. Arrow-function property so `this` is bound to the
   * instance regardless of how the caller invokes it (ipcMain.handle passes
   * the method as a bare function reference, which would otherwise lose
   * `this` and throw "svc.runStream is not a function").
   *
   * Resolves with the final `CliAgentResult` once the process exits or is
   * terminated. Callbacks fire incrementally. Pass an AbortSignal to cancel:
   * the subprocess gets SIGTERM and the promise resolves with an `aborted`
   * error.
   */
  runStream = (
    p: RunCliAgentParams,
    cb: CliAgentStreamCallbacks = {},
    opts: { timeoutMs?: number; signal?: AbortSignal } = {}
  ): Promise<CliAgentResult> => {
    return new Promise((resolve) => {
      let cmd: ReturnType<typeof buildCommand>;
      try {
        cmd = buildCommand(p);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        cb.onError?.('spawn', message);
        resolve({ ok: false, output: '', error: message });
        return;
      }

      const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      let proc: ChildProcess | null = null;
      let out = '';
      let err = '';
      let settled = false;
      const startedAt = Date.now();
      let stdoutSeen = false;
      let silenceTimer: ReturnType<typeof setTimeout> | null = null;
      let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
      let authWindowActive = true;

      const finish = (result: CliAgentResult) => {
        if (settled) return;
        settled = true;
        if (silenceTimer) clearTimeout(silenceTimer);
        if (timeoutTimer) clearTimeout(timeoutTimer);
        // Make sure the proc is really gone (defensive — onExit already fired
        // in the normal path, but if we're here via timeout/abort the close
        // event may not have arrived yet).
        try { proc?.kill('SIGKILL'); } catch { /* already dead */ }
        resolve(result);
      };

      const cap = (chunk: Buffer, isErr: boolean) => {
        const text = chunk.toString();
        if (isErr) {
          err += text;
          if (err.length > MAX_OUTPUT) err = err.slice(-MAX_OUTPUT);
          cb.onStderr?.(text);
          // Auth detection: only during the startup window.
          if (authWindowActive && AUTH_PATTERN.test(text)) {
            const msg = `${TOOL_LABEL[p.tool]} 未登录或 API key 无效。请先在终端运行相应命令登录：` +
              (p.tool === 'claude-code' ? 'claude' : p.tool === 'codex' ? 'codex login' : 'agy');
            cb.onError?.('unauth', msg);
            try { proc?.kill('SIGTERM'); } catch { /* */ }
          }
        } else {
          out += text;
          if (out.length > MAX_OUTPUT) out = out.slice(-MAX_OUTPUT);
          if (!stdoutSeen) {
            stdoutSeen = true;
            if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
          }
          cb.onStdout?.(text);
        }
      };

      try {
        proc = spawn(cmd.file, cmd.args, { cwd: p.cwd, env: { ...process.env, ...cmd.env } });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        cb.onError?.('spawn', `无法启动 ${cmd.file}：${message}`);
        resolve({ ok: false, output: '', error: message });
        return;
      }

      cb.onStart?.();

      // ENOENT comes through 'error', not via throw on spawn in some Node versions.
      proc.on('error', (e: NodeJS.ErrnoException) => {
        if (settled) return;
        if (e.code === 'ENOENT') {
          const msg = `未安装 ${cmd.file}（${TOOL_LABEL[p.tool]}）。请先安装：` +
            (p.tool === 'claude-code' ? 'npm i -g @anthropic-ai/claude-code' :
             p.tool === 'codex' ? 'npm i -g @openai/codex' :
             '参见 Antigravity 安装指引');
          cb.onError?.('missing', msg);
          finish({ ok: false, output: out, error: msg });
        } else {
          const msg = `启动 ${cmd.file} 失败：${e.message}`;
          cb.onError?.('spawn', msg);
          finish({ ok: false, output: out, error: msg });
        }
      });

      proc.stdout?.on('data', (d: Buffer) => cap(d, false));
      proc.stderr?.on('data', (d: Buffer) => cap(d, true));

      // Close the auth-detection window shortly after start — late stderr
      // that happens to match the pattern is usually a real runtime error,
      // not a login failure.
      setTimeout(() => { authWindowActive = false; }, AUTH_WINDOW_MS);

      // Silence guard: if no stdout by 30s, the CLI is stuck (login/network).
      // Fail fast with a clear message instead of waiting 5 min.
      silenceTimer = setTimeout(() => {
        if (!settled && !stdoutSeen) {
          const msg = `${TOOL_LABEL[p.tool]} 启动后 ${Math.round(SILENCE_GUARD_MS / 1000)}s 内无任何输出，可能未登录或网络不通。` +
            (err ? `\nstderr: ${err.slice(0, 500)}` : '');
          cb.onError?.('silent', msg);
          try { proc?.kill('SIGTERM'); } catch { /* */ }
        }
      }, SILENCE_GUARD_MS);

      // Hard timeout.
      timeoutTimer = setTimeout(() => {
        if (!settled) {
          const msg = `${TOOL_LABEL[p.tool]} 超时 ${Math.round(timeoutMs / 60000)} 分钟，已终止。` +
            (err ? `\nstderr: ${err.slice(0, 500)}` : '');
          cb.onError?.('timeout', msg);
          try { proc?.kill('SIGTERM'); } catch { /* */ }
          // Give it a moment to exit cleanly before SIGKILL; finish() will
          // fire from the close handler if it exits, otherwise force-kill.
          setTimeout(() => finish({ ok: false, output: out, error: msg }), 1500);
        }
      }, timeoutMs);

      proc.on('close', (code, signal) => {
        cb.onExit?.(code, signal);
        if (settled) return;
        if (code === 0) {
          finish({ ok: true, output: out });
        } else if (signal === 'SIGTERM' || signal === 'SIGKILL') {
          // Killed by our timeout/abort/silence guard — the onError callback
          // already fired with a specific message; don't overwrite it.
          finish({ ok: false, output: out, error: err || `signal ${signal}` });
        } else {
          const msg = `${TOOL_LABEL[p.tool]} 退出码 ${code}` + (err ? `：${err.slice(0, 500)}` : '');
          cb.onError?.('exit', msg);
          finish({ ok: false, output: out, error: msg });
        }
      });

      // AbortSignal support — real cancellation, not just renderer giving up.
      if (opts.signal) {
        if (opts.signal.aborted) {
          const msg = `${TOOL_LABEL[p.tool]} 已取消`;
          cb.onError?.('aborted', msg);
          try { proc.kill('SIGTERM'); } catch { /* */ }
          setTimeout(() => finish({ ok: false, output: out, error: msg }), 500);
        } else {
          opts.signal.addEventListener('abort', () => {
            if (settled) return;
            const msg = `${TOOL_LABEL[p.tool]} 已取消`;
            cb.onError?.('aborted', msg);
            try { proc?.kill('SIGTERM'); } catch { /* */ }
            setTimeout(() => finish({ ok: false, output: out, error: msg }), 500);
          }, { once: true });
        }
      }

      // Mark the proc as not leaked if we somehow exit the promise without
      // a close event (defensive).
      void startedAt;
    });
  }

  /**
   * Backwards-compatible synchronous run. Returns the full output once the
   * process exits or is terminated. Internally driven by `runStream()`, so
   * all the diagnostics (auth/missing/silent/timeout) apply equally.
   */
  run(p: RunCliAgentParams, opts: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<CliAgentResult> {
    return this.runStream(p, {}, opts);
  }
}
