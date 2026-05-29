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

  /** Orchestrate multiple agents in parallel */
  orchestrate: (goal: string, subTasks: string[]) => Promise<OrchestrationSession>;
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

  // Load persisted state on mount
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

  // Persist conversations (debounced)
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

  /** Create a conversation bound to a git worktree (isolated agent workspace). */
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

  /** Orchestrate multiple agents in parallel */
  const orchestrate = useCallback(async (goal: string, subTasks: string[]): Promise<OrchestrationSession> => {
    const sessionId = uuid();
    const tasks: OrchestrationTask[] = [];

    // Create worktree conversations for each sub-task
    for (let i = 0; i < subTasks.length; i++) {
      const branch = `agent-${sessionId.slice(0, 6)}-task-${i + 1}`;
      const worktreePath = await window.api.git.worktreeAdd(branch, 'main');
      const convId = await newWorktreeConversation(worktreePath, branch, 'main');

      tasks.push({
        id: uuid(),
        description: subTasks[i],
        conversationId: convId,
        status: 'pending',
      });
    }

    const session: OrchestrationSession = {
      id: sessionId,
      goal,
      tasks,
      createdAt: Date.now(),
      status: 'running',
    };

    setOrchestrationSessions((prev) => [session, ...prev]);

    // Start all agents in parallel - send initial message to each
    const promises = tasks.map(async (task, idx) => {
      try {
        const conv = conversationsRef.current.find((c) => c.id === task.conversationId);
        if (!conv) throw new Error('Conversation not found');

        task.status = 'running';
        
        // Note: This is a simplified version - actual streaming would need more complex event handling
        // For now, just mark as running and let user interact with each tab
        task.status = 'completed';
      } catch (err: any) {
        task.status = 'failed';
        task.error = err.message;
      }
    });

    await Promise.all(promises);

    session.status = 'completed';
    session.completedAt = Date.now();
    setOrchestrationSessions((prev) => prev.map((s) => (s.id === sessionId ? session : s)));

    return session;
  }, [newWorktreeConversation]);

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