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
import { loadSkillsMenu } from './skills';
import type { AgentKind } from '@shared/types';

/**
 * An agent ready to implement a plan. API agents run via the headless task loop;
 * CLI agents (claude-code / codex / antigravity) are driven by their tool.
 * baseURL/apiKey are an optional custom backend for the CLI shells.
 */
export interface ImplAgent {
  id: string;
  name: string;
  kind: AgentKind;
  model: string;
  providerId?: string;
  baseURL?: string;
  apiKey?: string;
}

export type ImplStatus = 'running' | 'ok' | 'failed';

export interface ImplementationResult {
  agent: ImplAgent;
  branch: string;
  worktreePath: string;
  status: ImplStatus;
  diff: string;
  editedFiles: string[];
  note?: string;
  error?: string;
}

export interface RunImplementationParams {
  agents: ImplAgent[];
  plan: string;
  rootPath: string;
  /** Short tag for branch names (e.g. a uuid slice). */
  tag: string;
  onUpdate?: (r: ImplementationResult) => void;
  /** Fired once per agent implementation attempt with timing + ok/fail. */
  onCall?: (info: { agentId: string; agentName: string; kind: AgentKind; ok: boolean; durationMs: number; error?: string; editedFilesCount: number; diffLength: number }) => void;
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
  // Skills menu (progressive disclosure) shared by every API agent's prompt.
  const skillsSuffix = await loadSkillsMenu(p.rootPath);

  const tasks = p.agents.map(async (agent, i): Promise<ImplementationResult> => {
    const t0 = Date.now();
    const branch = implBranch(p.tag, i);
    const worktreePath = worktreePathFor(p.rootPath, branch);
    const running: ImplementationResult = { agent, branch, worktreePath, status: 'running', diff: '', editedFiles: [] };
    p.onUpdate?.({ ...running });
    try {
      const add = await window.api.git.worktreeAdd(p.rootPath, worktreePath, branch, base || undefined);
      if (!add.success) {
        const failed: ImplementationResult = { ...running, status: 'failed', error: add.message };
        p.onUpdate?.(failed);
        p.onCall?.({ agentId: agent.id, agentName: agent.name, kind: agent.kind, ok: false, durationMs: Date.now() - t0, error: `worktreeAdd: ${add.message}`, editedFilesCount: 0, diffLength: 0 });
        return failed;
      }
      const wt = add.path || worktreePath;
      const task =
        '请在当前工作区实现下面这份已达成共识的方案。只做方案范围内的改动,完成后用一句话说明你改了什么。\n\n' +
        `【统一方案】\n${p.plan}`;

      let editedFiles: string[] = [];
      let note: string | undefined;
      if (agent.kind === 'api') {
        if (!agent.providerId) throw new Error('API 智能体缺少 API 连接');
        const res = await runHeadlessTask({ providerId: agent.providerId, model: agent.model, workspaceRoot: wt, task, systemPromptSuffix: skillsSuffix });
        editedFiles = res.editedFiles;
        note = res.note;
      } else {
        // CLI shell: the tool edits files in the worktree itself.
        const res = await window.api.cliAgent.run(wt, {
          tool: agent.kind,
          prompt: task,
          model: agent.model || undefined,
          baseURL: agent.baseURL,
          apiKey: agent.apiKey,
        });
        if (!res.ok) throw new Error(res.error || `${agent.kind} 执行失败`);
        note = res.output ? res.output.trim().slice(0, 200) : undefined;
      }
      const diff = await window.api.git.diff(wt).catch(() => '');
      const done: ImplementationResult = { ...running, worktreePath: wt, status: 'ok', diff, editedFiles, note };
      p.onUpdate?.(done);
      p.onCall?.({ agentId: agent.id, agentName: agent.name, kind: agent.kind, ok: true, durationMs: Date.now() - t0, editedFilesCount: editedFiles.length, diffLength: diff.length });
      return done;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const failed: ImplementationResult = {
        ...running,
        status: 'failed',
        error: message,
      };
      p.onUpdate?.(failed);
      p.onCall?.({ agentId: agent.id, agentName: agent.name, kind: agent.kind, ok: false, durationMs: Date.now() - t0, error: message, editedFilesCount: 0, diffLength: 0 });
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

/**
 * Integrate multiple agent implementations into one best-of: an integrator agent
 * (the first successful one, or a chosen providerId+model) reads all the diffs,
 * picks the best approach per function/section, and produces a unified final file.
 * Returns a new ImplementationResult on the 'integrated' branch; the caller can
 * adopt it like any other result.
 */
export async function integrateImplementations(
  rootPath: string,
  results: ImplementationResult[],
  plan: string,
  integratorProviderId?: string,
  integratorModel?: string
): Promise<ImplementationResult> {
  const ok = results.filter((r) => r.status === 'ok' && r.diff);
  if (ok.length < 2) throw new Error('需要至少 2 份成功的实现才能整合');

  const integrator = ok[0].agent; // fallback: first successful agent
  const providerId = integratorProviderId ?? integrator.providerId;
  const model = integratorModel ?? integrator.model;
  if (!providerId) throw new Error('整合需要一个 API 连接');

  const branch = 'ma-integrated';
  const worktreePath = worktreePathFor(rootPath, branch);
  const base = await window.api.git.currentBranch(rootPath).catch(() => '');
  const add = await window.api.git.worktreeAdd(rootPath, worktreePath, branch, base || undefined);
  if (!add.success) throw new Error(`无法建 worktree: ${add.message}`);

  const wt = add.path || worktreePath;
  const labelled = ok.map((r) => `### ${r.agent.name} 的改动\n${r.diff}`).join('\n\n');
  const prompt =
    '你是整合 agent。下面是同一任务的多份独立实现的 git diff。整合出一份最优的改动:' +
    '逐个文件、逐个函数取最稳妥/最正确的实现,风格统一、无重复。直接在当前 worktree 改文件,不要解释。\n\n' +
    `【统一方案】\n${plan}\n\n【各 agent 的 diff】\n${labelled}`;

  const skillsSuffix = await loadSkillsMenu(rootPath);
  const res = await runHeadlessTask({ providerId, model, workspaceRoot: wt, task: prompt, systemPromptSuffix: skillsSuffix });
  const diff = await window.api.git.diff(wt).catch(() => '');

  return {
    agent: { id: 'integrated', name: '整合', kind: 'api', providerId, model },
    branch,
    worktreePath: wt,
    status: 'ok',
    diff,
    editedFiles: res.editedFiles,
    note: res.note,
  };
}

