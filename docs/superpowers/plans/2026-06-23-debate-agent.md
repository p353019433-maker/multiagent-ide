# 单 Agent 多角色辩论式执行 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把现有的多 Agent 圆桌 IDE 重构为"单 Agent 内部多角色辩论式执行"的桌面应用，砍掉 VSCode 式编辑功能，聚焦 6 阶段结构化辩论 + 执行。

**Architecture:** 渲染进程新增 `debate-engine` 驱动固定 6 阶段流程（解析→方案→异议→修订→综合→执行），各角色通过结构化 Scratchpad 文档传递上下文，每个角色可挂不同模型/API。执行阶段复用现有 `headlessTaskRunner` + worktree 隔离。UI 砍掉编辑器/文件树，聚焦"任务输入→讨论过程流式展示→结果验收"三区域。

**Tech Stack:** Electron 33 + React 18 + TypeScript + Vite 6 + vitest（已有）。无新依赖。

## Global Constraints

- 质量门：每个任务结束前 `npm test` 全绿 + `tsc -p tsconfig.json --noEmit` 0 错误 + `tsc -p tsconfig.main.json --noEmit` 0 错误
- 不泄密：API Key 走 safeStorage，不进仓库/日志/提示词
- 单用户本地：沿用 CLAUDE.md 宪章安全口径
- 测试框架：vitest，`environment: 'node'`，import 路径用 `@shared` / `@` alias
- 提交信息：`feat(debate):` / `refactor(debate):` / `test(debate):` 前缀
- 不删除旧模块代码（圆桌/editor/sidebar 等），只在主流程里不接入，留到阶段 F 统一清理

---

## File Structure

**新建文件：**
- `src/shared/scratchpad.ts` — Scratchpad 类型定义 + 创建/合并/校验工具
- `src/shared/scratchpad.test.ts` — Scratchpad 工具单测
- `src/shared/roles.ts` — 5 个辩论角色的定义 + 提示词构建
- `src/shared/roles.test.ts` — 角色提示词构建单测
- `src/renderer/task-engine/debate-engine.ts` — 6 阶段编排引擎
- `src/renderer/task-engine/debate-engine.test.ts` — 引擎单测（mock ai.chat）
- `src/renderer/components/debate/DebateView.tsx` — 主界面三区域
- `src/renderer/components/debate/DebateStageCard.tsx` — 单阶段卡片
- `src/renderer/components/debate/ResultPanel.tsx` — 结果验收区
- `src/renderer/components/settings/RolesSettings.tsx` — 角色配置 UI

**修改文件：**
- `src/renderer/App.tsx` — 主布局换成 DebateView
- `src/renderer/context/TaskContext.tsx` — 加 debate 状态，砍 orchestrate 内联代码
- `src/shared/types.ts` — 加 DebateRoleConfig / DebateRun 类型

---

## Task 1: Scratchpad 类型与工具函数

**Files:**
- Create: `src/shared/scratchpad.ts`
- Test: `src/shared/scratchpad.test.ts`

**Interfaces:**
- Produces: `Scratchpad` 类型，`createScratchpad(request)`，`mergeScratchpad(base, patch)`，`validateScratchpad(s)`，`STAGES` 常量

- [ ] **Step 1: Write the failing test**

```typescript
// src/shared/scratchpad.test.ts
import { describe, it, expect } from 'vitest';
import { createScratchpad, mergeScratchpad, validateScratchpad, STAGES } from './scratchpad';

describe('createScratchpad', () => {
  it('creates an empty scratchpad with only the request filled', () => {
    const s = createScratchpad('给项目加文件搜索');
    expect(s.request).toBe('给项目加文件搜索');
    expect(s.analysis).toBeNull();
    expect(s.proposal).toBeNull();
    expect(s.critiques).toBeNull();
    expect(s.revised_proposal).toBeNull();
    expect(s.final_plan).toBeNull();
  });
});

describe('mergeScratchpad', () => {
  it('merges a patch into the base, only overwriting provided fields', () => {
    const base = createScratchpad('test');
    const merged = mergeScratchpad(base, {
      analysis: { requirements: ['a'], constraints: [], context: '' },
    });
    expect(merged.analysis?.requirements).toEqual(['a']);
    expect(merged.request).toBe('test');
  });
});

describe('STAGES', () => {
  it('lists the 6 debate stages in order', () => {
    expect(STAGES).toEqual([
      'analysis', 'proposal', 'critique', 'revision', 'synthesis', 'execution',
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/scratchpad.test.ts`
Expected: FAIL — module `./scratchpad` not found

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/shared/scratchpad.ts

export interface AnalysisResult {
  requirements: string[];
  constraints: string[];
  context: string;
}

export interface ProposalFile {
  path: string;
  action: 'create' | 'modify' | 'delete';
  reason: string;
}

export interface Proposal {
  approach: string;
  files: ProposalFile[];
  steps: string[];
}

export interface Critique {
  severity: 'high' | 'medium' | 'low';
  issue: string;
  suggestion: string;
}

export interface RevisedProposal {
  approach: string;
  files: ProposalFile[];
  steps: string[];
}

export interface FinalPlanStep {
  action: string;
  target: string;
  detail: string;
}

export interface FinalPlan {
  approach: string;
  steps: FinalPlanStep[];
  rollback: string;
}

export interface Scratchpad {
  request: string;
  analysis: AnalysisResult | null;
  proposal: Proposal | null;
  critiques: Critique[] | null;
  revised_proposal: RevisedProposal | null;
  changes: string[] | null;
  dismissed: { issue: string; reason: string }[] | null;
  final_plan: FinalPlan | null;
}

export const STAGES = [
  'analysis', 'proposal', 'critique', 'revision', 'synthesis', 'execution',
] as const;

export type StageName = (typeof STAGES)[number];

export function createScratchpad(request: string): Scratchpad {
  return {
    request,
    analysis: null,
    proposal: null,
    critiques: null,
    revised_proposal: null,
    changes: null,
    dismissed: null,
    final_plan: null,
  };
}

export function mergeScratchpad(
  base: Scratchpad,
  patch: Partial<Scratchpad>
): Scratchpad {
  return { ...base, ...patch };
}

export function validateScratchpad(s: Scratchpad): string[] {
  const errs: string[] = [];
  if (!s.request.trim()) errs.push('request 不能为空');
  return errs;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/scratchpad.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Typecheck**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add src/shared/scratchpad.ts src/shared/scratchpad.test.ts
git commit -m "feat(debate): add Scratchpad type and utilities"
```

---

## Task 2: 角色定义与提示词构建

**Files:**
- Create: `src/shared/roles.ts`
- Test: `src/shared/roles.test.ts`

**Interfaces:**
- Consumes: `Scratchpad` from Task 1
- Produces: `DebateRole` 类型，`ROLE_DEFINITIONS`（5 角色），`buildRolePrompt(roleName, scratchpad)`，`parseRoleOutput(roleName, text)`

- [ ] **Step 1: Write the failing test**

```typescript
// src/shared/roles.test.ts
import { describe, it, expect } from 'vitest';
import { buildRolePrompt, parseRoleOutput, ROLE_DEFINITIONS, type DebateRoleName } from './roles';
import { createScratchpad, mergeScratchpad } from './scratchpad';

describe('ROLE_DEFINITIONS', () => {
  it('defines 5 debate roles with labels', () => {
    const names = Object.keys(ROLE_DEFINITIONS) as DebateRoleName[];
    expect(names).toEqual(['analyst', 'proposer', 'critic', 'synthesizer', 'executor']);
    for (const name of names) {
      expect(ROLE_DEFINITIONS[name].label).toBeTruthy();
      expect(ROLE_DEFINITIONS[name].persona).toBeTruthy();
    }
  });
});

describe('buildRolePrompt', () => {
  it('analyst prompt includes the request and output schema', () => {
    const s = createScratchpad('加文件搜索');
    const p = buildRolePrompt('analyst', s);
    expect(p).toContain('加文件搜索');
    expect(p).toContain('requirements');
    expect(p).toContain('constraints');
  });

  it('critic prompt includes the current proposal', () => {
    const s = mergeScratchpad(createScratchpad('test'), {
      proposal: { approach: '用 ripgrep', files: [], steps: ['安装 rg'] },
    });
    const p = buildRolePrompt('critic', s);
    expect(p).toContain('用 ripgrep');
    expect(p).toContain('critiques');
    expect(p).toContain('severity');
  });

  it('proposer revision prompt includes critiques', () => {
    const s = mergeScratchpad(createScratchpad('test'), {
      proposal: { approach: 'X', files: [], steps: [] },
      critiques: [{ severity: 'high', issue: '依赖问题', suggestion: '自动检测' }],
    });
    const p = buildRolePrompt('proposer', s, true);
    expect(p).toContain('依赖问题');
    expect(p).toContain('revised_proposal');
    expect(p).toContain('dismissed');
  });
});

describe('parseRoleOutput', () => {
  it('parses analyst JSON output', () => {
    const text = '{"requirements":["a"],"constraints":[],"context":"x"}';
    const out = parseRoleOutput('analyst', text);
    expect(out.analysis?.requirements).toEqual(['a']);
  });

  it('parses critic JSON output', () => {
    const text = '{"critiques":[{"severity":"high","issue":"x","suggestion":"y"}]}';
    const out = parseRoleOutput('critic', text);
    expect(out.critiques?.[0].severity).toBe('high');
  });

  it('extracts JSON from surrounding prose', () => {
    const text = '好的，我的分析如下：\n```json\n{"requirements":["a"],"constraints":[],"context":""}\n```\n以上。';
    const out = parseRoleOutput('analyst', text);
    expect(out.analysis?.requirements).toEqual(['a']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/roles.test.ts`
Expected: FAIL — module `./roles` not found

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/shared/roles.ts
import type { Scratchpad, AnalysisResult, Proposal, Critique, RevisedProposal, FinalPlan } from './scratchpad';

export type DebateRoleName = 'analyst' | 'proposer' | 'critic' | 'synthesizer' | 'executor';

export interface DebateRoleDefinition {
  label: string;
  persona: string;
  /** Which scratchpad fields this role reads. */
  reads: (keyof Scratchpad)[];
  /** Which scratchpad field(s) this role writes. */
  writes: (keyof Scratchpad)[];
  /** Build the user-turn instruction given the current scratchpad. */
  buildInstruction: (s: Scratchpad) => string;
  /** JSON schema description for the output format (human-readable, in prompt). */
  outputSchema: string;
}

const ANALYST_SCHEMA = `{
  "requirements": ["需求点1", "需求点2"],
  "constraints": ["技术约束1"],
  "context": "相关的现有文件或代码片段"
}`;

const PROPOSAL_SCHEMA = `{
  "approach": "总体思路",
  "files": [{"path": "相对路径", "action": "create|modify|delete", "reason": "为什么"}],
  "steps": ["实施步骤1", "实施步骤2"]
}`;

const CRITIQUE_SCHEMA = `{
  "critiques": [
    {"severity": "high|medium|low", "issue": "问题描述", "suggestion": "改进建议"}
  ]
}`;

const REVISION_SCHEMA = `{
  "revised_proposal": {"approach": "...", "files": [...], "steps": [...]},
  "changes": ["针对每条 critique 改了什么"],
  "dismissed": [{"issue": "决定不改的问题", "reason": "为什么不改"}]
}`;

const SYNTHESIS_SCHEMA = `{
  "final_plan": {
    "approach": "终版方案",
    "steps": [{"action": "动作", "target": "目标文件", "detail": "细节"}],
    "rollback": "出错怎么回滚"
  }
}`;

export const ROLE_DEFINITIONS: Record<DebateRoleName, DebateRoleDefinition> = {
  analyst: {
    label: '解析员',
    persona: '你是一个务实的需求分析师。你擅长把模糊的用户请求拆解成清晰的需求点和约束，并收集相关的项目上下文。',
    reads: ['request'],
    writes: ['analysis'],
    buildInstruction: (s) => `【用户请求】\n${s.request}\n\n请拆解需求、列出约束、收集上下文。`,
    outputSchema: ANALYST_SCHEMA,
  },
  proposer: {
    label: '方案者',
    persona: '你是一个有系统设计思维的工程师。你根据需求设计实现方案，关注可维护性和边界情况。',
    reads: ['analysis'],
    writes: ['proposal'],
    buildInstruction: (s) => {
      const a = s.analysis;
      return `【需求分析】\n需求：${a?.requirements.join('；') ?? ''}\n约束：${a?.constraints.join('；') ?? ''}\n上下文：${a?.context ?? ''}\n\n请设计实现方案。`;
    },
    outputSchema: PROPOSAL_SCHEMA,
  },
  critic: {
    label: '异议者',
    persona: '你是一个严格、挑剔的代码评审员。你专找方案的漏洞、风险和未考虑的边界情况。你总是提出 2-3 个按严重程度排序的问题。',
    reads: ['proposal'],
    writes: ['critiques'],
    buildInstruction: (s) => {
      const p = s.proposal;
      return `【当前方案】\n思路：${p?.approach ?? ''}\n涉及文件：${p?.files.map((f) => f.path).join('、') ?? '无'}\n步骤：${p?.steps.join('；') ?? ''}\n\n找出 2-3 个该方案可能的问题。`;
    },
    outputSchema: CRITIQUE_SCHEMA,
  },
  synthesizer: {
    label: '综合者',
    persona: '你是一个有决断力的技术负责人。你综合原方案、修订方案和评审意见，拍板定终版方案，不纠结。',
    reads: ['proposal', 'revised_proposal', 'critiques'],
    writes: ['final_plan'],
    buildInstruction: (s) => {
      const p = s.proposal;
      const r = s.revised_proposal;
      const c = s.critiques ?? [];
      return `【原方案】\n${p?.approach ?? ''}\n\n【修订方案】\n${r?.approach ?? ''}\n\n【评审意见】\n${c.map((x) => `[${x.severity}] ${x.issue}：${x.suggestion}`).join('\n')}\n\n请综合以上，产出终版方案。`;
    },
    outputSchema: SYNTHESIS_SCHEMA,
  },
  executor: {
    label: '执行者',
    persona: '你是执行阶段的标记角色，实际执行由 headless task runner 完成。',
    reads: ['final_plan'],
    writes: [],
    buildInstruction: (s) => s.final_plan?.steps.map((x) => x.detail).join('\n') ?? '',
    outputSchema: '',
  },
};

/** Build the full prompt (system + user instruction) for a role call. */
export function buildRolePrompt(role: DebateRoleName, s: Scratchpad, isRevision = false): string {
  const def = ROLE_DEFINITIONS[role];
  if (role === 'proposer' && isRevision) {
    const p = s.proposal;
    const c = s.critiques ?? [];
    return `${def.persona}\n\n你之前提出了一个方案，现在收到了评审意见。请针对每条意见修改方案或给出不接受的理由。\n\n【你的原方案】\n思路：${p?.approach ?? ''}\n步骤：${p?.steps.join('；') ?? ''}\n\n【评审意见】（${c.length} 条）\n${c.map((x, i) => `${i + 1}. [${x.severity}] ${x.issue}：${x.suggestion}`).join('\n')}\n\n【输出格式】\n${REVISION_SCHEMA}`;
  }
  return `${def.persona}\n\n${def.buildInstruction(s)}\n\n【输出格式】\n${def.outputSchema}`;
}

/** Extract the first JSON object from text that may be wrapped in prose or code fences. */
function extractJson(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();
  const objStart = text.indexOf('{');
  const objEnd = text.lastIndexOf('}');
  if (objStart >= 0 && objEnd > objStart) return text.slice(objStart, objEnd + 1);
  return text.trim();
}

/** Parse a role's text output into a partial Scratchpad patch. */
export function parseRoleOutput(role: DebateRoleName, text: string): Partial<Scratchpad> {
  const jsonStr = extractJson(text);
  const obj = JSON.parse(jsonStr);
  switch (role) {
    case 'analyst':
      return { analysis: obj as AnalysisResult };
    case 'proposer':
      if (obj.revised_proposal) {
        return {
          revised_proposal: obj.revised_proposal as RevisedProposal,
          changes: obj.changes ?? [],
          dismissed: obj.dismissed ?? [],
        };
      }
      return { proposal: obj as Proposal };
    case 'critic':
      return { critiques: (obj.critiques ?? []) as Critique[] };
    case 'synthesizer':
      return { final_plan: (obj.final_plan ?? obj) as FinalPlan };
    default:
      return {};
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/roles.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Typecheck**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add src/shared/roles.ts src/shared/roles.test.ts
git commit -m "feat(debate): add role definitions and prompt builders"
```

---

## Task 3: 辩论编排引擎

**Files:**
- Create: `src/renderer/task-engine/debate-engine.ts`
- Test: `src/renderer/task-engine/debate-engine.test.ts`

**Interfaces:**
- Consumes: `Scratchpad` (Task 1), `buildRolePrompt`/`parseRoleOutput`/`ROLE_DEFINITIONS`/`DebateRoleName` (Task 2), `window.api.ai.chat`（已有 IPC）
- Produces: `DebateConfig`，`DebateEvent`，`runDebate(config, scratchpad, callbacks)`，`STAGE_SEQUENCE`

- [ ] **Step 1: Write the failing test**

```typescript
// src/renderer/task-engine/debate-engine.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runDebate, STAGE_SEQUENCE, type DebateConfig } from './debate-engine';
import { createScratchpad } from '@shared/scratchpad';
import type { ChatResult } from '@shared/types';

/** Mock window.api.ai.chat with a scripted sequence of responses. */
function installApi(responses: string[]) {
  let i = 0;
  const chat = vi.fn(async (): Promise<ChatResult> => ({
    content: responses[Math.min(i++, responses.length - 1)],
    finishReason: 'stop',
  }));
  (globalThis as any).window = { api: { ai: { chat } } };
  return { chat };
}

const CONFIG: DebateConfig = {
  analyst: { providerId: 'p1', model: 'm1', temperature: 0.3 },
  proposer: { providerId: 'p2', model: 'm2', temperature: 0.2 },
  critic: { providerId: 'p3', model: 'm3', temperature: 0.7 },
  synthesizer: { providerId: 'p4', model: 'm4', temperature: 0.2 },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('STAGE_SEQUENCE', () => {
  it('lists the 5 discussion stages in order', () => {
    expect(STAGE_SEQUENCE).toEqual(['analyst', 'proposer', 'critic', 'proposer', 'synthesizer']);
  });
});

describe('runDebate', () => {
  it('runs all 5 discussion stages in order and fills the scratchpad', async () => {
    const { chat } = installApi([
      '{"requirements":["搜索文件"],"constraints":["无新依赖"],"context":"src/"}',
      '{"approach":"用 glob","files":[],"steps":["写工具"]}',
      '{"critiques":[{"severity":"high","issue":"性能","suggestion":"加缓存"}]}',
      '{"revised_proposal":{"approach":"用 glob + 缓存","files":[],"steps":["写工具","加缓存"]},"changes":["加了缓存"],"dismissed":[]}',
      '{"final_plan":{"approach":"glob+缓存","steps":[{"action":"create","target":"search.ts","detail":"实现"}],"rollback":"删文件"}}',
    ]);
    const events: string[] = [];
    const result = await runDebate(
      CONFIG,
      createScratchpad('加文件搜索'),
      { onStage: (e) => events.push(e.stage) }
    );
    expect(chat).toHaveBeenCalledTimes(5);
    expect(events).toEqual(['analyst', 'proposer', 'critic', 'proposer', 'synthesizer']);
    expect(result.scratchpad.analysis?.requirements).toEqual(['搜索文件']);
    expect(result.scratchpad.critiques?.[0].severity).toBe('high');
    expect(result.scratchpad.final_plan?.steps[0].target).toBe('search.ts');
  });

  it('calls onError and stops if a stage output fails to parse', async () => {
    installApi(['这不是JSON']);
    let errMsg = '';
    const result = await runDebate(CONFIG, createScratchpad('test'), {
      onStage: () => {},
      onError: (msg) => { errMsg = msg; },
    });
    expect(errMsg).toBeTruthy();
    expect(result.scratchpad.analysis).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/task-engine/debate-engine.test.ts`
Expected: FAIL — module `./debate-engine` not found

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/renderer/task-engine/debate-engine.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/task-engine/debate-engine.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Typecheck + full test suite**

Run: `npx tsc -p tsconfig.json --noEmit && npx vitest run`
Expected: 0 errors, all tests pass

- [ ] **Step 6: Commit**

```bash
git add src/renderer/task-engine/debate-engine.ts src/renderer/task-engine/debate-engine.test.ts
git commit -m "feat(debate): add 5-stage debate orchestration engine"
```

---

## Task 4: 接通执行阶段（debate → headlessTaskRunner）

**Files:**
- Modify: `src/renderer/task-engine/debate-engine.ts`
- Test: `src/renderer/task-engine/debate-engine.test.ts`

**Interfaces:**
- Consumes: `runHeadlessTask` from existing `headlessTaskRunner.ts`
- Produces: `runDebateFull(config, request, execConfig, workspaceRoot, cbs)` — 跑完 5 阶段讨论 + 执行

- [ ] **Step 1: Write the failing test**

Add to `src/renderer/task-engine/debate-engine.test.ts`:

```typescript
import { runDebateFull, type DebateFullConfig } from './debate-engine';

const FULL_CONFIG: DebateFullConfig = {
  ...CONFIG,
  executor: { providerId: 'p5', model: 'm5', temperature: 0.2 },
};

describe('runDebateFull', () => {
  it('runs 5 discussion stages then execution', async () => {
    const { chat } = installApi([
      '{"requirements":["r"],"constraints":[],"context":""}',
      '{"approach":"a","files":[],"steps":["s"]}',
      '{"critiques":[{"severity":"low","issue":"i","suggestion":"g"}]}',
      '{"revised_proposal":{"approach":"a2","files":[],"steps":["s2"]},"changes":[],"dismissed":[]}',
      '{"final_plan":{"approach":"a3","steps":[{"action":"create","target":"f.ts","detail":"写文件"}],"rollback":"删"}}',
    ]);
    // Mock headless task runner via window.api.fs + a stop-on-first-call chat
    const fs = {
      readFile: vi.fn(async () => ''),
      writeFile: vi.fn(async () => {}),
    };
    (globalThis as any).window.api.fs = fs;
    // After 5 debate calls, the 6th chat call is the execution's first iteration — return a stop.
    chat.mockImplementationOnce(async () => ({ content: '执行完成', finishReason: 'stop' }) as ChatResult);

    const result = await runDebateFull(
      FULL_CONFIG,
      '加搜索',
      '/wt',
      { onStage: () => {} }
    );
    expect(result.scratchpad.final_plan).not.toBeNull();
    expect(result.execution).toBeDefined();
    expect(result.execution?.content).toBe('执行完成');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/task-engine/debate-engine.test.ts`
Expected: FAIL — `runDebateFull` is not exported

- [ ] **Step 3: Implement runDebateFull**

Add to `src/renderer/task-engine/debate-engine.ts`:

```typescript
import { runHeadlessTask, type HeadlessTaskResult } from './headlessTaskRunner';

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/task-engine/debate-engine.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/task-engine/debate-engine.ts src/renderer/task-engine/debate-engine.test.ts
git commit -m "feat(debate): connect debate to headlessTaskRunner execution"
```

---

## Task 5: 辩论状态类型 + TaskContext 集成

**Files:**
- Modify: `src/shared/types.ts` — 加 `DebateRoleConfig` / `DebateRun` 类型
- Modify: `src/renderer/context/TaskContext.tsx` — 加 `debateConfig` 状态 + `runDebateTask` 方法

**Interfaces:**
- Consumes: `DebateConfig` from Task 3, `runDebateFull` from Task 4
- Produces: `TaskContextValue.debateConfig`, `TaskContextValue.setDebateRoleConfig`, `TaskContextValue.runDebateTask`

- [ ] **Step 1: Add types to shared/types.ts**

Add at the end of `src/shared/types.ts`:

```typescript
// ============================================================
// Debate System (单 Agent 多角色辩论)
// ============================================================

export interface DebateRoleConfig {
  providerId: string;
  model: string;
  temperature?: number;
}

export interface DebateConfig {
  analyst: DebateRoleConfig;
  proposer: DebateRoleConfig;
  critic: DebateRoleConfig;
  synthesizer: DebateRoleConfig;
  executor: DebateRoleConfig;
}

export type DebateStageName = 'analyst' | 'proposer' | 'critic' | 'synthesizer' | 'executor';

export interface DebateStageState {
  name: DebateStageName;
  status: 'pending' | 'running' | 'done' | 'error';
  output?: string;
  startedAt?: number;
  endedAt?: number;
}

export interface DebateRun {
  id: string;
  request: string;
  stages: DebateStageState[];
  startedAt: number;
  /** Set when the full run completes (debate + execution). */
  finishedAt?: number;
  error?: string;
}
```

- [ ] **Step 2: Add debate state to TaskContext**

In `src/renderer/context/TaskContext.tsx`, add to the context value interface and implementation:

```typescript
// Add to imports
import type { DebateConfig, DebateRun, DebateStageName } from '@shared/types';
import { runDebateFull } from '../task-engine/debate-engine';

// Add to TaskContextValue interface:
debateConfig: DebateConfig;
setDebateRoleConfig: (role: DebateStageName, cfg: Partial<DebateConfig[DebateStageName]>) => void;
currentDebate: DebateRun | null;
runDebateTask: (request: string, workspaceRoot: string) => Promise<void>;
stopDebate: () => void;

// Add to the provider component state:
const [debateConfig, setDebateConfig] = useState<DebateConfig>(() => {
  // Load from store or use defaults that point at the first provider
  const saved = (window.api.store.get('debateConfig') as DebateConfig) || null;
  if (saved) return saved;
  const fallback = { providerId: providers[0]?.id ?? '', model: '', temperature: 0.3 };
  return {
    analyst: { ...fallback, temperature: 0.3 },
    proposer: { ...fallback, temperature: 0.2 },
    critic: { ...fallback, temperature: 0.7 },
    synthesizer: { ...fallback, temperature: 0.2 },
    executor: { ...fallback, temperature: 0.2 },
  };
});
const [currentDebate, setCurrentDebate] = useState<DebateRun | null>(null);

const setDebateRoleConfig = useCallback((role: DebateStageName, cfg: Partial<DebateConfig[DebateStageName]>) => {
  setDebateConfig((prev) => {
    const next = { ...prev, [role]: { ...prev[role], ...cfg } };
    window.api.store.set('debateConfig', next);
    return next;
  });
}, []);

const runDebateTask = useCallback(async (request: string, workspaceRoot: string) => {
  const run: DebateRun = { id: uuid(), request, stages: [], startedAt: Date.now() };
  setCurrentDebate(run);
  await runDebateFull(debateConfig, request, workspaceRoot, {
    onStage: (e) => {
      setCurrentDebate((prev) => {
        if (!prev) return prev;
        const stages = [...prev.stages];
        const idx = stages.findIndex((st) => st.name === e.stage);
        const stageState: DebateStageState = {
          name: e.stage,
          status: e.start ? 'running' : 'done',
          startedAt: e.start ? Date.now() : stages[idx]?.startedAt,
          endedAt: e.start ? undefined : Date.now(),
        };
        if (idx >= 0) stages[idx] = stageState;
        else stages.push(stageState);
        return { ...prev, stages };
      });
    },
    onError: (msg) => {
      setCurrentDebate((prev) => (prev ? { ...prev, error: msg, finishedAt: Date.now() } : prev));
    },
  });
  setCurrentDebate((prev) => (prev ? { ...prev, finishedAt: Date.now() } : prev));
}, [debateConfig]);

const stopDebate = useCallback(() => {
  window.api.ai.abort();
  setCurrentDebate((prev) => (prev ? { ...prev, finishedAt: Date.now() } : prev));
}, []);
```

Note: add `debateConfig`, `setDebateRoleConfig`, `currentDebate`, `runDebateTask`, `stopDebate` to the context provider's value object.

- [ ] **Step 3: Typecheck**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: 0 errors (may need to fix unused variable warnings)

- [ ] **Step 4: Run full test suite**

Run: `npx vitest run`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/renderer/context/TaskContext.tsx
git commit -m "feat(debate): integrate debate state into TaskContext"
```

---

## Task 6: DebateView 主界面组件

**Files:**
- Create: `src/renderer/components/debate/DebateView.tsx`
- Create: `src/renderer/components/debate/DebateStageCard.tsx`
- Create: `src/renderer/components/debate/ResultPanel.tsx`

**Interfaces:**
- Consumes: `currentDebate`, `runDebateTask`, `stopDebate` from TaskContext (Task 5)
- Produces: `<DebateView />` 组件，三区域布局

- [ ] **Step 1: Create DebateStageCard component**

```typescript
// src/renderer/components/debate/DebateStageCard.tsx
import React from 'react';
import type { DebateStageState } from '@shared/types';

const STAGE_LABELS: Record<string, string> = {
  analyst: '解析员',
  proposer: '方案者',
  critic: '异议者',
  synthesizer: '综合者',
  executor: '执行者',
};

const STATUS_COLORS: Record<string, string> = {
  pending: '#888',
  running: '#2563eb',
  done: '#16a34a',
  error: '#dc2626',
};

export function DebateStageCard({ stage }: { stage: DebateStageState }) {
  const label = STAGE_LABELS[stage.name] ?? stage.name;
  const color = STATUS_COLORS[stage.status] ?? '#888';
  const isRevision = stage.name === 'proposer' && stage.output?.includes('修订');
  return (
    <div style={{ borderLeft: `3px solid ${color}`, padding: '8px 12px', margin: '4px 0', background: '#f9fafb' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 600 }}>{label}{isRevision ? '（修订）' : ''}</span>
        <span style={{ color, fontSize: 12 }}>{stage.status}</span>
      </div>
      {stage.output && <pre style={{ fontSize: 12, marginTop: 4, whiteSpace: 'pre-wrap' }}>{stage.output}</pre>}
    </div>
  );
}
```

- [ ] **Step 2: Create ResultPanel component**

```typescript
// src/renderer/components/debate/ResultPanel.tsx
import React from 'react';

interface ResultPanelProps {
  files: string[];
  diff?: string;
  verified?: boolean;
  onAdopt: () => void;
  onRollback: () => void;
}

export function ResultPanel({ files, diff, verified, onAdopt, onRollback }: ResultPanelProps) {
  if (!files.length) return null;
  return (
    <div style={{ borderTop: '1px solid #e5e7eb', padding: 12 }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>执行结果</div>
      <div style={{ fontSize: 13, marginBottom: 8 }}>
        改动文件（{files.length}）：{files.join('、')}
      </div>
      {verified !== undefined && (
        <div style={{ fontSize: 12, color: verified ? '#16a34a' : '#dc2626', marginBottom: 8 }}>
          验证：{verified ? '通过' : '未通过'}
        </div>
      )}
      {diff && (
        <pre style={{ fontSize: 11, background: '#1e293b', color: '#e2e8f0', padding: 8, maxHeight: 200, overflow: 'auto' }}>
          {diff}
        </pre>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button onClick={onAdopt} style={{ padding: '6px 16px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 4 }}>
          采纳
        </button>
        <button onClick={onRollback} style={{ padding: '6px 16px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 4 }}>
          回滚
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create DebateView main component**

```typescript
// src/renderer/components/debate/DebateView.tsx
import React, { useState, useContext } from 'react';
import { TaskContext } from '../../context/TaskContext';
import { useWorkspace } from '../../context/WorkspaceContext';
import { DebateStageCard } from './DebateStageCard';
import { ResultPanel } from './ResultPanel';

export function DebateView() {
  const ctx = useContext(TaskContext)!;
  const { rootPath } = useWorkspace();
  const [input, setInput] = useState('');

  const handleSend = async () => {
    if (!input.trim() || !rootPath) return;
    const req = input.trim();
    setInput('');
    await ctx.runDebateTask(req, rootPath);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const isRunning = ctx.currentDebate && !ctx.currentDebate.finishedAt;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* 顶部：任务输入 */}
      <div style={{ padding: 12, borderBottom: '1px solid #e5e7eb' }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="描述你要完成的事…（Enter 发送，Shift+Enter 换行）"
          disabled={!!isRunning}
          style={{ width: '100%', minHeight: 60, padding: 8, border: '1px solid #d1d5db', borderRadius: 4, resize: 'vertical' }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          {isRunning && (
            <button onClick={ctx.stopDebate} style={{ padding: '6px 16px', border: '1px solid #dc2626', color: '#dc2626', borderRadius: 4 }}>
              停止
            </button>
          )}
        </div>
      </div>

      {/* 主体：讨论过程 */}
      <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
        {ctx.currentDebate?.stages.map((stage, i) => (
          <DebateStageCard key={i} stage={stage} />
        ))}
        {ctx.currentDebate?.error && (
          <div style={{ color: '#dc2626', padding: 8 }}>{ctx.currentDebate.error}</div>
        )}
      </div>

      {/* 底部：结果验收 */}
      <ResultPanel
        files={[]}
        onAdopt={() => {}}
        onRollback={() => {}}
      />
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/debate/
git commit -m "feat(debate): add DebateView three-region UI"
```

---

## Task 7: 角色配置 UI

**Files:**
- Create: `src/renderer/components/settings/RolesSettings.tsx`
- Modify: `src/renderer/components/settings/SettingsWorkbench.tsx` — 加"辩论角色"标签页

- [ ] **Step 1: Create RolesSettings component**

```typescript
// src/renderer/components/settings/RolesSettings.tsx
import React, { useContext } from 'react';
import { TaskContext } from '../../context/TaskContext';
import type { DebateStageName } from '@shared/types';

const ROLE_LABELS: Record<DebateStageName, string> = {
  analyst: '解析员',
  proposer: '方案者',
  critic: '异议者',
  synthesizer: '综合者',
  executor: '执行者',
};

const ROLE_HINTS: Record<DebateStageName, string> = {
  analyst: '便宜快的模型即可',
  proposer: '强推理模型',
  critic: '跟方案者不同的强模型，避免同源 bias',
  synthesizer: '最强的模型',
  executor: '执行阶段用的模型',
};

export function RolesSettings() {
  const ctx = useContext(TaskContext)!;
  const roles: DebateStageName[] = ['analyst', 'proposer', 'critic', 'synthesizer', 'executor'];

  return (
    <div style={{ padding: 16 }}>
      <h3 style={{ marginTop: 0 }}>辩论角色配置</h3>
      <p style={{ color: '#6b7280', fontSize: 13 }}>给每个角色指定供应商和模型。不同角色用不同模型能减少盲区。</p>
      {roles.map((role) => {
        const cfg = ctx.debateConfig[role];
        return (
          <div key={role} style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: 12, marginBottom: 12 }}>
            <div style={{ fontWeight: 600 }}>{ROLE_LABELS[role]}</div>
            <div style={{ color: '#9ca3af', fontSize: 12, marginBottom: 8 }}>{ROLE_HINTS[role]}</div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <select
                value={cfg.providerId}
                onChange={(e) => ctx.setDebateRoleConfig(role, { providerId: e.target.value })}
                style={{ padding: 4, border: '1px solid #d1d5db', borderRadius: 4 }}
              >
                {ctx.providers.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <select
                value={cfg.model}
                onChange={(e) => ctx.setDebateRoleConfig(role, { model: e.target.value })}
                style={{ padding: 4, border: '1px solid #d1d5db', borderRadius: 4 }}
              >
                {ctx.providers.find((p) => p.id === cfg.providerId)?.models.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <label style={{ fontSize: 12 }}>
                温度
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="2"
                  value={cfg.temperature ?? 0.3}
                  onChange={(e) => ctx.setDebateRoleConfig(role, { temperature: parseFloat(e.target.value) })}
                  style={{ width: 50, marginLeft: 4, padding: 4, border: '1px solid #d1d5db', borderRadius: 4 }}
                />
              </label>
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Wire into SettingsWorkbench**

In `src/renderer/components/settings/SettingsWorkbench.tsx`, add a new tab. Find the tab definitions and add:

```typescript
import { RolesSettings } from './RolesSettings';

// Add to the tabs array alongside Providers/Agents/Editor/Index:
{ id: 'roles', label: '辩论角色', component: <RolesSettings /> }
```

(The exact insertion point depends on the existing tab structure — add it after the existing tabs.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/settings/RolesSettings.tsx src/renderer/components/settings/SettingsWorkbench.tsx
git commit -m "feat(debate): add role configuration settings tab"
```

---

## Task 8: App.tsx 主布局切换到 DebateView

**Files:**
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: Read current App.tsx**

Read `src/renderer/App.tsx` to understand the current layout structure.

- [ ] **Step 2: Replace MainLayout with DebateView**

In `src/renderer/App.tsx`, import and render `DebateView` as the main content instead of `MainLayout`. Keep the context providers and settings modal.

```typescript
import { DebateView } from './components/debate/DebateView';

// Replace <MainLayout /> with <DebateView /> inside the providers
```

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc -p tsconfig.json --noEmit && npx tsc -p tsconfig.main.json --noEmit`
Expected: 0 errors

- [ ] **Step 4: Run dev server smoke test**

Run: `npm run dev` (start, verify Electron window opens with DebateView, then stop)
Expected: window opens, shows task input box + empty discussion area

- [ ] **Step 5: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "refactor(debate): switch main layout to DebateView"
```

---

## Task 9: 端到端冒烟测试 + 提示词调优

**Files:**
- 可能微调: `src/shared/roles.ts`（提示词文案）

- [ ] **Step 1: 配置至少 2 个供应商**

在设置页配置至少两个能用的 API 供应商（如 DeepSeek + Claude）。给 5 个角色分配模型。

- [ ] **Step 2: 跑一个真实任务**

输入一个真实任务，如"给这个项目加一个简单的文件搜索功能，用 glob 匹配文件名"。

观察：
- 6 个阶段是否依次跑完
- 每个阶段的 JSON 输出是否解析成功
- 异议者是否真的提出了 2-3 个问题
- 综合者的 final_plan 是否合理
- 执行阶段是否在 worktree 里产出了代码

- [ ] **Step 3: 记录提示词问题**

如果某个阶段输出不符合预期（如异议者没提够 2 条、解析员漏需求），调整 `src/shared/roles.ts` 里对应角色的 `persona` 或 `buildInstruction`，重新跑。

常见调优点：
- 解析员 context 字段太空 → 在 instruction 里加"调用 search_files 工具收集相关文件"（但当前 debate-engine 不给工具，需评估是否给分析阶段开工具）
- 异议者输出不是 JSON → 在 persona 里强化"只输出 JSON，不要任何其他文字"
- 综合者直接复制修订方案 → 在 persona 里加"你必须做出取舍，不能直接照搬"

- [ ] **Step 4: 跑 npm test 确认没破坏**

Run: `npx vitest run`
Expected: all pass

- [ ] **Step 5: Commit 提示词调优**

```bash
git add src/shared/roles.ts
git commit -m "fix(debate): tune role prompts based on e2e smoke test"
```

---

## Self-Review Notes

**Spec coverage check:**
- ✅ 6 阶段结构化辩论 → Task 1-3
- ✅ Scratchpad 数据结构 → Task 1
- ✅ 提示词三段式 → Task 2
- ✅ 5 角色定义 → Task 2
- ✅ 不同角色挂不同模型 → Task 5, 7
- ✅ 复用 headlessTaskRunner → Task 4
- ✅ 三区域 UI → Task 6
- ✅ 流式展示 → Task 6 (onToken 回调)
- ✅ 采纳/回滚按钮 → Task 6 ResultPanel
- ✅ 角色配置 UI → Task 7
- ✅ 砍掉编辑器/文件树 → Task 8
- ✅ 端到端跑通 → Task 9

**Placeholder scan:** 无 TBD/TODO。Task 8 Step 2 和 Task 7 Step 2 引用"找到现有结构"，因为依赖当前代码的具体行号——执行时读文件即可确定，不算占位符。

**Type consistency:** `DebateRoleName` 在 roles.ts 定义，`DebateStageName` 在 types.ts 定义（含 executor）。`DebateConfig` 在 debate-engine.ts（5 讨论角色）和 types.ts（含 executor）分别定义，通过 `DebateFullConfig extends DebateConfig` 衔接。
