import { v4 as uuid } from 'uuid';
import type { ChatMessage, ChatResult } from '@shared/types';
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

export interface RoleCallConfig {
  providerId: string;
  model: string;
  temperature?: number;
}

export interface DebateConfig {
  analyst: RoleCallConfig;
  proposer: RoleCallConfig;
  critic: RoleCallConfig;
  synthesizer: RoleCallConfig;
}

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
}

export interface DebateResult {
  scratchpad: Scratchpad;
  /** Number of model calls made. */
  calls: number;
}

/** Call a single role and merge its output into the scratchpad. */
async function callRole(
  role: DebateRoleName,
  cfg: RoleCallConfig,
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
  const stageConfigs: { role: DebateRoleName; cfg: RoleCallConfig; isRevision: boolean }[] = [
    { role: 'analyst', cfg: config.analyst, isRevision: false },
    { role: 'proposer', cfg: config.proposer, isRevision: false },
    { role: 'critic', cfg: config.critic, isRevision: false },
    { role: 'proposer', cfg: config.proposer, isRevision: true },
    { role: 'synthesizer', cfg: config.synthesizer, isRevision: false },
  ];

  for (const { role, cfg, isRevision } of stageConfigs) {
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

export interface DebateFullConfig extends DebateConfig {
  executor: RoleCallConfig;
}

export interface DebateFullResult extends DebateResult {
  execution?: HeadlessTaskResult;
}

/** Run the 5-stage debate, then execute the final plan in a worktree. */
export async function runDebateFull(
  config: DebateFullConfig,
  request: string,
  workspaceRoot: string,
  cbs: DebateCallbacks
): Promise<DebateFullResult> {
  const debate = await runDebate(config, createScratchpad(request), cbs);
  if (!debate.scratchpad.final_plan) {
    cbs.onError?.('辩论未产出 final_plan，跳过执行');
    return { ...debate };
  }
  cbs.onStage?.({ stage: 'executor', start: true });
  const taskText = debate.scratchpad.final_plan.steps
    .map((s) => `${s.action} ${s.target}：${s.detail}`)
    .join('\n');
  const execution = await runHeadlessTask({
    providerId: config.executor.providerId,
    model: config.executor.model,
    workspaceRoot,
    task: taskText,
    systemPromptSuffix: `项目背景：${request}\n回滚方案：${debate.scratchpad.final_plan.rollback}`,
  });
  cbs.onStage?.({ stage: 'executor', start: false });
  return { ...debate, execution };
}
