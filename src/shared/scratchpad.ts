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
