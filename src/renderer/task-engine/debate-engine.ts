import { v4 as uuid } from 'uuid';
import type { ChatMessage, ChatResult, DebateConfig, DebateRoleConfig } from '@shared/types';
import {
  createScratchpad,
  mergeScratchpad,
  type Scratchpad,
  type StageName,
} from '@shared/scratchpad';
import {
  buildRolePrompt,
  parseRoleOutput,
  type DebateRoleName,
} from '@shared/roles';
import { runHeadlessTask, type HeadlessTaskResult } from './headlessTaskRunner';

// Re-export the canonical 5-role config types (analyst/proposer/critic/
// synthesizer/executor) so the engine module stays the one import site for
// callers, and keep DebateFullConfig as a backwards-compatible alias of the
// unified DebateConfig (which already includes executor).
export type { DebateConfig, DebateRoleConfig } from '@shared/types';
export type DebateFullConfig = DebateConfig;

/** The 5 discussion stages (execution is separate). */
export const STAGE_SEQUENCE: DebateRoleName[] = [
  'analyst', 'proposer', 'critic', 'proposer', 'synthesizer',
];

export interface DebateStageEvent {
  stage: DebateRoleName;
  /** true when the stage starts, false when it completes. */
  start: boolean;
}

export interface DebateCallbacks {
  onStage?: (e: DebateStageEvent) => void;
  /** Streaming token delta from the current stage's model call. */
  onToken?: (token: string) => void;
  onError?: (message: string) => void;
  signal?: AbortSignal;
}

export interface DebateResult {
  scratchpad: Scratchpad;
  /** Number of model calls made. */
  calls: number;
}

/** Call a single role and merge its output into the scratchpad. */
async function callRole(
  role: DebateRoleName,
  cfg: DebateRoleConfig,
  s: Scratchpad,
  isRevision: boolean,
  cbs: DebateCallbacks
): Promise<Scratchpad> {
  const prompt = buildRolePrompt(role, s, isRevision);
  const messages: ChatMessage[] = [
    { id: uuid(), role: 'user', content: prompt, timestamp: Date.now() },
  ];
  const result: ChatResult = await window.api.ai.chat(cfg.providerId, messages, {
    model: cfg.model,
    temperature: cfg.temperature,
    systemPrompt: ROLE_SYSTEM_BANNER,
  });
  cbs.onToken?.(result.content);
  const patch = parseRoleOutput(role, result.content);
  return mergeScratchpad(s, patch);
}

const ROLE_SYSTEM_BANNER = '你是一个辩论式 AI 系统中的一个角色。严格按照要求的 JSON 格式输出，不要输出多余内容。';

/** Run the 5-stage structured debate. Does NOT run execution. */
export async function runDebate(
  config: DebateConfig,
  initial: Scratchpad,
  cbs: DebateCallbacks
): Promise<DebateResult> {
  let s = initial;
  let calls = 0;
  const stageConfigs: { role: DebateRoleName; cfg: DebateRoleConfig; isRevision: boolean }[] = [
    { role: 'analyst', cfg: config.analyst, isRevision: false },
    { role: 'proposer', cfg: config.proposer, isRevision: false },
    { role: 'critic', cfg: config.critic, isRevision: false },
    { role: 'proposer', cfg: config.proposer, isRevision: true },
    { role: 'synthesizer', cfg: config.synthesizer, isRevision: false },
  ];

  for (const { role, cfg, isRevision } of stageConfigs) {
    if (cbs.signal?.aborted) {
      cbs.onError?.('多角色流程已取消');
      return { scratchpad: s, calls };
    }
    cbs.onStage?.({ stage: role, start: true });
    try {
      s = await callRole(role, cfg, s, isRevision, cbs);
      calls++;
      cbs.onStage?.({ stage: role, start: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      cbs.onError?.(`阶段 ${role} 失败：${msg}`);
      return { scratchpad: s, calls };
    }
  }
  return { scratchpad: s, calls };
}

export interface DebateFullResult extends DebateResult {
  execution?: HeadlessTaskResult;
  /** Path of the isolated worktree where execution ran (for adopt/rollback). */
  worktreePath?: string;
  /** Branch name of the worktree. */
  worktreeBranch?: string;
  /** Base branch the worktree was created from. */
  worktreeBaseBranch?: string;
}

/** Run the 5-stage debate, then execute the final plan in an isolated worktree. */
export async function runDebateFull(
  config: DebateFullConfig,
  request: string,
  workspaceRoot: string,
  cbs: DebateCallbacks
): Promise<DebateFullResult> {
  const debate = await runDebate(config, createScratchpad(request), cbs);
  if (cbs.signal?.aborted) {
    cbs.onError?.('多角色流程已取消');
    return { ...debate };
  }
  if (!debate.scratchpad.final_plan) {
    cbs.onError?.('辩论未产出 final_plan，跳过执行');
    return { ...debate };
  }
  cbs.onStage?.({ stage: 'executor', start: true });

  // Create an isolated worktree so the autonomous executor never mutates the
  // user's main workspace. Mirrors the orchestrate path in TaskContext: the
  // worktree lives at <root>_wt/<branch>, branched off the current branch.
  const branch = `debate-${Date.now()}`;
  const parentDir = workspaceRoot.endsWith('/') ? workspaceRoot.slice(0, -1) : workspaceRoot;
  const wtPath = `${parentDir}_wt/${branch}`;
  let worktreePath: string;
  let baseBranch: string | undefined;
  try {
    try {
      baseBranch = await window.api.git.currentBranch(workspaceRoot);
    } catch {
      baseBranch = undefined;
    }
    const res = await window.api.git.worktreeAdd(workspaceRoot, wtPath, branch, baseBranch);
    if (!res.success) throw new Error(res.message);
    worktreePath = res.path || wtPath;
  } catch (err) {
    cbs.onError?.(`创建 worktree 失败：${err instanceof Error ? err.message : String(err)}`);
    cbs.onStage?.({ stage: 'executor', start: false });
    return { ...debate };
  }

  if (cbs.signal?.aborted) {
    cbs.onError?.('多角色流程已取消');
    cbs.onStage?.({ stage: 'executor', start: false });
    return { ...debate, worktreePath, worktreeBranch: branch, worktreeBaseBranch: baseBranch };
  }

  const taskText = debate.scratchpad.final_plan.steps
    .map((s) => `${s.action} ${s.target}：${s.detail}`)
    .join('\n');
  const execution = await runHeadlessTask({
    providerId: config.executor.providerId,
    model: config.executor.model,
    workspaceRoot: worktreePath,
    task: taskText,
    systemPromptSuffix: `项目背景：${request}\n回滚方案：${debate.scratchpad.final_plan.rollback}`,
    signal: cbs.signal,
  });
  cbs.onStage?.({ stage: 'executor', start: false });
  return { ...debate, execution, worktreePath, worktreeBranch: branch, worktreeBaseBranch: baseBranch };
}
