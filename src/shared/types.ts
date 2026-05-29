// ============================================================
// AI Provider Types
// ============================================================

export type ProviderType = 'openai' | 'anthropic' | 'google' | 'custom';

export interface AIProvider {
  id: string;
  name: string;
  type: ProviderType;
  baseURL: string;
  /** Stored encrypted; UI never sees plaintext until decryptAndGet is called */
  apiKeyRef: string; // key in encrypted store
  models: string[];
  defaultModel: string;
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
  timestamp: number;
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
// AI Service Types
// ============================================================

export interface ChatOptions {
  model: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
  systemPrompt?: string;
  workspaceRoot?: string;
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
// Agent Tool I/O (renderer-side execution shape)
// ============================================================

export interface AgentToolExecution {
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

// ============================================================
// Multi-Agent Orchestration
// ============================================================

export interface OrchestrationTask {
  id: string;
  description: string;
  conversationId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'merged';
  result?: string;
  error?: string;
}

export interface OrchestrationSession {
  id: string;
  goal: string;
  tasks: OrchestrationTask[];
  createdAt: number;
  completedAt?: number;
  status: 'running' | 'completed' | 'failed';
}
