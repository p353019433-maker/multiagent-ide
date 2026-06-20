/**
 * Parallel implementation orchestration (Phase 3a of the multi-agent system).
 *
 * After the round-table converges on a unified plan, every API-backed agent
 * implements it in its OWN git worktree (reusing the headless task loop), so
 * their diffs can be compared and one adopted. Reuses existing git IPC
 * (worktreeAdd / diff / worktreeMerge / worktreeRemove) — no new main service.
 *
 * Login-only CLI shells (Claude Code / Codex own-login, Antigravity) are driven
 * by a dedicated CLI service in a later step (Phase 3b); here we run the agents
 * that have a backing API connection via `runHeadlessTask`.
 */

import { runHeadlessTask } from './headlessTaskRunner';
import type { DiscussionAgent } from './agentDiscussion';

export type ImplStatus = 'running' | 'ok' | 'failed';

export interface ImplementationResult {
  agent: DiscussionAgent;
  branch: string;
  worktreePath: string;
  status: ImplStatus;
  diff: string;
  editedFiles: string[];
  note?: string;
  error?: string;
}

export interface RunImplementationParams {
  agents: DiscussionAgent[];
  plan: string;
  rootPath: string;
  /** Short tag for branch names (e.g. a uuid slice). */
  tag: string;
  onUpdate?: (r: ImplementationResult) => void;
}

export function implBranch(tag: string, index: number): string {
  return `ma-${tag}-${index + 1}`;
}

export function worktreePathFor(rootPath: string, branch: string): string {
  const parent = rootPath.endsWith('/') ? rootPath.slice(0, -1) : rootPath;
  return `${parent}_wt/${branch}`;
}

/** Each agent implements the plan in its own worktree (in parallel). */
export async function runImplementation(p: RunImplementationParams): Promise<ImplementationResult[]> {
  const base = await window.api.git.currentBranch(p.rootPath).catch(() => '');

  const tasks = p.agents.map(async (agent, i): Promise<ImplementationResult> => {
    const branch = implBranch(p.tag, i);
    const worktreePath = worktreePathFor(p.rootPath, branch);
    const running: ImplementationResult = { agent, branch, worktreePath, status: 'running', diff: '', editedFiles: [] };
    p.onUpdate?.({ ...running });
    try {
      const add = await window.api.git.worktreeAdd(p.rootPath, worktreePath, branch, base || undefined);
      if (!add.success) {
        const failed: ImplementationResult = { ...running, status: 'failed', error: add.message };
        p.onUpdate?.(failed);
        return failed;
      }
      const wt = add.path || worktreePath;
      const task =
        '请在当前工作区实现下面这份已达成共识的方案。只做方案范围内的改动,完成后用一句话说明你改了什么。\n\n' +
        `【统一方案】\n${p.plan}`;
      const res = await runHeadlessTask({ providerId: agent.providerId, model: agent.model, workspaceRoot: wt, task });
      const diff = await window.api.git.diff(wt).catch(() => '');
      const done: ImplementationResult = {
        ...running,
        worktreePath: wt,
        status: 'ok',
        diff,
        editedFiles: res.editedFiles,
        note: res.note,
      };
      p.onUpdate?.(done);
      return done;
    } catch (e) {
      const failed: ImplementationResult = {
        ...running,
        status: 'failed',
        error: e instanceof Error ? e.message : String(e),
      };
      p.onUpdate?.(failed);
      return failed;
    }
  });

  return Promise.all(tasks);
}

/** Commit a worktree's changes and squash-merge its branch into the repo. */
export async function adoptImplementation(
  rootPath: string,
  r: ImplementationResult
): Promise<{ ok: boolean; message: string }> {
  try {
    await window.api.git.stageAll(r.worktreePath);
    await window.api.git.commit(r.worktreePath, `multi-agent: 采用 ${r.agent.name} 的实现`);
    const merged = await window.api.git.worktreeMerge(rootPath, r.branch, 'squash');
    return { ok: merged.success, message: merged.message };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** Remove all worktrees from a run (and their branches). Best-effort. */
export async function cleanupImplementations(rootPath: string, results: ImplementationResult[]): Promise<void> {
  for (const r of results) {
    await window.api.git.worktreeRemove(rootPath, r.worktreePath, r.branch).catch(() => undefined);
  }
}
