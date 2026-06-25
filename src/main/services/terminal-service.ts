import { BrowserWindow } from 'electron';
import { v4 as uuid } from 'uuid';
import os from 'os';
import { spawn, ChildProcess } from 'child_process';
import { StringDecoder } from 'string_decoder';

// node-pty is optional: if not available we fall back to a no-op stub.
// This keeps the project runnable without native compilation.
let pty: any = null;
try {
  pty = require('node-pty');
} catch {
  console.warn('[terminal-service] node-pty not available; terminal will be disabled.');
}

interface PtySession {
  id: string;
  proc: any;
}

function safeEnv(): { [key: string]: string } {
  const allowed = new Set(['PATH', 'HOME', 'SHELL', 'TERM', 'LANG', 'LC_ALL', 'TMPDIR', 'USER', 'LOGNAME']);
  const out: { [key: string]: string } = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!value) continue;
    if (allowed.has(key) || key.startsWith('npm_')) out[key] = value;
  }
  return out;
}

interface BackgroundSession {
  id: string;
  proc: ChildProcess;
  output: string;
  running: boolean;
  exitCode: number | null;
  startedAt: number;
  decoder: StringDecoder;
}

/**
 * Kill a child process and its entire process tree.
 *
 * spawn() with a shell (`/bin/bash -c ...`) only gives us the PID of the
 * shell wrapper. Killing just that PID leaves the shell's children
 * (pipelines, `npm run dev`, dev servers) running as orphans. To reap the
 * whole tree we spawn children in their own group (detached) and signal the
 * negative group PID, then escalate SIGTERM → SIGKILL if it doesn't die.
 */
function killProcessTree(proc: ChildProcess | null, graceMs = 1500): void {
  if (!proc || proc.exitCode !== null || proc.signalCode) return;
  try {
    // Signal the negative PID to hit the whole process group.
    if (proc.pid) {
      try {
        process.kill(-proc.pid, 'SIGTERM');
      } catch {
        // ESRCH (group leader gone) or EPERM — fall back to direct kill.
        proc.kill('SIGTERM');
      }
    } else {
      proc.kill('SIGTERM');
    }
    // Escalate to SIGKILL after a grace window for processes that ignore SIGTERM.
    const targetPid = proc.pid;
    setTimeout(() => {
      try {
        if (targetPid) process.kill(-targetPid, 'SIGKILL');
      } catch {
        try {
          proc.kill('SIGKILL');
        } catch {
          /* already dead */
        }
      }
    }, graceMs).unref();
  } catch {
    /* already dead */
  }
}

export class TerminalService {
  private sessions = new Map<string, PtySession>();
  private bgSessions = new Map<string, BackgroundSession>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  /** Whether the interactive terminal (node-pty) is available. */
  isPtyAvailable(): boolean {
    return pty !== null;
  }

  constructor() {
    // Periodically clean up stale background sessions (every 5 minutes).
    this.cleanupTimer = setInterval(() => this.pruneStaleBackgroundSessions(), 5 * 60_000);
    // Don't keep the event loop alive solely for this timer.
    this.cleanupTimer.unref();
  }


  create(cwd: string, win: BrowserWindow): string | null {
    if (!pty) return null;

    const shell =
      os.platform() === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash';

    const id = uuid();
    const proc = pty.spawn(shell, [], {
      name: 'xterm-color',
      cols: 100,
      rows: 30,
      cwd,
      env: safeEnv(),
    });

    proc.onData((data: string) => {
      win.webContents.send('terminal:data', id, data);
    });

    proc.onExit(({ exitCode }: { exitCode: number }) => {
      win.webContents.send('terminal:exit', id, exitCode);
      this.sessions.delete(id);
    });

    this.sessions.set(id, { id, proc });
    return id;
  }

  write(id: string, data: string): void {
    this.sessions.get(id)?.proc.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    this.sessions.get(id)?.proc.resize(cols, rows);
  }

  close(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.proc.kill();
      this.sessions.delete(id);
    }
  }

  closeAll(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    for (const session of this.sessions.values()) {
      try {
        session.proc.kill();
      } catch {
        /* already dead */
      }
    }
    this.sessions.clear();
    // Also kill background sessions (full tree).
    for (const session of this.bgSessions.values()) {
      killProcessTree(session.proc);
    }
    this.bgSessions.clear();
  }

  /**
   * Final teardown on app quit. Unlike closeAll() (which may run repeatedly
   * on macOS where the app survives without windows), dispose() is one-shot
   * and clears the cleanup timer so we don't leave a dangling interval.
   */
  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    for (const session of this.sessions.values()) {
      try {
        session.proc.kill();
      } catch {
        /* already dead */
      }
    }
    this.sessions.clear();
    for (const session of this.bgSessions.values()) {
      killProcessTree(session.proc);
    }
    this.bgSessions.clear();
  }

  /** One-shot command execution for Agent's run_command tool. */
  runCommand(cwd: string, command: string, timeoutMs: number = 60000): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
      const shell = os.platform() === 'win32' ? 'powershell.exe' : '/bin/bash';
      const args = os.platform() === 'win32' ? ['-Command', command] : ['-c', command];

      const proc = spawn(shell, args, { cwd, env: safeEnv(), detached: true });
      let settled = false;
      let stdout = '';
      let stderr = '';

      let timeout: NodeJS.Timeout | null = null;
      if (timeoutMs > 0) {
        timeout = setTimeout(() => {
          killProcessTree(proc);
          if (!settled) {
            settled = true;
            resolve({ stdout, stderr: stderr + '\n[命令超时]', exitCode: -1 });
          }
        }, timeoutMs);
      }

      proc.stdout?.on('data', (data) => (stdout += data.toString()));
      proc.stderr?.on('data', (data) => (stderr += data.toString()));

      proc.on('close', (code) => {
        if (timeout) clearTimeout(timeout);
        if (!settled) {
          settled = true;
          resolve({ stdout, stderr, exitCode: code ?? 0 });
        }
      });

      proc.on('error', (err) => {
        if (timeout) clearTimeout(timeout);
        if (!settled) {
          settled = true;
          resolve({ stdout, stderr: err.message, exitCode: -1 });
        }
      });
    });
  }

  /**
   * Shell-free execution: runs `file` with an argument array directly (no shell
   * interpretation). Use this whenever any argument is untrusted (e.g. file
   * names coming from model/tool input) to avoid command injection.
   */
  runFile(
    cwd: string,
    file: string,
    args: string[],
    timeoutMs: number = 60000
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
      // On Windows, npx/npm are .cmd shims which require shell resolution.
      const isWin = os.platform() === 'win32';
      const proc = spawn(file, args, { cwd, shell: isWin, env: safeEnv() });
      let stdout = '';
      let stderr = '';

      let timeout: NodeJS.Timeout | null = null;
      if (timeoutMs > 0) {
        timeout = setTimeout(() => {
          proc.kill();
          resolve({ stdout, stderr: stderr + '\n[命令超时]', exitCode: -1 });
        }, timeoutMs);
      }

      proc.stdout?.on('data', (data) => (stdout += data.toString()));
      proc.stderr?.on('data', (data) => (stderr += data.toString()));
      proc.on('close', (code) => {
        if (timeout) clearTimeout(timeout);
        resolve({ stdout, stderr, exitCode: code ?? 0 });
      });
      proc.on('error', (err) => {
        if (timeout) clearTimeout(timeout);
        resolve({ stdout, stderr: err.message, exitCode: -1 });
      });
    });
  }

  // ── Background Commands ──

  startBackgroundCommand(cwd: string, command: string): string {
    const shell = os.platform() === 'win32' ? 'powershell.exe' : '/bin/bash';
    const args = os.platform() === 'win32' ? ['-Command', command] : ['-c', command];

    const id = uuid();
    const proc = spawn(shell, args, { cwd, env: safeEnv(), detached: true });
    const session: BackgroundSession = { id, proc, output: '', running: true, exitCode: null, startedAt: Date.now(), decoder: new StringDecoder('utf8') };

    proc.stdout?.on('data', (data: Buffer) => {
      // Use StringDecoder to avoid splitting multi-byte UTF-8 characters
      // across chunk boundaries, which causes mojibake (replacement chars).
      session.output += session.decoder.write(data);
      // Truncate by re-assigning a fresh string to break V8 SlicedString
      // references that would prevent the original large string from being GC'd.
      if (session.output.length > 100_000) {
        session.output = String(session.output.slice(-80_000));
      }
    });
    proc.stderr?.on('data', (data: Buffer) => {
      session.output += session.decoder.write(data);
      if (session.output.length > 100_000) {
        session.output = String(session.output.slice(-80_000));
      }
    });
    proc.on('close', (code) => {
      session.output += `\n[进程已退出，退出码 ${code}]`;
      session.running = false;
      session.exitCode = code ?? 0;
    });
    proc.on('error', (err) => {
      session.output += `\n[错误：${err.message}]`;
      session.running = false;
      session.exitCode = -1;
    });

    this.bgSessions.set(id, session);
    return id;
  }

  getBackgroundOutput(id: string): { output: string; running: boolean; exitCode: number | null } | null {
    const session = this.bgSessions.get(id);
    if (!session) return null;
    return { output: session.output, running: session.running, exitCode: session.exitCode };
  }

  killBackgroundCommand(id: string): boolean {
    const session = this.bgSessions.get(id);
    if (!session) return false;
    killProcessTree(session.proc);
    session.output += '\n[被用户终止]';
    session.running = false;
    this.bgSessions.delete(id);
    return true;
  }

  private pruneStaleBackgroundSessions(): void {
    const MAX_RUNNING_AGE_MS = 30 * 60_000; // 30 minutes for still-running
    const MAX_EXITED_AGE_MS = 5 * 60_000;   // 5 minutes for finished sessions
    const now = Date.now();
    for (const [id, session] of this.bgSessions) {
      if (session.running && now - session.startedAt > MAX_RUNNING_AGE_MS) {
        killProcessTree(session.proc);
        session.output += '\n[后台任务超时自动终止（30分钟）]';
        session.running = false;
        session.exitCode = -1;
        this.bgSessions.delete(id);
      } else if (!session.running && session.exitCode !== null && now - session.startedAt > MAX_EXITED_AGE_MS) {
        // Previously, finished sessions were kept forever because the
        // running check above was the only cleanup path. The completed
        // sessions (up to 100KB output each) now accumulate in memory and
        // are reclaimed 5 minutes after exit so callers still have time
        // to call getBackgroundOutput.
        this.bgSessions.delete(id);
      }
    }
  }
}
