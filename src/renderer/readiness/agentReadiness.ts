import type { ModelProvider, Agent } from '@shared/types';

export type ReadinessItemId = 'workspace' | 'model' | 'indexing' | 'task';
export type ReadinessStatus = 'done' | 'blocked' | 'optional' | 'ready';
export type ReadinessActionId =
  | 'openWorkspace'
  | 'openSettings'
  | 'openTaskPanel'
  | 'openIndexSettings';

export interface AgentReadinessInput {
  rootPath: string | null;
  providers: ModelProvider[];
  activeProviderId: string | null;
  activeModel: string | null;
  embeddingConfig?: {
    providerId?: string | null;
    model?: string | null;
  } | null;
  /**
   * The multi-agent roster. When at least one enabled CLI shell (claude-code /
   * codex / antigravity / opencode) is present, the "model service" requirement
   * can be satisfied by that CLI in advanced agent flows. API agents don't
   * count here (they need their own providerId).
   */
  agents?: Agent[];
}

export interface AgentReadinessItem {
  id: ReadinessItemId;
  label: string;
  description: string;
  status: ReadinessStatus;
  actionId: ReadinessActionId;
  actionLabel: string;
}

export interface AgentReadiness {
  canRunAgent: boolean;
  nextActionId: ReadinessActionId;
  items: AgentReadinessItem[];
}

function hasActiveModel(
  providers: ModelProvider[],
  activeProviderId: string | null,
  activeModel: string | null
): boolean {
  if (!activeProviderId || !activeModel) return false;
  const provider = providers.find((item) => item.id === activeProviderId);
  if (!provider) return false;
  if (provider.models.length === 0) return true;
  return provider.models.includes(activeModel);
}

export function getAgentReadiness(input: AgentReadinessInput): AgentReadiness {
  const hasWorkspace = Boolean(input.rootPath);
  const modelReady = hasActiveModel(input.providers, input.activeProviderId, input.activeModel);
  const indexingReady = Boolean(input.embeddingConfig?.providerId && input.embeddingConfig?.model);
  const canRunAgent = hasWorkspace && modelReady;

  const items: AgentReadinessItem[] = [
    {
      id: 'workspace',
      label: '打开工作区',
      description: hasWorkspace ? '工作区已授权，Agent 可以读取项目上下文。' : '先选择一个项目文件夹，启用文件、终端和索引能力。',
      status: hasWorkspace ? 'done' : 'blocked',
      actionId: 'openWorkspace',
      actionLabel: hasWorkspace ? '更换文件夹' : '打开文件夹',
    },
    {
      id: 'model',
      label: '配置模型服务',
      description: modelReady ? '已选择可用于任务执行的模型。' : '添加 OpenAI、Anthropic、DeepSeek、Gemini、Ollama 或自定义接口。',
      status: modelReady ? 'done' : 'blocked',
      actionId: 'openSettings',
      actionLabel: modelReady ? '管理模型' : '配置模型',
    },
    {
      id: 'indexing',
      label: '代码索引',
      description: indexingReady ? '语义检索已启用，Agent 可以使用 embedding 检索代码。' : '可选：配置 embedding 后启用更强的语义代码检索。',
      status: indexingReady ? 'done' : 'optional',
      actionId: 'openIndexSettings',
      actionLabel: indexingReady ? '管理索引' : '配置索引',
    },
    {
      id: 'task',
      label: '运行 Agent 任务',
      description: canRunAgent ? '就绪后可在任务工作台发起代码修改、审查和验证。' : '需要先打开工作区并配置模型服务。',
      status: canRunAgent ? 'ready' : 'blocked',
      actionId: 'openTaskPanel',
      actionLabel: canRunAgent ? '打开任务工作台' : '查看任务工作台',
    },
  ];

  const firstBlocked = items.find((item) => item.status === 'blocked');
  return {
    canRunAgent,
    nextActionId: firstBlocked?.actionId ?? 'openTaskPanel',
    items,
  };
}
