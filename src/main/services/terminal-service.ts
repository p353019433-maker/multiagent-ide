import { BrowserWindow } from 'electron';
import { v4 as uuid } from 'uuid';
import os from 'os';
import { spawn } from 'child_process';

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

export class TerminalService {
  private sessions = new Map<string, PtySession>();

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
      env: process.env as { [key: string]: string },
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
    for (const session of this.sessions.values()) {
      session.proc.kill();
    }
    this.sessions.clear();
  }

  /** One-shot command execution for Agent's run_command tool. */
  runCommand(cwd: string, command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
      const shell = os.platform() === 'win32' ? 'powershell.exe' : '/bin/bash';
      const args = os.platform() === 'win32' ? ['-Command', command] : ['-c', command];

      const proc = spawn(shell, args, { cwd });
      let stdout = '';
      let stderr = '';

      const timeout = setTimeout(() => {
        proc.kill();
        resolve({ stdout, stderr: stderr + '\n[Command timed out after 60s]', exitCode: -1 });
      }, 60000);

      proc.stdout.on('data', (data) => (stdout += data.toString()));
      proc.stderr.on('data', (data) => (stderr += data.toString()));

      proc.on('close', (code) => {
        clearTimeout(timeout);
        resolve({ stdout, stderr, exitCode: code ?? 0 });
      });

      proc.on('error', (err) => {
        clearTimeout(timeout);
        resolve({ stdout, stderr: err.message, exitCode: -1 });
      });
    });
  }
}
