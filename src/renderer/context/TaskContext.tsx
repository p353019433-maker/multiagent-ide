import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { v4 as uuid } from 'uuid';
import type { ModelProvider as ModelProviderConfig, Conversation, ChatMessage, OrchestrationSession, OrchestrationTask, Agent, DebateConfig, DebateRun, DebateStageName, DebateStageState } from '@shared/types';
import { useWorkspace } from './WorkspaceContext';
import { runHeadlessTask } from '../task-engine/headlessTaskRunner';
import { runDebateFull } from '../task-engine/debate-engine';
import { mainRepoFromWorktreePath } from '../task-engine/taskUtils';
import {
  loadConversations,
  createConversationPersister,
  type StoreBackend,
} from './conversationStore';

export interface RunDebateTaskResult {
  ok: boolean;
  error?: string;
  editedFiles?: string[];
  note?: string;
  worktreePath?: string;
  worktreeBranch?: string;
  worktreeBaseBranch?: string;
}

interface TaskContextValue {
  providers: ModelProviderConfig[];
  activeProviderId: string | null;
  activeModel: string | null;
  conversations: Conversation[];
  activeConversationId: string | null;
  orchestrationSessions: OrchestrationSession[];

  setActiveProvider: (id: string) => void;
  setActiveModel: (model: string) => void;

  saveProvider: (provider: ModelProviderConfig, apiKey: string) => Promise<void>;
  deleteProvider: (id: string) => Promise<void>;
  testProvider: (id: string) => Promise<{ ok: boolean; error?: string }>;

  agents: Agent[];
  saveAgent: (agent: Agent) => void;
  deleteAgent: (id: string) => void;
  toggleAgent: (id: string, enabled: boolean) => void;

  newConversation: (providerId?: string, model?: string) => string;
  newWorktreeConversation: (worktreePath: string, branch: string, baseBranch: string) => Promise<string>;
  setActiveConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
  addConversation: (conv: Conversation) => void;
  addMessage: (conversationId: string, message: ChatMessage) => void;
  updateMessage: (conversationId: string, messageId: string, patch: Partial<ChatMessage>) => void;
  renameConversation: (conversationId: string, title: string) => void;

  /** Run multiple isolated tasks in parallel, with optional model-based decomposition. */
  orchestrate: (goal: string, subTasks?: string[]) => Promise<OrchestrationSession>;
  updateOrchestrationSession: (id: string, patch: Partial<OrchestrationSession>) => void;

  // Single-agent multi-role flow (analysis → proposal → critique → synthesis → execution).
  debateConfig: DebateConfig;
  setDebateRoleConfig: (role: DebateStageName, cfg: Partial<DebateConfig[DebateStageName]>) => void;
  currentDebate: DebateRun | null;
  runDebateTask: (conversationId: string, request: string, workspaceRoot: string) => Promise<RunDebateTaskResult>;
  stopDebate: () => void;
}

const TaskContext = createContext<TaskContextValue | null>(null);

export function selectModelForProvider(
  provider: ModelProviderConfig,
  preferredModel?: string | null
): string {
  if (preferredModel && provider.models.includes(preferredModel)) return preferredModel;
  if (provider.defaultModel && provider.models.includes(provider.defaultModel)) return provider.defaultModel;
  return provider.models[0] ?? provider.defaultModel ?? '';
}

export function normalizeProviderForSave(provider: ModelProviderConfig): ModelProviderConfig {
  const models = provider.models.map((model) => model.trim()).filter(Boolean);
  const normalized = {
    ...provider,
    name: provider.name.trim() || provider.name,
    baseURL: provider.baseURL.trim(),
    models,
  };
  return {
    ...normalized,
    defaultModel: selectModelForProvider(normalized, provider.defaultModel.trim()),
  };
}

export function upsertProvider(
  providers: ModelProviderConfig[],
  provider: ModelProviderConfig
): ModelProviderConfig[] {
  const idx = providers.findIndex((p) => p.id === provider.id);
  return idx >= 0
    ? providers.map((p) => (p.id === provider.id ? provider : p))
    : [...providers, provider];
}

export function selectProviderAfterDelete(
  providers: ModelProviderConfig[],
  activeProviderId: string | null,
  deleteId: string
) {
  const nextProviders = providers.filter((p) => p.id !== deleteId);
  if (activeProviderId !== deleteId) {
    return {
      providers: nextProviders,
      activeProviderId,
      activeModel: null,
    };
  }

  const replacement = nextProviders[0] ?? null;
  return {
    providers: nextProviders,
    activeProviderId: replacement?.id ?? null,
    activeModel: replacement?.defaultModel ?? null,
  };
}

// ── Multi-agent roster (pure helpers) ──

/** Built-in CLI agents (login-based by default); always present, toggled off
 *  until the user enables them. Users can add more agents of any type. */
export const BUILTIN_CLI_AGENTS: Agent[] = [
  { id: 'cli-claude-code', name: 'Claude Code', enabled: false, kind: 'claude-code', role: 'general', model: '' },
  { id: 'cli-codex', name: 'Codex', enabled: false, kind: 'codex', role: 'general', model: '' },
  { id: 'cli-antigravity', name: 'Antigravity', enabled: false, kind: 'antigravity', role: 'general', model: '' },
  { id: 'cli-opencode', name: 'OpenCode', enabled: false, kind: 'opencode', role: 'general', model: '' },
];

/** Migrate old Agent (pre-role) to new shape by defaulting 'general'. */
function migrateAgent(a: any): Agent {
  if ('role' in a && a.role) return a;
  return { ...a, role: 'general' };
}

/** Stored agents, or the built-in CLI agents on first run. Returns the same
 *  array reference when every stored agent already has a role (no migration
 *  needed), so callers that rely on reference equality still work. */
export function seedAgents(stored: Agent[] | undefined): Agent[] {
  if (stored && stored.length) {
    const needsMigration = stored.some((a: any) => !('role' in a) || !a.role);
    return needsMigration ? stored.map(migrateAgent) : stored;
  }
  return BUILTIN_CLI_AGENTS.map((a) => ({ ...a }));
}

export function upsertAgent(agents: Agent[], agent: Agent): Agent[] {
  const idx = agents.findIndex((a) => a.id === agent.id);
  return idx >= 0 ? agents.map((a) => (a.id === agent.id ? agent : a)) : [...agents, agent];
}

export function removeAgentById(agents: Agent[], id: string): Agent[] {
  return agents.filter((a) => a.id !== id);
}

export function setAgentEnabled(agents: Agent[], id: string, enabled: boolean): Agent[] {
  return agents.map((a) => (a.id === id ? { ...a, enabled } : a));
}

const DEBATE_ROLE_DEFAULTS: DebateConfig = {
  analyst: { providerId: '', model: '', temperature: 0.3 },
  proposer: { providerId: '', model: '', temperature: 0.2 },
  critic: { providerId: '', model: '', temperature: 0.7 },
  synthesizer: { providerId: '', model: '', temperature: 0.2 },
  executor: { providerId: '', model: '', temperature: 0.2 },
};

const DEBATE_ROLES: DebateStageName[] = ['analyst', 'proposer', 'critic', 'synthesizer', 'executor'];

function defaultModelForProvider(provider: ModelProviderConfig | undefined): string {
  if (!provider) return '';
  return selectModelForProvider(provider, provider.defaultModel);
}

export function normalizeDebateConfig(
  config: Partial<DebateConfig> | undefined,
  providers: ModelProviderConfig[]
): DebateConfig {
  const firstProvider = providers[0];
  const firstProviderId = firstProvider?.id ?? '';
  const next = {} as DebateConfig;

  for (const role of DEBATE_ROLES) {
    const raw = config?.[role] ?? DEBATE_ROLE_DEFAULTS[role];
    const provider = providers.find((item) => item.id === raw.providerId) ?? firstProvider;
    const providerId = provider?.id ?? raw.providerId ?? firstProviderId;
    const model = raw.model && provider?.models.includes(raw.model)
      ? raw.model
      : defaultModelForProvider(provider);
    next[role] = {
      providerId,
      model,
      temperature: raw.temperature ?? DEBATE_ROLE_DEFAULTS[role].temperature,
    };
  }

  return next;
}

function validateDebateConfig(config: DebateConfig, providers: ModelProviderConfig[]): string | null {
  for (const role of DEBATE_ROLES) {
    const cfg = config[role];
    if (!cfg.providerId) return `多角色流程缺少 ${role} 的模型供应商`;
    const provider = providers.find((item) => item.id === cfg.providerId);
    if (!provider) return `多角色流程的 ${role} 供应商不存在`;
    if (!cfg.model) return `多角色流程缺少 ${role} 的模型`;
    if (provider.models.length > 0 && !provider.models.includes(cfg.model)) return `多角色流程的 ${role} 模型不可用`;
  }
  return null;
}

export function TaskContextProvider({ children }: { children: React.ReactNode }) {
  const [providers, setProviders] = useState<ModelProviderConfig[]>([]);
  const [activeProviderId, setActiveProviderId] = useState<string | null>(null);
  const [activeModel, setActiveModelState] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [orchestrationSessions, setOrchestrationSessions] = useState<OrchestrationSession[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [debateConfig, setDebateConfig] = useState<DebateConfig>(() => DEBATE_ROLE_DEFAULTS);
  const [currentDebate, setCurrentDebate] = useState<DebateRun | null>(null);
  const { rootPath } = useWorkspace();

  const providersRef = useRef<ModelProviderConfig[]>([]);
  providersRef.current = providers;
  const debateAbortRef = useRef<AbortController | null>(null);
  const conversationsRef = useRef<Conversation[]>([]);
  conversationsRef.current = conversations;
  const orchestrationSessionsRef = useRef<OrchestrationSession[]>([]);
  orchestrationSessionsRef.current = orchestrationSessions;

  // Debounced, per-conversation persister (see conversationStore). Created once.
  const persisterRef = useRef<ReturnType<typeof createConversationPersister> | null>(null);
  if (!persisterRef.current) {
    const backend: StoreBackend = {
      get: (k) => window.api.store.get(k),
      set: (k, v) => window.api.store.set(k, v) as Promise<void>,
    };
    persisterRef.current = createConversationPersister(backend);
  }
  // Tracks the previous conversations array to diff what actually changed.
  const prevConvsRef = useRef<Conversation[]>([]);

  useEffect(() => {
    (async () => {
      const storedProviders = (await window.api.store.get('providers')) as ModelProviderConfig[] | undefined;
      const storedActiveId = (await window.api.store.get('activeProviderId')) as string | undefined;
      const storedActiveModel = (await window.api.store.get('activeModel')) as string | undefined;
      const normalizedProviders = storedProviders?.map(normalizeProviderForSave) ?? [];

      if (normalizedProviders.length) {
        setProviders(normalizedProviders);
        if (JSON.stringify(normalizedProviders) !== JSON.stringify(storedProviders)) {
          window.api.store.set('providers', normalizedProviders);
        }
        const provider = normalizedProviders.find((p) => p.id === storedActiveId) || normalizedProviders[0];
        const selectedModel = selectModelForProvider(provider, storedActiveModel);
        setActiveProviderId(provider.id);
        setActiveModelState(selectedModel);
        if (selectedModel !== storedActiveModel) {
          window.api.store.set('activeModel', selectedModel);
        }
      }

      // Load conversations via the per-conversation store (migrates legacy blob).
      const storedConvs = await loadConversations({
        get: (k) => window.api.store.get(k),
        set: (k, v) => window.api.store.set(k, v) as Promise<void>,
      });
      if (storedConvs.length) {
        prevConvsRef.current = storedConvs;
        setConversations(storedConvs);
        setActiveConversationId(storedConvs[0].id);
      }

      // Load the multi-agent roster; seed built-in CLI agents on first run.
      const storedAgents = (await window.api.store.get('agents')) as Agent[] | undefined;
      const seededAgents = seedAgents(storedAgents);
      setAgents(seededAgents);
      if (!storedAgents || !storedAgents.length) {
        window.api.store.set('agents', seededAgents);
      }

      // Load the single-agent multi-role config; normalize old/missing roles and default models.
      const savedDebateConfig = (await window.api.store.get('debateConfig')) as Partial<DebateConfig> | undefined;
      const normalizedDebateConfig = normalizeDebateConfig(savedDebateConfig, normalizedProviders ?? []);
      setDebateConfig(normalizedDebateConfig);
      if (JSON.stringify(savedDebateConfig) !== JSON.stringify(normalizedDebateConfig)) {
        window.api.store.set('debateConfig', normalizedDebateConfig);
      }
    })();

    // Flush any pending writes before the window closes (debounce safety net).
    const flush = () => persisterRef.current?.flush();
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, []);

  // Persist only the conversations that actually changed (reference diff),
  // routed through the debounced per-conversation persister.
  useEffect(() => {
    const persister = persisterRef.current!;
    const prev = prevConvsRef.current;
    prevConvsRef.current = conversations;

    const prevById = new Map(prev.map((c) => [c.id, c]));
    const currIds = conversations.map((c) => c.id);

    for (const c of conversations) {
      if (prevById.get(c.id) !== c) persister.save(c); // new or mutated
    }
    for (const c of prev) {
      if (!currIds.includes(c.id)) persister.remove(c.id); // deleted
    }
    const prevIds = prev.map((c) => c.id);
    if (prevIds.join() !== currIds.join()) persister.setOrder(currIds);
  }, [conversations]);

  const setActiveProvider = useCallback((id: string) => {
    setActiveProviderId(id);
    window.api.store.set('activeProviderId', id);
    const provider = providersRef.current.find((p) => p.id === id);
    if (provider) {
      const selectedModel = selectModelForProvider(provider);
      setActiveModelState(selectedModel);
      window.api.store.set('activeModel', selectedModel);
    }
  }, []);

  const setActiveModel = useCallback((model: string) => {
    setActiveModelState(model);
    window.api.store.set('activeModel', model);
  }, []);

  const saveProvider = useCallback(async (provider: ModelProviderConfig, apiKey: string) => {
    const normalizedProvider = normalizeProviderForSave(provider);
    if (apiKey) {
      await window.api.store.encryptAndStore(normalizedProvider.apiKeyRef, apiKey);
    }
    const nextProviders = upsertProvider(providersRef.current, normalizedProvider);
    providersRef.current = nextProviders;
    await window.api.store.set('providers', nextProviders);
    setProviders(nextProviders);

    if (!activeProviderId) {
      const selectedModel = selectModelForProvider(normalizedProvider);
      setActiveProviderId(normalizedProvider.id);
      setActiveModelState(selectedModel);
      await window.api.store.set('activeProviderId', normalizedProvider.id);
      await window.api.store.set('activeModel', selectedModel);
    } else if (activeProviderId === normalizedProvider.id) {
      const selectedModel = selectModelForProvider(normalizedProvider, activeModel);
      if (selectedModel !== activeModel) {
        setActiveModelState(selectedModel);
        await window.api.store.set('activeModel', selectedModel);
      }
    }
  }, [activeProviderId, activeModel]);

  const deleteProvider = useCallback(async (id: string) => {
    const nextState = selectProviderAfterDelete(providersRef.current, activeProviderId, id);
    setProviders(nextState.providers);
    await window.api.store.set('providers', nextState.providers);

    if (activeProviderId === id) {
      setActiveProviderId(nextState.activeProviderId);
      setActiveModelState(nextState.activeModel);
      await window.api.store.set('activeProviderId', nextState.activeProviderId);
      await window.api.store.set('activeModel', nextState.activeModel);
    }
  }, [activeProviderId]);

  const testProvider = useCallback(async (id: string) => {
    return window.api.ai.testConnection(id);
  }, []);

  const saveAgent = useCallback((agent: Agent) => {
    setAgents((prev) => {
      const next = upsertAgent(prev, agent);
      void window.api.store.set('agents', next);
      return next;
    });
  }, []);

  const deleteAgent = useCallback((id: string) => {
    setAgents((prev) => {
      const next = removeAgentById(prev, id);
      void window.api.store.set('agents', next);
      return next;
    });
  }, []);

  const toggleAgent = useCallback((id: string, enabled: boolean) => {
    setAgents((prev) => {
      const next = setAgentEnabled(prev, id, enabled);
      void window.api.store.set('agents', next);
      return next;
    });
  }, []);

  const setDebateRoleConfig = useCallback(
    (role: DebateStageName, cfg: Partial<DebateConfig[DebateStageName]>) => {
      setDebateConfig((prev) => {
        const next = { ...prev, [role]: { ...prev[role], ...cfg } };
        void window.api.store.set('debateConfig', next);
        return next;
      });
    },
    []
  );

  const runDebateTask = useCallback(
    async (conversationId: string, request: string, workspaceRoot: string): Promise<RunDebateTaskResult> => {
      const normalizedConfig = normalizeDebateConfig(debateConfig, providersRef.current);
      const configError = validateDebateConfig(normalizedConfig, providersRef.current);
      if (configError) return { ok: false, error: configError };

      debateAbortRef.current?.abort();
      const controller = new AbortController();
      debateAbortRef.current = controller;
      const run: DebateRun = { id: uuid(), request, stages: [], startedAt: Date.now() };
      setCurrentDebate(run);
      let runError: string | undefined;
      const callbacks = {
        onStage: (e: { stage: DebateStageName; start: boolean }) => {
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
        onError: (msg: string) => {
          runError = msg;
          setCurrentDebate((prev) => (prev ? { ...prev, error: msg, finishedAt: Date.now() } : prev));
        },
        signal: controller.signal,
      };
      const result: Awaited<ReturnType<typeof runDebateFull>> = await runDebateFull(normalizedConfig, request, workspaceRoot, callbacks).catch((error) => {
        runError = error instanceof Error ? error.message : String(error);
        return { scratchpad: null as never, calls: 0 };
      });
      const finalError = runError || (!result.execution ? '多角色流程未产生可执行结果' : undefined);
      if (result.worktreePath && result.worktreeBranch) {
        const baseBranch = result.worktreeBaseBranch || (await window.api.git.currentBranch(workspaceRoot).catch(() => 'main'));
        setConversations((prev) =>
          prev.map((conv) =>
            conv.id === conversationId
              ? {
                  ...conv,
                  title: conv.title === '新任务' ? `多角色 ${result.worktreeBranch}` : conv.title,
                  updatedAt: Date.now(),
                  worktree: { path: result.worktreePath!, branch: result.worktreeBranch!, baseBranch },
                }
              : conv
          )
        );
      }
      setCurrentDebate((prev) => (prev ? { ...prev, error: finalError ?? prev.error, finishedAt: Date.now() } : prev));
      if (debateAbortRef.current === controller) debateAbortRef.current = null;
      if (finalError) {
        return {
          ok: false,
          error: finalError,
          worktreePath: result.worktreePath,
          worktreeBranch: result.worktreeBranch,
          worktreeBaseBranch: result.worktreeBaseBranch,
        };
      }
      return {
        ok: true,
        editedFiles: result.execution?.editedFiles,
        note: result.execution?.note,
        worktreePath: result.worktreePath,
        worktreeBranch: result.worktreeBranch,
        worktreeBaseBranch: result.worktreeBaseBranch,
      };
    },
    [debateConfig]
  );

  const stopDebate = useCallback(() => {
    debateAbortRef.current?.abort();
    debateAbortRef.current = null;
    void window.api.ai.abort();
    setCurrentDebate((prev) => (prev ? { ...prev, error: prev.error || '多角色流程已取消', finishedAt: Date.now() } : prev));
  }, []);

  const newConversation = useCallback(
    (providerId?: string, model?: string): string => {
      const id = uuid();
      const pid = providerId || activeProviderId || '';
      const mdl = model || activeModel || '';
      const conv: Conversation = {
        id,
        title: '新任务',
        messages: [],
        providerId: pid,
        model: mdl,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      setConversations((prev) => [conv, ...prev]);
      setActiveConversationId(id);
      return id;
    },
    [activeProviderId, activeModel]
  );

  const newWorktreeConversation = useCallback(
    async (worktreePath: string, branch: string, baseBranch: string): Promise<string> => {
      const id = uuid();
      const pid = activeProviderId || '';
      const mdl = activeModel || '';
      const conv: Conversation = {
        id,
        title: `WT ${branch}`,
        messages: [],
        providerId: pid,
        model: mdl,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        worktree: { path: worktreePath, branch, baseBranch },
      };
      setConversations((prev) => [conv, ...prev]);
      setActiveConversationId(id);
      return id;
    },
    [activeProviderId, activeModel]
  );

  const addConversation = useCallback((conv: Conversation) => {
    setConversations((prev) => {
      if (prev.find((c) => c.id === conv.id)) return prev;
      return [conv, ...prev];
    });
    setActiveConversationId(conv.id);
  }, []);

  const setActiveConversation = useCallback((id: string) => {
    setActiveConversationId(id);
  }, []);

  const deleteConversation = useCallback((id: string) => {
    // Reclaim the conversation's isolated worktree (debate/orchestrate) so its
    // <mainRoot>_wt/<branch> directory + branch don't leak on disk after the
    // conversation is removed. Fire-and-forget; worktreeRemove still prompts for
    // confirmation (IPC-enforced), giving the user a chance to keep the work.
    const conv = conversationsRef.current.find((c) => c.id === id);
    const wt = conv?.worktree;
    if (wt?.path) {
      const mainRoot = mainRepoFromWorktreePath(wt.path);
      if (mainRoot) {
        void window.api.git.worktreeRemove(mainRoot, wt.path, wt.branch).catch(() => {});
      }
    }
    setConversations((prev) => prev.filter((c) => c.id !== id));
    setActiveConversationId((current) => {
      if (current !== id) return current;
      const remaining = conversationsRef.current.filter((c) => c.id !== id);
      return remaining.length ? remaining[0].id : null;
    });
  }, []);

  const addMessage = useCallback((conversationId: string, message: ChatMessage) => {
    setConversations((prev) =>
      prev.map((c) =>
        c.id === conversationId
          ? {
              ...c,
              messages: [...c.messages, message],
              updatedAt: Date.now(),
              title: c.messages.length === 0 && message.role === 'user'
                ? message.content.slice(0, 40)
                : c.title,
            }
          : c
      )
    );
  }, []);

  const updateMessage = useCallback((conversationId: string, messageId: string, patch: Partial<ChatMessage>) => {
    setConversations((prev) =>
      prev.map((c) =>
        c.id === conversationId
          ? {
              ...c,
              messages: c.messages.map((m) => (m.id === messageId ? { ...m, ...patch } : m)),
              updatedAt: Date.now(),
            }
          : c
      )
    );
  }, []);

  const renameConversation = useCallback((conversationId: string, title: string) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === conversationId ? { ...c, title, updatedAt: Date.now() } : c))
    );
  }, []);

  const updateOrchestrationSession = useCallback((sessionId: string, patch: Partial<OrchestrationSession>) => {
    setOrchestrationSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, ...patch } : s))
    );
  }, []);

  /** Run isolated tasks in parallel; decompose the goal with the active model when needed. */
  const orchestrate = useCallback(async (goal: string, subTasks?: string[]): Promise<OrchestrationSession> => {
    const sessionId = uuid();
    let tasks: OrchestrationTask[] = [];

    // Step 1: Auto-decompose via LLM if no subtasks provided
    if (!subTasks || subTasks.length === 0) {
      if (!activeProviderId || !activeModel) {
        throw new Error('No active model provider or model');
      }

      const decomposePrompt = `You are a task decomposition engine. Given a large goal, split it into 2-5 independent subtasks that can be executed in parallel by separate task runners.

Goal: ${goal}

Rules:
- Each subtask must be independently actionable (no dependencies between subtasks)
- Each subtask should be self-contained (clear start and end)
- Return ONLY a JSON array of strings, nothing else. No markdown, no explanation.
- Example format: ["task 1 description", "task 2 description", "task 3 description"]

Response:`;

      try {
        const result = await window.api.ai.chat(
          activeProviderId,
          [{ role: 'user', content: decomposePrompt }],
          {
            model: activeModel,
            systemPrompt:
              'You are a task decomposition engine. Return ONLY a JSON array of subtask strings. No explanations. No markdown. Just the array.',
            maxTokens: 400,
            temperature: 0.1,
          }
        );

        const raw = result?.content?.trim() || '[]';
        // Try to extract JSON array
        const jsonMatch = raw.match(/\[[\s\S]*?\]/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (Array.isArray(parsed) && parsed.length > 0) {
            subTasks = parsed.filter((s: string) => typeof s === 'string' && s.trim().length > 0);
          }
        }
      } catch (err) {
        console.error('Task decomposition failed:', err);
      }

      // Fallback if decomposition failed
      if (!subTasks || subTasks.length === 0) {
        subTasks = [goal]; // Fall back to single task
      }
    }

    if (!rootPath) {
      throw new Error('需要先打开一个 Git 项目才能运行并行任务');
    }
    if (!activeProviderId || !activeModel) {
      throw new Error('需要先配置模型服务和模型才能运行并行任务');
    }
    const baseBranch = await window.api.git.currentBranch(rootPath);
    const parentDir = rootPath.endsWith('/') ? rootPath.slice(0, -1) : rootPath;
    const runConfigs = new Map<
      string,
      { providerId: string; model: string; workspaceRoot: string }
    >();

    // Step 2: Create worktree for each subtask
    for (let i = 0; i < subTasks.length; i++) {
      const branch = `task-${sessionId.slice(0, 6)}-${i + 1}`;
      const wtPath = `${parentDir}_wt/${branch}`;
      try {
        const res = await window.api.git.worktreeAdd(rootPath, wtPath, branch, baseBranch);
        if (!res.success) throw new Error(res.message);
        const convId = await newWorktreeConversation(res.path, branch, baseBranch);
        runConfigs.set(convId, {
          providerId: activeProviderId,
          model: activeModel,
          workspaceRoot: res.path || wtPath,
        });

        tasks.push({
          id: uuid(),
          description: subTasks[i],
          conversationId: convId,
          status: 'pending',
        });
      } catch (err: any) {
        tasks.push({
          id: uuid(),
          description: subTasks[i],
          conversationId: '',
          status: 'failed',
          error: `创建 worktree 失败: ${err.message}`,
        });
      }
    }

    const session: OrchestrationSession = {
      id: sessionId,
      goal,
      tasks,
      createdAt: Date.now(),
      status: 'running',
    };

    setOrchestrationSessions((prev) => [session, ...prev]);

    // Update one task immutably and re-publish the session so React reliably
    // re-renders per-task state. Mutating the task objects in place and then
    // shallow-copying the array left nested changes invisible to reconciliation.
    const patchTask = (taskId: string, patch: Partial<OrchestrationTask>) => {
      setOrchestrationSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId
            ? { ...s, tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)) }
            : s
        )
      );
    };

    // Step 3: Start all tasks in parallel
    const promises = tasks
      .filter((t) => t.status !== 'failed')
      .map(async (task) => {
        try {
          const conv = conversationsRef.current.find((c) => c.id === task.conversationId);
          const runConfig = conv?.worktree?.path
            ? { providerId: conv.providerId, model: conv.model, workspaceRoot: conv.worktree.path }
            : runConfigs.get(task.conversationId);
          if (!runConfig) throw new Error('子任务缺少运行配置');

          patchTask(task.id, { status: 'running' });

          // Track edited files locally for this run, then push once on completion
          // (avoid a state update per file write).
          const edited: string[] = [];
          // Drive the sub-task with the task engine (tools enabled) inside its
          // isolated worktree, instead of a single tool-less model completion.
          const result = await runHeadlessTask({
            providerId: runConfig.providerId,
            model: runConfig.model,
            workspaceRoot: runConfig.workspaceRoot,
            task: task.description,
            onFileWritten: (filePath) => {
              if (!edited.includes(filePath)) edited.push(filePath);
            }
          });
          patchTask(task.id, {
            status: 'completed',
            result: result.note ? `${result.content}\n\n[warning] ${result.note}` : result.content,
            editedFiles: edited.length ? [...(task.editedFiles || []), ...edited] : task.editedFiles,
          });
        } catch (err: any) {
          patchTask(task.id, { status: 'failed', error: err.message });
        }
      });

    await Promise.allSettled(promises);

    // Read the final task statuses from state (immutable updates kept them
    // correct) rather than from the mutated-by-reference `tasks` array.
    // Garbage-collect worktrees for tasks that failed before doing any work
    // (worktree creation failed, so no conversation/changes exist) and prune
    // stale metadata. Worktrees that actually ran — even if the task later
    // failed — are KEPT so partial work isn't lost; the user reclaims them via
    // the session-tab cleanup (which now removes the branch too). The bigger
    // disk win comes from sharing node_modules via symlink at creation time.
    if (rootPath) {
      await window.api.git.worktreePrune(rootPath).catch(() => undefined);
    }

    // Check if all tasks failed — recompute from the updated session state.
    const finalSession = orchestrationSessionsRef.current.find((s) => s.id === sessionId);
    const allFailed = (finalSession?.tasks || tasks).every((t) => t.status === 'failed');
    const finished: OrchestrationSession = {
      ...session,
      ...(finalSession ? { tasks: finalSession.tasks } : {}),
      status: allFailed ? 'failed' : 'completed',
      completedAt: Date.now(),
    };
    setOrchestrationSessions((prev) => prev.map((s) => (s.id === sessionId ? finished : s)));

    return finished;
  }, [activeProviderId, activeModel, newWorktreeConversation, rootPath]);

  return (
    <TaskContext.Provider
      value={{
        providers,
        activeProviderId,
        activeModel,
        conversations,
        activeConversationId,
        orchestrationSessions,
        setActiveProvider,
        setActiveModel,
        saveProvider,
        deleteProvider,
        testProvider,
        agents,
        saveAgent,
        deleteAgent,
        toggleAgent,
        newConversation,
        newWorktreeConversation,
        setActiveConversation,
        deleteConversation,
        addConversation,
        addMessage,
        updateMessage,
        renameConversation,
        orchestrate,
        updateOrchestrationSession,
        debateConfig,
        setDebateRoleConfig,
        currentDebate,
        runDebateTask,
        stopDebate,
      }}
    >
      {children}
    </TaskContext.Provider>
  );
}

export function useTaskWorkspace() {
  const ctx = useContext(TaskContext);
  if (!ctx) throw new Error('useTaskWorkspace must be used within TaskContextProvider');
  return ctx;
}
