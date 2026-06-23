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
