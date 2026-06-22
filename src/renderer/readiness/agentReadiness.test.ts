import { describe, expect, it } from 'vitest';
import { getAgentReadiness } from './agentReadiness';
import type { Agent } from '@shared/types';

const provider = {
  id: 'openai',
  name: 'OpenAI',
  type: 'openai' as const,
  baseURL: 'https://api.openai.com/v1',
  apiKeyRef: 'apiKey:openai',
  models: ['gpt-4o-mini'],
  defaultModel: 'gpt-4o-mini',
};

const cliAgent = (enabled = true): Agent => ({
  id: 'cli-claude-code',
  name: 'Claude Code',
  enabled,
  kind: 'claude-code',
  model: '',
});

const disabledCliAgent = (): Agent => ({ ...cliAgent(false) });

describe('getAgentReadiness', () => {
  it('blocks on workspace first when nothing is configured', () => {
    const readiness = getAgentReadiness({
      rootPath: null,
      providers: [],
      activeProviderId: null,
      activeModel: null,
      embeddingConfig: null,
    });

    expect(readiness.canRunAgent).toBe(false);
    expect(readiness.items.map((item) => [item.id, item.status, item.actionId])).toEqual([
      ['workspace', 'blocked', 'openWorkspace'],
      ['model', 'blocked', 'openSettings'],
      ['indexing', 'optional', 'openIndexSettings'],
      ['task', 'blocked', 'openTaskPanel'],
    ]);
    expect(readiness.nextActionId).toBe('openWorkspace');
  });

  it('blocks on model when a workspace is open but no provider is configured', () => {
    const readiness = getAgentReadiness({
      rootPath: '/repo',
      providers: [],
      activeProviderId: null,
      activeModel: null,
      embeddingConfig: null,
    });

    expect(readiness.canRunAgent).toBe(false);
    expect(readiness.items[0]).toMatchObject({ id: 'workspace', status: 'done' });
    expect(readiness.items[1]).toMatchObject({ id: 'model', status: 'blocked', actionId: 'openSettings' });
    expect(readiness.nextActionId).toBe('openSettings');
  });

  it('is runnable when workspace, active provider, and active model are configured', () => {
    const readiness = getAgentReadiness({
      rootPath: '/repo',
      providers: [provider],
      activeProviderId: provider.id,
      activeModel: 'gpt-4o-mini',
      embeddingConfig: null,
    });

    expect(readiness.canRunAgent).toBe(true);
    expect(readiness.items.map((item) => [item.id, item.status])).toEqual([
      ['workspace', 'done'],
      ['model', 'done'],
      ['indexing', 'optional'],
      ['task', 'ready'],
    ]);
    expect(readiness.nextActionId).toBe('openTaskPanel');
  });

  it('marks indexing as done only when provider and model are configured', () => {
    const readiness = getAgentReadiness({
      rootPath: '/repo',
      providers: [provider],
      activeProviderId: provider.id,
      activeModel: 'gpt-4o-mini',
      embeddingConfig: { providerId: provider.id, model: 'text-embedding-3-small' },
    });

    expect(readiness.items.find((item) => item.id === 'indexing')).toMatchObject({
      status: 'done',
      actionId: 'openIndexSettings',
    });
  });
});
