import { describe, expect, it } from 'vitest';
import type { ModelProvider, Agent } from '@shared/types';
import {
  BUILTIN_CLI_AGENTS,
  normalizeProviderForSave,
  removeAgentById,
  seedAgents,
  selectModelForProvider,
  selectProviderAfterDelete,
  setAgentEnabled,
  upsertAgent,
  upsertProvider,
} from './TaskContext';

const provider = (id: string, defaultModel: string): ModelProvider => ({
  id,
  name: id,
  type: 'openai',
  baseURL: 'https://example.test',
  apiKeyRef: `apiKey:${id}`,
  models: [defaultModel],
  defaultModel,
});

const providerWithModels = (id: string, models: string[], defaultModel: string): ModelProvider => ({
  ...provider(id, defaultModel),
  models,
  defaultModel,
});

describe('selectModelForProvider', () => {
  it('keeps the preferred model when the provider still exposes it', () => {
    const p = providerWithModels('p1', ['gpt-a', 'gpt-b'], 'gpt-a');

    expect(selectModelForProvider(p, 'gpt-b')).toBe('gpt-b');
  });

  it('falls back to the provider default when the preferred model is stale', () => {
    const p = providerWithModels('p1', ['gpt-a', 'gpt-b'], 'gpt-a');

    expect(selectModelForProvider(p, 'removed-model')).toBe('gpt-a');
  });

  it('falls back to the first listed model when the default model is stale', () => {
    const p = providerWithModels('p1', ['gpt-a'], 'removed-default');

    expect(selectModelForProvider(p, 'removed-model')).toBe('gpt-a');
  });
});

describe('normalizeProviderForSave', () => {
  it('trims models and moves a stale default model to the first valid model', () => {
    expect(
      normalizeProviderForSave(
        providerWithModels('p1', [' gpt-a ', '', 'gpt-b '], 'removed-default')
      )
    ).toMatchObject({
      models: ['gpt-a', 'gpt-b'],
      defaultModel: 'gpt-a',
    });
  });
});

describe('upsertProvider', () => {
  it('adds a new provider to the end of the list', () => {
    const p1 = provider('p1', 'gpt-a');
    const p2 = provider('p2', 'gpt-b');

    expect(upsertProvider([p1], p2)).toEqual([p1, p2]);
  });

  it('replaces an existing provider without changing list order', () => {
    const p1 = provider('p1', 'gpt-a');
    const updated = { ...p1, name: 'updated' };
    const p2 = provider('p2', 'gpt-b');

    expect(upsertProvider([p1, p2], updated)).toEqual([updated, p2]);
  });
});

describe('selectProviderAfterDelete', () => {
  it('moves the active provider to the first remaining provider when deleting the active one', () => {
    const p1 = provider('p1', 'gpt-a');
    const p2 = provider('p2', 'gpt-b');

    expect(selectProviderAfterDelete([p1, p2], 'p1', 'p1')).toEqual({
      providers: [p2],
      activeProviderId: 'p2',
      activeModel: 'gpt-b',
    });
  });

  it('keeps the current active provider when deleting another provider', () => {
    const p1 = provider('p1', 'gpt-a');
    const p2 = provider('p2', 'gpt-b');

    expect(selectProviderAfterDelete([p1, p2], 'p2', 'p1')).toEqual({
      providers: [p2],
      activeProviderId: 'p2',
      activeModel: null,
    });
  });

  it('clears active provider and model when no providers remain', () => {
    const p1 = provider('p1', 'gpt-a');

    expect(selectProviderAfterDelete([p1], 'p1', 'p1')).toEqual({
      providers: [],
      activeProviderId: null,
      activeModel: null,
    });
  });
});

const agent = (id: string, over: Partial<Agent> = {}): Agent => ({
  id,
  name: id,
  enabled: true,
  kind: 'api',
  role: 'general',
  providerId: 'p1',
  model: 'm',
  ...over,
});

describe('seedAgents', () => {
  it('returns the built-in CLI agents when nothing is stored', () => {
    expect(seedAgents(undefined).map((a) => a.id)).toEqual(BUILTIN_CLI_AGENTS.map((a) => a.id));
    expect(seedAgents([]).map((a) => a.id)).toEqual(BUILTIN_CLI_AGENTS.map((a) => a.id));
  });

  it('returns stored agents untouched when present', () => {
    const stored = [agent('a1')];
    expect(seedAgents(stored)).toBe(stored);
  });

  it('seeds a fresh copy so mutating the result does not touch the defaults', () => {
    const seeded = seedAgents(undefined);
    seeded[0].enabled = true;
    expect(BUILTIN_CLI_AGENTS[0].enabled).toBe(false);
  });
});

describe('upsertAgent', () => {
  it('appends a new agent', () => {
    const a1 = agent('a1');
    const a2 = agent('a2');
    expect(upsertAgent([a1], a2)).toEqual([a1, a2]);
  });

  it('replaces an existing agent in place', () => {
    const a1 = agent('a1');
    const a2 = agent('a2');
    const updated = { ...a1, name: 'renamed' };
    expect(upsertAgent([a1, a2], updated)).toEqual([updated, a2]);
  });
});

describe('removeAgentById', () => {
  it('drops the matching agent', () => {
    expect(removeAgentById([agent('a1'), agent('a2')], 'a1')).toEqual([agent('a2')]);
  });
});

describe('setAgentEnabled', () => {
  it('flips only the matching agent', () => {
    const out = setAgentEnabled([agent('a1', { enabled: true }), agent('a2', { enabled: true })], 'a1', false);
    expect(out[0].enabled).toBe(false);
    expect(out[1].enabled).toBe(true);
  });
});
