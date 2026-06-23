import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  AgentLogService,
  renderRoundMarkdown,
  sampleText,
  slugifyQuestion,
  type RoundTranscript,
} from './agent-log-service';

let tempRoot: string;

beforeEach(async () => {
  // Real filesystem so we exercise mkdir / appendFile / rotation paths end-to-end.
  // /tmp avoids any chance of polluting the repo if a test forgets to clean up.
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-log-test-'));
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('sampleText', () => {
  it('returns head only when the input fits twice the limit', () => {
    expect(sampleText('hello', 10)).toEqual({ head: 'hello', tail: '' });
  });
  it('splits head and tail for long inputs', () => {
    const long = 'a'.repeat(50) + 'XXXX' + 'b'.repeat(50);
    expect(sampleText(long, 10)).toEqual({
      head: 'aaaaaaaaaa',
      tail: 'bbbbbbbbbb',
    });
  });
  it('handles empty input', () => {
    expect(sampleText('')).toEqual({ head: '', tail: '' });
  });
});

describe('slugifyQuestion', () => {
  it('keeps CJK characters and trims to 40 chars', () => {
    expect(slugifyQuestion('  添加 圆桌 日志 功能  ')).toBe('添加-圆桌-日志-功能');
  });
  it('strips disallowed chars but keeps word + cjk', () => {
    // ?, !, / are stripped; spaces become single hyphens; final dangling hyphen is OK
    const slug = slugifyQuestion('What/about? this!');
    expect(slug).toMatch(/^Whatabout-this/);
  });
  it('falls back to "round" on empty input', () => {
    expect(slugifyQuestion('!!!')).toBe('round');
    expect(slugifyQuestion('   ')).toBe('round');
  });
});

describe('renderRoundMarkdown', () => {
  it('groups messages by round and includes the plan', () => {
    const t: RoundTranscript = {
      question: '该用 worktree 还是分支?',
      agents: [
        { id: 'a1', name: 'Alice', kind: 'api' },
        { id: 'a2', name: 'Bob', kind: 'claude-code' },
      ],
      messages: [
        { agentId: 'a1', agentName: 'Alice', round: 1, text: '走 worktree' },
        { agentId: 'a2', agentName: 'Bob', round: 1, text: '同意' },
        { agentId: 'a1', agentName: 'Alice', round: 2, text: '收敛' },
      ],
      plan: '1. 用 worktree\n2. 自动清理',
      startedAt: 1_000,
      endedAt: 3_500,
    };
    const md = renderRoundMarkdown(t);
    // Header captures the question
    expect(md).toContain('圆桌讨论：该用 worktree 还是分支?');
    // Each round heading shows up
    expect(md).toContain('## 第 1 轮');
    expect(md).toContain('## 第 2 轮');
    // Per-agent subheading for each message
    expect(md).toMatch(/### Alice[\s\S]*走 worktree/);
    expect(md).toMatch(/### Bob[\s\S]*同意/);
    // Plan section present
    expect(md).toContain('## 统一方案');
    expect(md).toContain('1. 用 worktree');
  });

  it('omits the plan section when no plan was converged', () => {
    const t: RoundTranscript = {
      question: 'q',
      agents: [],
      messages: [{ agentId: 'a', agentName: 'A', round: 1, text: 'x' }],
      plan: '',
      startedAt: 0,
      endedAt: 1,
    };
    expect(renderRoundMarkdown(t)).not.toContain('## 统一方案');
  });
});

describe('AgentLogService.append + readTail', () => {
  it('appends JSONL events and reads the tail back in order', async () => {
    const svc = new AgentLogService();
    await svc.append(tempRoot, { ts: '2026-06-22T00:00:00Z', kind: 'discussion-start', question: 'q1' });
    await svc.append(tempRoot, { ts: '2026-06-22T00:00:01Z', kind: 'discussion-call', agentId: 'a' });
    await svc.append(tempRoot, { ts: '2026-06-22T00:00:02Z', kind: 'discussion-end', planLength: 42 });

    const events = await svc.readTail(tempRoot, 200);
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.kind)).toEqual(['discussion-start', 'discussion-call', 'discussion-end']);
  });

  it('respects the tail limit', async () => {
    const svc = new AgentLogService();
    for (let i = 0; i < 5; i++) {
      await svc.append(tempRoot, { ts: `t${i}`, kind: 'notice', text: `n${i}` });
    }
    const tail = await svc.readTail(tempRoot, 2);
    expect(tail).toHaveLength(2);
    expect((tail[1].text as string)).toBe('n4');
  });

  it('skips malformed lines without throwing', async () => {
    const svc = new AgentLogService();
    await svc.append(tempRoot, { ts: 't', kind: 'notice', text: 'ok' });
    // Manually append a corrupt line — readTail should silently drop it.
    const file = path.join(tempRoot, '.ide', 'agent-log.jsonl');
    await fs.appendFile(file, '{not valid json\n', 'utf-8');
    await svc.append(tempRoot, { ts: 't2', kind: 'notice', text: 'still here' });

    const events = await svc.readTail(tempRoot);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.text)).toEqual(['ok', 'still here']);
  });

  it('returns [] when the log file does not exist', async () => {
    const svc = new AgentLogService();
    const events = await svc.readTail(tempRoot);
    expect(events).toEqual([]);
  });
});

describe('AgentLogService.writeRound', () => {
  it('writes a markdown transcript under .ide/rounds and returns the path', async () => {
    const svc = new AgentLogService();
    const t: RoundTranscript = {
      question: 'how to log agents',
      agents: [{ id: 'a', name: 'A', kind: 'api' }],
      messages: [{ agentId: 'a', agentName: 'A', round: 1, text: 'use jsonl' }],
      plan: 'append jsonl per call',
      startedAt: Date.UTC(2026, 5, 22, 0, 0, 0),
      endedAt: Date.UTC(2026, 5, 22, 0, 0, 5),
    };
    const written = await svc.writeRound(tempRoot, t);
    expect(written).toBeTruthy();
    expect(written).toContain(`${tempRoot}/.ide/rounds/`);

    const content = await fs.readFile(written!, 'utf-8');
    expect(content).toContain('# 圆桌讨论：how to log agents');
    expect(content).toContain('use jsonl');
    expect(content).toContain('append jsonl per call');
  });

  it('renders negotiated-review cards and weights when provided', async () => {
    const svc = new AgentLogService();
    const t: RoundTranscript = {
      question: 'refactor the router',
      agents: [
        { id: 'arch', name: '架构师', kind: 'api', role: 'architect' },
        { id: 'sec', name: '安全官', kind: 'api', role: 'security' },
      ],
      cards: [
        { agentId: 'arch', agentName: '架构师', role: 'architect', text: '拆成两层', ok: true, durationMs: 1200 },
        { agentId: 'sec', agentName: '安全官', role: 'security', text: '注意越权', ok: true, durationMs: 900 },
      ],
      weights: { arch: { architect: 1, security: 0.2, testing: 0.3, style: 0.1, general: 0.5 } },
      plan: '1) 拆分 2) 加权限校验',
      startedAt: Date.UTC(2026, 5, 22, 0, 0, 0),
      endedAt: Date.UTC(2026, 5, 22, 0, 0, 5),
    };
    const written = await svc.writeRound(tempRoot, t);
    expect(written).toBeTruthy();
    const content = await fs.readFile(written!, 'utf-8');
    expect(content).toContain('# 圆桌评审：refactor the router');
    expect(content).toContain('### 架构师（architect）');
    expect(content).toContain('拆成两层');
    expect(content).toContain('## 权重表');
    expect(content).toContain('"architect": 1');
  });

  it('returns null when the transcript has no content', async () => {
    const svc = new AgentLogService();
    const written = await svc.writeRound(tempRoot, {
      question: 'empty',
      agents: [],
      messages: [],
      plan: '',
      startedAt: 0,
      endedAt: 1,
    });
    expect(written).toBeNull();
  });
});
