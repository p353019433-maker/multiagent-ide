import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { v4 as uuid } from 'uuid';
import type { AIProvider as AIProviderConfig, Conversation, ChatMessage, OrchestrationSession, OrchestrationTask } from '@shared/types';
import { AGENT_SYSTEM_PROMPT } from '@shared/tools';

interface AIContextValue {
  providers: AIProviderConfig[];
  activeProviderId: string | null;
  activeModel: string | null;
  conversations: Conversation[];
  activeConversationId: string | null;
  orchestrationSessions: OrchestrationSession[];

  setActiveProvider: (id: string) => void;
  setActiveModel: (model: string) => void;

  saveProvider: (provider: AIProviderConfig, apiKey: string) => Promise<void>;
  deleteProvider: (id: string) => Promise<void>;
  testProvider: (id: string) => Promise<{ ok: boolean; error?: string }>;

  newConversation: (providerId?: string, model?: string) => string;
  newWorktreeConversation: (worktreePath: string, branch: string, baseBranch: string) => Promise<string>;
  setActiveConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
  addConversation: (conv: Conversation) => void;
  addMessage: (conversationId: string, message: ChatMessage) => void;
  updateMessage: (conversationId: string, messageId: string, patch: Partial<ChatMessage>) => void;

  /** Orchestrate multiple agents in parallel — auto-decomposes goal via LLM */
  orchestrate: (goal: string, subTasks?: string[]) => Promise<OrchestrationSession>;
}

const AIContext = createContext<AIContextValue | null>(null);

export function AIContextProvider({ children }: { children: React.ReactNode }) {
  const [providers, setProviders] = useState<AIProviderConfig[]>([]);
  const [activeProviderId, setActiveProviderId] = useState<string | null>(null);
  const [activeModel, setActiveModelState] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [orchestrationSessions, setOrchestrationSessions] = useState<OrchestrationSession[]>([]);

  const providersRef = useRef<AIProviderConfig[]>([]);
  providersRef.current = providers;
  const conversationsRef = useRef<Conversation[]>([]);
  conversationsRef.current = conversations;

  useEffect(() => {
    (async () => {
      const storedProviders = (await window.api.store.get('providers')) as AIProviderConfig[] | undefined;
      const storedActiveId = (await window.api.store.get('activeProviderId')) as string | undefined;
      const storedActiveModel = (await window.api.store.get('activeModel')) as string | undefined;
      const storedConvs = (await window.api.store.get('conversations')) as Conversation[] | undefined;

      if (storedProviders?.length) {
        setProviders(storedProviders);
        const provider = storedProviders.find((p) => p.id === storedActiveId) || storedProviders[0];
        setActiveProviderId(provider.id);
        setActiveModelState(storedActiveModel || provider.defaultModel);
      }
      if (storedConvs?.length) {
        setConversations(storedConvs);
        setActiveConversationId(storedConvs[0].id);
      }
    })();
  }, []);

  useEffect(() => {
    if (conversations.length > 0) {
      window.api.store.set('conversations', conversations);
    }
  }, [conversations]);

  const setActiveProvider = useCallback((id: string) => {
    setActiveProviderId(id);
    window.api.store.set('activeProviderId', id);
    const provider = providersRef.current.find((p) => p.id === id);
    if (provider) {
      setActiveModelState(provider.defaultModel);
      window.api.store.set('activeModel', provider.defaultModel);
    }
  }, []);

  const setActiveModel = useCallback((model: string) => {
    setActiveModelState(model);
    window.api.store.set('activeModel', model);
  }, []);

  const saveProvider = useCallback(async (provider: AIProviderConfig, apiKey: string) => {
    if (apiKey) {
      await window.api.store.encryptAndStore(provider.apiKeyRef, apiKey);
    }
    setProviders((prev) => {
      const idx = prev.findIndex((p) => p.id === provider.id);
      const next = idx >= 0
        ? prev.map((p) => (p.id === provider.id ? provider : p))
        : [...prev, provider];
      window.api.store.set('providers', next);
      return next;
    });
    setActiveProviderId((current) => {
      if (!current) {
        window.api.store.set('activeProviderId', provider.id);
        setActiveModelState(provider.defaultModel);
        window.api.store.set('activeModel', provider.defaultModel);
        return provider.id;
      }
      return current;
    });
  }, []);

  const deleteProvider = useCallback(async (id: string) => {
    setProviders((prev) => {
      const next = prev.filter((p) => p.id !== id);
      window.api.store.set('providers', next);
      return next;
    });
    setActiveProviderId((current) => {
      if (current === id) {
        setActiveModelState(null);
        return null;
      }
      return current;
    });
  }, []);

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
        title: '新对话',
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
        title: `🪵 ${branch}`,
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
    setConversations((prev) => {
      const next = prev.filter((c) => c.id !== id);
      window.api.store.set('conversations', next);
      return next;
    });
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

  /** Orchestrate multiple agents in parallel — auto-decomposes goal via LLM */
  const orchestrate = useCallback(async (goal: string, subTasks?: string[]): Promise<OrchestrationSession> => {
    const sessionId = uuid();
    let tasks: OrchestrationTask[] = [];

    // Step 1: Auto-decompose via LLM if no subtasks provided
    if (!subTasks || subTasks.length === 0) {
      if (!activeProviderId || !activeModel) {
        throw new Error('No active AI provider or model');
      }

      const decomposePrompt = `You are a task decomposition engine. Given a large goal, split it into 2-5 independent subtasks that can be executed in parallel by different agents.

Goal: ${goal}

Rules:
- Each subtask must be independently actionable (no dependencies between subtasks)
- Each subtask should be self-contained (clear start and end)
- Return ONLY a JSON array of strings, nothing else. No markdown, no explanation.
- Example format: ["task 1 description", "task 2 description", "task 3 description"]

Response:`;

      try {
        const result = await window.api.ai.chat(activeProviderId, {
          model: activeModel,
          messages: [{ role: 'user', content: decomposePrompt }],
          systemPrompt: 'You are a task decomposition engine. Return ONLY a JSON array of subtask strings. No explanations. No markdown. Just the array.',
          maxTokens: 400,
          temperature: 0.1,
        } as any);

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

    // Step 2: Create worktree for each subtask
    for (let i = 0; i < subTasks.length; i++) {
      const branch = `agent-${sessionId.slice(0, 6)}-task-${i + 1}`;
      try {
        const worktreePath = await window.api.git.worktreeAdd(branch, 'main');
        const convId = await newWorktreeConversation(worktreePath, branch, 'main');

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

    // Step 3: Start all agents in parallel
    const promises = tasks
      .filter((t) => t.status !== 'failed')
      .map(async (task) => {
        try {
          const conv = conversationsRef.current.find((c) => c.id === task.conversationId);
          if (!conv) throw new Error('Conversation not found');

          task.status = 'running';
          // Refresh session to show running state
          setOrchestrationSessions((prev) =>
            prev.map((s) => (s.id === sessionId ? { ...s, tasks: [...tasks] } : s))
          );

          // Send initial message to the agent via main process (non-streaming for orchestration)
          const result = await window.api.ai.chat(conv.providerId, [
            { role: 'user', content: task.description }
          ], {
            model: conv.model,
            systemPrompt: AGENT_SYSTEM_PROMPT,
            workspaceRoot: conv.worktree?.path,
            tools: [],
          });
          task.result = result?.content || '';
          task.status = 'completed';

          task.status = 'completed';
        } catch (err: any) {
          task.status = 'failed';
          task.error = err.message;
        }
      });

    await Promise.allSettled(promises);

    // Check if all tasks failed
    const allFailed = tasks.every((t) => t.status === 'failed');
    session.status = allFailed ? 'failed' : 'completed';
    session.completedAt = Date.now();
    setOrchestrationSessions((prev) => prev.map((s) => (s.id === sessionId ? session : s)));

    return session;
  }, [activeProviderId, activeModel, newWorktreeConversation]);

  return (
    <AIContext.Provider
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
        orchestrate,
      }}
    >
      {children}
    </AIContext.Provider>
  );
}

export function useAI() {
  const ctx = useContext(AIContext);
  if (!ctx) throw new Error('useAI must be used within AIContextProvider');
  return ctx;
}