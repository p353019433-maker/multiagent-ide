/**
 * Behavior tests for the discussion engine (Phase 2 multi-agent).
 *
 * Covers what the pure-helper tests don't: the round loop, the parallel
 * fan-out, the moderator selection (API preferred → contributor fallback),
 * cooperative abort, and empty-transcript short-circuit.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runDiscussion, type DiscussionAgent } from './agentDiscussion';

const ROOT = '/repo';

type ChatScript = { content: string };

/** Install a fake window.api with scripted ai.chat + cliAgent.run responses. */
function installApi(chatPerCall: ChatScript[] = [], cliPerCall: { ok: boolean; output: string; error?: string }[] = []) {
  let chatI = 0;
  let cliI = 0;
  const chat = vi.fn(async () => chatPerCall[Math.min(chatI++, chatPerCall.length - 1)] ?? { content: '' });
  const cliRun = vi.fn(async () => cliPerCall[Math.min(cliI++, cliPerCall.length - 1)] ?? { ok: true, output: '' });
  const skills = { list: vi.fn(async () => []) };
  (globalThis as any).window = { api: { ai: { chat }, cliAgent: { run: cliRun }, skills }, dispatchEvent: vi.fn() };
  return { chat, cliRun };
}

const apiAgent = (id: string, name = id): DiscussionAgent => ({
  id, name, kind: 'api', providerId: 'prov-' + id, model: 'm-' + id,
});
const cliAgent = (id: string, name = id): DiscussionAgent => ({
  id, name, kind: 'codex', model: '',
});

beforeEach(() => {
  (globalThis as any).window = undefined;
});

describe('runDiscussion — round loop', () => {
  it('runs N rounds, collecting a transcript entry per agent per round', async () => {
    // 2 agents × 2 rounds = 4 chat calls; moderator is a 5th.
    installApi([
      { content: 'A-r1' }, { content: 'B-r1' },
      { content: 'A-r2' }, { content: 'B-r2' },
      { content: 'PLAN' },
    ]);
    const { chat } = installApi([
      { content: 'A-r1' }, { content: 'B-r1' },
      { content: 'A-r2' }, { content: 'B-r2' },
      { content: 'PLAN' },
    ]);
    void chat;

    const messages: { agentId: string; round: number; text: string }[] = [];
    const res = await runDiscussion({
      agents: [apiAgent('a', 'A'), apiAgent('b', 'B')],
      question: '怎么做？',
      rounds: 2,
      rootPath: ROOT,
      onMessage: (m) => messages.push(m),
    });

    // 4 transcript entries, 2 rounds each with 2 agents.
    expect(res.transcript).toHaveLength(4);
    expect(messages).toHaveLength(4);
    expect(res.transcript.filter((m) => m.round === 1)).toHaveLength(2);
    expect(res.transcript.filter((m) => m.round === 2)).toHaveLength(2);
    // The plan is the moderator's output.
    expect(res.plan).toBe('PLAN');
    expect(res.aborted).toBe(false);
  });

  it('skips agents that produce no text (empty reply → no transcript entry)', async () => {
    installApi([
      { content: 'A-r1' }, { content: '' },          // B says nothing round 1
      { content: 'A-r2' }, { content: 'B-r2' },        // B recovers round 2
      { content: 'PLAN' },
    ]);
    const res = await runDiscussion({
      agents: [apiAgent('a', 'A'), apiAgent('b', 'B')],
      question: 'q',
      rounds: 2,
      rootPath: ROOT,
    });
    expect(res.transcript).toHaveLength(3);
    expect(res.transcript.some((m) => m.agentId === 'b' && m.round === 1)).toBe(false);
  });

  it('routes CLI agents through cliAgent.run, not ai.chat', async () => {
    const { chat, cliRun } = installApi(
      [{ content: 'PLAN' }],                              // only moderator (API)
      [{ ok: true, output: 'CLI 讨论回复' }]             // 1 CLI agent × 1 round
    );
    const res = await runDiscussion({
      agents: [cliAgent('c', 'CLI')],
      question: 'q',
      rounds: 1,
      rootPath: ROOT,
    });
    // CLI agent ran via cliAgent.run; ai.chat was NOT called for the discussion turn
    // (only the moderator fallback uses ai.chat — but with a CLI-only roster and an
    // empty transcript the moderator never runs, so ai.chat should be untouched).
    expect(cliRun).toHaveBeenCalled();
    expect(chat).not.toHaveBeenCalled();
    // CLI output is condensed but the text survives.
    expect(res.transcript[0]?.text).toContain('CLI');
  });
});

describe('runDiscussion — moderator selection', () => {
  it('prefers an API agent as moderator even when a CLI agent spoke first', async () => {
    const { chat, cliRun } = installApi(
      [
        { content: 'API-r1' },   // API agent's own discussion turn (round 1)
        { content: 'API-PLAN' }, // moderator convergence (API agent)
      ],
      [{ ok: true, output: 'CLI-r1' }]                   // 1 CLI turn
    );
    const res = await runDiscussion({
      agents: [cliAgent('c', 'CLI'), apiAgent('a', 'API')],
      question: 'q',
      rounds: 1,
      rootPath: ROOT,
    });
    // Both agents ran a discussion turn (1 round): CLI via cliAgent.run, API via ai.chat.
    expect(cliRun).toHaveBeenCalledTimes(1);
    // ai.chat fired twice — once for the API agent's discussion turn, once for
    // the moderator step (which prefers the API agent). The last call is the
    // moderator, and its reply is what becomes the plan.
    expect(chat).toHaveBeenCalledTimes(2);
    const moderatorCallArgs = (chat.mock.calls[1] as any[]);
    const moderatorMessages = moderatorCallArgs[1] as any[];
    expect(moderatorMessages.some((m: any) => typeof m.content === 'string' && m.content.includes('完整讨论'))).toBe(true);
    expect(res.plan).toBe('API-PLAN');
  });

  it('falls back to the first contributing agent when no API agent exists', async () => {
    const { cliRun } = installApi(
      [],
      [
        { ok: true, output: 'CLI-A-r1' },   // first CLI agent, round 1
        { ok: true, output: 'CLI-B-r1' },   // second CLI agent, round 1
        { ok: true, output: 'FALLBACK-PLAN' }, // moderator (first contributor = CLI-A)
      ]
    );
    const res = await runDiscussion({
      agents: [cliAgent('a', 'CLI-A'), cliAgent('b', 'CLI-B')],
      question: 'q',
      rounds: 1,
      rootPath: ROOT,
    });
    expect(res.plan).toBe('FALLBACK-PLAN');
    // 2 discussion turns + 1 moderator = 3 CLI calls.
    expect(cliRun).toHaveBeenCalledTimes(3);
  });
});

describe('runDiscussion — abort & empty', () => {
  it('aborts before the moderator when signal is set mid-run', async () => {
    const signal = { aborted: false };
    installApi([
      { content: 'A-r1' }, { content: 'B-r1' },
      { content: 'A-r2' }, { content: 'B-r2' },
      { content: 'PLAN' },
    ]);
    const res = await runDiscussion({
      agents: [apiAgent('a', 'A'), apiAgent('b', 'B')],
      question: 'q',
      rounds: 2,
      rootPath: ROOT,
      signal,
      onPhase: (phase) => {
        // Flip the abort flag as soon as we leave round 1, so the loop stops
        // before round 2 and the moderator never runs.
        if (phase.includes('2/2')) signal.aborted = true;
      },
    });
    expect(res.aborted).toBe(true);
    expect(res.plan).toBe('');
    // Only round 1 ran → 2 entries, not 4.
    expect(res.transcript).toHaveLength(2);
  });

  it('returns an empty plan with aborted=false when no agent contributed', async () => {
    installApi([
      { content: '' }, { content: '' },   // both agents silent
      { content: 'PLAN' },                // moderator never reached
    ]);
    const res = await runDiscussion({
      agents: [apiAgent('a', 'A'), apiAgent('b', 'B')],
      question: 'q',
      rounds: 1,
      rootPath: ROOT,
    });
    expect(res.transcript).toHaveLength(0);
    expect(res.plan).toBe('');
    expect(res.aborted).toBe(false);
  });
});
