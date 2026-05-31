/**
 * Unit tests for the headless orchestration agent loop.
 *
 * Mocks window.api.ai.chat (the non-streaming model call) and an in-memory fs,
 * verifying the loop executes real tools, feeds results back, stops on a plain
 * completion, caps runaway loops, and surfaces tool errors without throwing.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runHeadlessAgent } from './headlessAgent';
import type { ToolCall } from '@shared/types';

const ROOT = '/wt';
let files: Map<string, string>;

/** Scripted sequence of model responses, consumed one per iteration. */
function installApi(responses: { content: string; toolCalls?: ToolCall[]; finishReason: string }[]) {
  let i = 0;
  const chat = vi.fn(async () => responses[Math.min(i++, responses.length - 1)]);
  const fs = {
    readFile: vi.fn(async (p: string) => {
      if (!files.has(p)) throw new Error(`ENOENT: ${p}`);
      return files.get(p)!;
    }),
    writeFile: vi.fn(async (p: string, c: string) => { files.set(p, c); }),
  };
  (globalThis as any).window = { api: { ai: { chat }, fs }, dispatchEvent: vi.fn() };
  return { chat, fs };
}

const tc = (name: string, args: Record<string, unknown>): ToolCall => ({ id: 't' + Math.random(), name, arguments: args });

beforeEach(() => {
  files = new Map();
});

describe('runHeadlessAgent', () => {
  it('stops immediately on a plain completion (no tools)', async () => {
    const { chat } = installApi([{ content: '完成了', finishReason: 'stop' }]);
    const res = await runHeadlessAgent({ providerId: 'p', model: 'm', workspaceRoot: ROOT, task: '做点事' });
    expect(res.content).toBe('完成了');
    expect(res.iterations).toBe(1);
    expect(chat).toHaveBeenCalledOnce();
    expect(res.note).toBeUndefined();
  });

  it('executes a tool, feeds the result back, then completes', async () => {
    const { chat, fs } = installApi([
      { content: '', toolCalls: [tc('write_file', { path: 'a.ts', content: 'X' })], finishReason: 'tool_calls' },
      { content: '写好了', finishReason: 'stop' },
    ]);
    const res = await runHeadlessAgent({ providerId: 'p', model: 'm', workspaceRoot: ROOT, task: '写文件' });
    expect(fs.writeFile).toHaveBeenCalledWith(`${ROOT}/a.ts`, 'X');
    expect(files.get(`${ROOT}/a.ts`)).toBe('X');
    expect(res.editedFiles).toContain(`${ROOT}/a.ts`);
    expect(res.content).toBe('写好了');
    expect(res.iterations).toBe(2);
    // Second call must have received the tool result in the message history.
    const secondCallMessages = (chat.mock.calls[1] as any[])[1] as any[];
    expect(secondCallMessages.some((m) => m.role === 'tool')).toBe(true);
  });

  it('captures tool errors into results instead of throwing', async () => {
    installApi([
      { content: '', toolCalls: [tc('read_file', { path: 'missing.ts' })], finishReason: 'tool_calls' },
      { content: '处理了错误', finishReason: 'stop' },
    ]);
    const res = await runHeadlessAgent({ providerId: 'p', model: 'm', workspaceRoot: ROOT, task: '读不存在的文件' });
    expect(res.content).toBe('处理了错误');
  });

  it('auto-approves writes (no human gate) inside the worktree', async () => {
    installApi([
      { content: '', toolCalls: [tc('write_file', { path: 'b.ts', content: 'Y' })], finishReason: 'tool_calls' },
      { content: 'ok', finishReason: 'stop' },
    ]);
    await runHeadlessAgent({ providerId: 'p', model: 'm', workspaceRoot: ROOT, task: '写' });
    expect(files.get(`${ROOT}/b.ts`)).toBe('Y'); // persisted without any approval prompt
  });

  it('stops and notes when the agent repeats identical calls with no progress', async () => {
    const repeated = { content: '', toolCalls: [tc('read_file', { path: 'a.ts' })], finishReason: 'tool_calls' };
    files.set(`${ROOT}/a.ts`, 'hi');
    // Use a stable id so signatures match across iterations.
    const fixed: ToolCall = { id: 'fixed', name: 'read_file', arguments: { path: 'a.ts' } };
    installApi([
      { content: '', toolCalls: [fixed], finishReason: 'tool_calls' },
      { content: '', toolCalls: [fixed], finishReason: 'tool_calls' },
      { content: '', toolCalls: [fixed], finishReason: 'tool_calls' },
      { content: '', toolCalls: [fixed], finishReason: 'tool_calls' },
    ]);
    void repeated;
    const res = await runHeadlessAgent({ providerId: 'p', model: 'm', workspaceRoot: ROOT, task: '卡住' });
    expect(res.note).toMatch(/重复/);
    expect(res.iterations).toBeLessThan(20);
  });

  it('returns a note when the model call fails', async () => {
    const chat = vi.fn(async () => { throw new Error('网络炸了'); });
    (globalThis as any).window = { api: { ai: { chat }, fs: { writeFile: vi.fn() } }, dispatchEvent: vi.fn() };
    const res = await runHeadlessAgent({ providerId: 'p', model: 'm', workspaceRoot: ROOT, task: 'x' });
    expect(res.note).toMatch(/模型调用失败/);
    expect(res.note).toMatch(/网络炸了/);
  });
});
