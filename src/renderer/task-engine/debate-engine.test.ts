import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runDebate, STAGE_SEQUENCE, type DebateConfig } from './debate-engine';
import { createScratchpad } from '@shared/scratchpad';
import type { ChatResult } from '@shared/types';

/** Mock window.api.ai.chat with a scripted sequence of responses. */
function installApi(responses: string[]) {
  let i = 0;
  const chat = vi.fn(async (): Promise<ChatResult> => ({
    content: responses[Math.min(i++, responses.length - 1)],
    finishReason: 'stop',
  }));
  (globalThis as any).window = { api: { ai: { chat } } };
  return { chat };
}

const CONFIG: DebateConfig = {
  analyst: { providerId: 'p1', model: 'm1', temperature: 0.3 },
  proposer: { providerId: 'p2', model: 'm2', temperature: 0.2 },
  critic: { providerId: 'p3', model: 'm3', temperature: 0.7 },
  synthesizer: { providerId: 'p4', model: 'm4', temperature: 0.2 },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('STAGE_SEQUENCE', () => {
  it('lists the 5 discussion stages in order', () => {
    expect(STAGE_SEQUENCE).toEqual(['analyst', 'proposer', 'critic', 'proposer', 'synthesizer']);
  });
});

describe('runDebate', () => {
  it('runs all 5 discussion stages in order and fills the scratchpad', async () => {
    const { chat } = installApi([
      '{"requirements":["搜索文件"],"constraints":["无新依赖"],"context":"src/"}',
      '{"approach":"用 glob","files":[],"steps":["写工具"]}',
      '{"critiques":[{"severity":"high","issue":"性能","suggestion":"加缓存"}]}',
      '{"revised_proposal":{"approach":"用 glob + 缓存","files":[],"steps":["写工具","加缓存"]},"changes":["加了缓存"],"dismissed":[]}',
      '{"final_plan":{"approach":"glob+缓存","steps":[{"action":"create","target":"search.ts","detail":"实现"}],"rollback":"删文件"}}',
    ]);
    const events: string[] = [];
    const result = await runDebate(
      CONFIG,
      createScratchpad('加文件搜索'),
      { onStage: (e) => { if (e.start) events.push(e.stage); } }
    );
    expect(chat).toHaveBeenCalledTimes(5);
    expect(events).toEqual(['analyst', 'proposer', 'critic', 'proposer', 'synthesizer']);
    expect(result.scratchpad.analysis?.requirements).toEqual(['搜索文件']);
    expect(result.scratchpad.critiques?.[0].severity).toBe('high');
    expect(result.scratchpad.final_plan?.steps[0].target).toBe('search.ts');
  });

  it('calls onError and stops if a stage output fails to parse', async () => {
    installApi(['这不是JSON']);
    let errMsg = '';
    const result = await runDebate(CONFIG, createScratchpad('test'), {
      onStage: () => {},
      onError: (msg) => { errMsg = msg; },
    });
    expect(errMsg).toBeTruthy();
    expect(result.scratchpad.analysis).toBeNull();
  });
});
