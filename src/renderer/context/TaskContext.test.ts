import { describe, expect, it } from 'vitest';
import type { ModelProvider } from '@shared/types';
import {
  normalizeProviderForSave,
  selectModelForProvider,
  selectProviderAfterDelete,
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
