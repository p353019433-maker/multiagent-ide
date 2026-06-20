/**
 * CLI agent driver — spawns a local agent CLI (Claude Code / Codex / Antigravity)
 * headlessly in a worktree to implement a task. The CLI does its own file edits;
 * the caller diffs the worktree afterward.
 *
 * Shell-free: the prompt is passed as a single argv (never through a shell), so
 * a model-authored prompt cannot inject shell commands. The optional backend
 * (baseURL + key) is injected via env for the API-compatible CLIs; an empty
 * backend means the CLI uses its own login (Claude/Codex) or Google login (agy).
 */

import { spawn } from 'child_process';

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

const TIMEOUT_MS = 5 * 60_000; // CLIs are agentic; match agy's default print timeout
const MAX_OUTPUT = 200_000;

/** Build the (file, args, env) for a tool. Throws on an unknown tool. */
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

export class CliAgentService {
  run(p: RunCliAgentParams): Promise<CliAgentResult> {
    return new Promise((resolve) => {
      let cmd: ReturnType<typeof buildCommand>;
      try {
        cmd = buildCommand(p);
      } catch (e) {
        resolve({ ok: false, output: '', error: e instanceof Error ? e.message : String(e) });
        return;
      }
      // No shell: argv array, so the prompt can't inject commands.
      const proc = spawn(cmd.file, cmd.args, { cwd: p.cwd, env: { ...process.env, ...cmd.env } });
      let out = '';
      let err = '';
      const cap = (chunk: Buffer, isErr: boolean) => {
        if (isErr) {
          err += chunk.toString();
          if (err.length > MAX_OUTPUT) err = err.slice(-MAX_OUTPUT);
        } else {
          out += chunk.toString();
          if (out.length > MAX_OUTPUT) out = out.slice(-MAX_OUTPUT);
        }
      };
      proc.stdout?.on('data', (d: Buffer) => cap(d, false));
      proc.stderr?.on('data', (d: Buffer) => cap(d, true));

      const timer = setTimeout(() => {
        proc.kill();
        resolve({ ok: false, output: out, error: (err ? err + '\n' : '') + `[${p.tool} 超时 ${TIMEOUT_MS / 60000} 分钟,已终止]` });
      }, TIMEOUT_MS);

      proc.on('close', (code) => {
        clearTimeout(timer);
        resolve({ ok: code === 0, output: out, error: code === 0 ? undefined : err || `exit ${code}` });
      });
      proc.on('error', (e) => {
        clearTimeout(timer);
        resolve({ ok: false, output: out, error: `无法启动 ${cmd.file}：${e.message}` });
      });
    });
  }
}
