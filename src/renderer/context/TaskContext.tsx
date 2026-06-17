import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { v4 as uuid } from 'uuid';
import type { ModelProvider as ModelProviderConfig, Conversation, ChatMessage, OrchestrationSession, OrchestrationTask } from '@shared/types';
import { useWorkspace } from './WorkspaceContext';
import { runHeadlessTask } from '../task-engine/headlessTaskRunner';
import {
  loadConversations,
  createConversationPersister,
  type StoreBackend,
} from './conversationStore';

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

export function TaskContextProvider({ children }: { children: React.ReactNode }) {
  const [providers, setProviders] = useState<ModelProviderConfig[]>([]);
  const [activeProviderId, setActiveProviderId] = useState<string | null>(null);
  const [activeModel, setActiveModelState] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [orchestrationSessions, setOrchestrationSessions] = useState<OrchestrationSession[]>([]);
  const { rootPath } = useWorkspace();

  const providersRef = useRef<ModelProviderConfig[]>([]);
  providersRef.current = providers;
  const conversationsRef = useRef<Conversation[]>([]);
  conversationsRef.current = conversations;

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

      if (storedProviders?.length) {
        const normalizedProviders = storedProviders.map(normalizeProviderForSave);
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
          } as any
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

          task.status = 'running';
          // Refresh session to show running state
          setOrchestrationSessions((prev) =>
            prev.map((s) => (s.id === sessionId ? { ...s, tasks: [...tasks] } : s))
          );

          // Drive the sub-task with the task engine (tools enabled) inside its
          // isolated worktree, instead of a single tool-less model completion.
          const result = await runHeadlessTask({
            providerId: runConfig.providerId,
            model: runConfig.model,
            workspaceRoot: runConfig.workspaceRoot,
            task: task.description,
            onFileWritten: (filePath) => {
              task.editedFiles = task.editedFiles || [];
              if (!task.editedFiles.includes(filePath)) {
                task.editedFiles.push(filePath);
                setOrchestrationSessions((prev) =>
                  prev.map((s) => (s.id === sessionId ? { ...s, tasks: [...tasks] } : s))
                );
              }
            }
          });
          task.result = result.note ? `${result.content}\n\n[warning] ${result.note}` : result.content;
          task.status = 'completed';
        } catch (err: any) {
          task.status = 'failed';
          task.error = err.message;
        }
      });

    await Promise.allSettled(promises);

    // Garbage-collect worktrees for tasks that failed before doing any work
    // (worktree creation failed, so no conversation/changes exist) and prune
    // stale metadata. Worktrees that actually ran — even if the task later
    // failed — are KEPT so partial work isn't lost; the user reclaims them via
    // the session-tab cleanup (which now removes the branch too). The bigger
    // disk win comes from sharing node_modules via symlink at creation time.
    if (rootPath) {
      await window.api.git.worktreePrune(rootPath).catch(() => undefined);
    }

    // Check if all tasks failed
    const allFailed = tasks.every((t) => t.status === 'failed');
    session.status = allFailed ? 'failed' : 'completed';
    session.completedAt = Date.now();
    setOrchestrationSessions((prev) => prev.map((s) => (s.id === sessionId ? session : s)));

    return session;
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
