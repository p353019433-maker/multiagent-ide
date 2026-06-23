// ============================================================
// Model Provider Types
// ============================================================

export type ProviderType = 'openai' | 'anthropic' | 'google' | 'custom';

export interface ModelProvider {
  id: string;
  name: string;
  type: ProviderType;
  baseURL: string;
  /** Stored encrypted; UI never sees plaintext until decryptAndGet is called */
  apiKeyRef: string; // key in encrypted store
  models: string[];
  defaultModel: string;
}

export type AIProvider = ModelProvider;

// ============================================================
// Multi-Agent System
// ============================================================

export type AgentKind = 'api' | 'claude-code' | 'codex' | 'antigravity' | 'opencode';

/**
 * Negotiation-based review role:
 *  - architect  — architecture design, patterns, maintainability
 *  - security   — security vulnerabilities, dependencies, hardening
 *  - testing    — test coverage, edge cases, reproducibility
 *  - style      — code style, lint, naming, consistency
 *  - general    — catch-all: no specific focus, free-form evaluation
 */
export type AgentRole = 'architect' | 'security' | 'testing' | 'style' | 'general';

/** Human-readable labels for each review role. */
export const ROLE_LABELS: Record<AgentRole, string> = {
  architect: '架构',
  security: '安全',
  testing: '测试',
  style: '风格',
  general: '通用',
};

/**
 * A participant in the multi-agent system:
 *  - 'api'         — raw API model (no shell), reached via ai-service.
 *  - 'claude-code' — driven by `claude -p` (own login, or a custom API backend).
 *  - 'codex'       — driven by `codex exec` (own login, or a custom API backend).
 *  - 'antigravity' — driven by `agy -p` (Google login; Gemini backend).
 *  - 'opencode'    — driven by `opencode run` (its own provider/auth system).
 *
 * `providerId` links a backing API connection when an API backend is configured;
 * it is absent for login-based shells (Claude Code / Codex own login, Antigravity).
 */
export interface Agent {
  id: string;
  name: string;
  /** Whether this agent joins the next discussion / run. */
  enabled: boolean;
  kind: AgentKind;
  /** Negotiation-based review role. */
  role: AgentRole;
  /** Backing API connection (provider id) when an API backend is configured. */
  providerId?: string;
  /** Model name (empty = the CLI/login default). */
  model: string;
}

// ============================================================
// Chat Message Types
// ============================================================

export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  content: string;
  isError?: boolean;
}

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  /** Base64 data URLs (data:image/png;base64,...) attached to a user message. */
  images?: string[];
  timestamp: number;
}

/**
 * A verifiable deliverable produced at the end of a task turn that changed
 * files: what changed plus the verification result.
 */
export interface Artifact {
  id: string;
  label: string;
  createdAt: number;
  files: string[];
  /** Whether post-change lint/type verification passed. */
  verified: boolean;
  /** Markdown report (also persisted under .ide/artifacts/). */
  report: string;
  /** Absolute path of the persisted report, if saved. */
  path?: string;
}

/**
 * A snapshot of file contents taken before a task turn modifies them, so the
 * user can revert all changes from that turn in one click.
 */
export interface Checkpoint {
  id: string;
  /** The user message that started the turn this checkpoint protects. */
  label: string;
  createdAt: number;
  /** path -> content before the turn (null means the file did not exist). */
  files: { path: string; before: string | null }[];
}

/** One step of an Agent execution plan, surfaced in the task panel. */
export interface PlanStep {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  providerId: string;
  model: string;
  createdAt: number;
  updatedAt: number;
  /** If this session runs in an isolated git worktree */
  worktree?: {
    path: string;
    branch: string;
    baseBranch: string;
  };
}

// ============================================================
// Model Service Types
// ============================================================

export interface ChatOptions {
  model: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
  systemPrompt?: string;
  workspaceRoot?: string;
}

/** Per-message multimodal input passed alongside the text content. */
export interface MessageImage {
  /** data URL, e.g. "data:image/png;base64,iVBOR..." */
  dataUrl: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ChatResult {
  content: string;
  toolCalls?: ToolCall[];
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

export interface StreamCallbacks {
  onToken: (token: string) => void;
  onToolCall: (toolCall: ToolCall) => void;
  onComplete: (result: ChatResult) => void;
  onError: (error: string) => void;
}

export interface FimRequest {
  providerId: string;
  model: string;
  prefix: string;
  suffix: string;
  maxTokens?: number;
}

// ============================================================
// GitHub
// ============================================================

/** Inline review comment posted on a PR diff line. */
export interface GitHubReviewComment {
  path: string;
  line: number;
  body: string;
}

// ============================================================
// File Tree
// ============================================================

export interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileNode[];
}

// ============================================================
// Editor State
// ============================================================

export interface OpenFile {
  path: string;
  content: string;
  originalContent: string;
  language: string;
  isDirty: boolean;
}

// ============================================================
// Task Tool I/O (renderer-side execution shape)
// ============================================================

export interface TaskToolExecution {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  status: 'pending' | 'running' | 'success' | 'error' | 'rejected';
  result?: string;
  error?: string;
  /** For file edits: needs user approval before applying */
  needsApproval?: boolean;
  diff?: { before: string; after: string; filePath: string };
}

export type AgentToolExecution = TaskToolExecution;

// ============================================================
// Parallel Task Orchestration
// ============================================================

export interface OrchestrationTask {
  id: string;
  description: string;
  conversationId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'merged';
  result?: string;
  error?: string;
  editedFiles?: string[];
}

export interface OrchestrationSession {
  id: string;
  goal: string;
  tasks: OrchestrationTask[];
  createdAt: number;
  completedAt?: number;
  status: 'running' | 'completed' | 'failed';
}

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
