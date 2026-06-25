import { describe, it, expect } from 'vitest';
import {
  resolveWorkspacePath,
  classifyToolError,
  compactMessages,
  checkpointSnapshotPaths,
  mainRepoFromWorktreePath,
} from './taskUtils';
import type { ChatMessage, Checkpoint } from '@shared/types';

describe('resolveWorkspacePath', () => {
  it('resolves relative paths', () => {
    expect(resolveWorkspacePath('/repo', 'src/a.ts')).toBe('/repo/src/a.ts');
    expect(resolveWorkspacePath('/repo', './src/./a.ts')).toBe('/repo/src/a.ts');
  });
  it('rejects traversal and absolute escapes', () => {
    expect(() => resolveWorkspacePath('/repo', '../etc/passwd')).toThrow();
    expect(() => resolveWorkspacePath('/repo', '/etc/passwd')).toThrow();
    expect(() => resolveWorkspacePath('/repo', 'C:\\Windows\\System32')).toThrow();
    expect(() => resolveWorkspacePath(null, 'a.ts')).toThrow();
  });
  it('rejects absolute paths that start with the root but contain ..', () => {
    // Regression: a path like /repo/../../etc/passwd used to bypass the
    // prefix check and be returned verbatim. The path-traversal-detection
    // segment walk must catch the leading '..' and throw.
    expect(() => resolveWorkspacePath('/repo', '/repo/../../etc/passwd')).toThrow();
    expect(() => resolveWorkspacePath('/repo', '/repo/./../../etc/passwd')).toThrow();
    // Windows-style backslashes must be normalized too.
    expect(() => resolveWorkspacePath('/repo', '..\\..\\etc\\passwd')).toThrow();
  });
  it('allows legitimate absolute paths inside the workspace', () => {
    expect(resolveWorkspacePath('/repo', '/repo/src/a.ts')).toBe('/repo/src/a.ts');
  });
});

describe('classifyToolError', () => {
  it('marks transient errors retriable', () => {
    expect(classifyToolError(new Error('ETIMEDOUT')).retriable).toBe(true);
    expect(classifyToolError(new Error('429 rate limit')).retriable).toBe(true);
  });
  it('marks logic errors non-retriable', () => {
    expect(classifyToolError(new Error('文件中未找到 old_str')).retriable).toBe(false);
  });
});

describe('compactMessages', () => {
  const mk = (role: ChatMessage['role'], content: string): ChatMessage => ({
    id: Math.random().toString(36), role, content, timestamp: Date.now(),
  });
  it('leaves short histories untouched', () => {
    const msgs = [mk('user', 'hi'), mk('assistant', 'yo')];
    expect(compactMessages(msgs)).toHaveLength(2);
  });
  it('summarizes long histories and keeps recent tail', () => {
    const msgs = Array.from({ length: 60 }, (_, i) => mk(i % 2 ? 'assistant' : 'user', `m${i}`));
    const out = compactMessages(msgs);
    expect(out.length).toBeLessThan(60);
    expect(out[0].content).toContain('压缩摘要');
  });
  it('strips orphan toolCalls from a tail-leading assistant after compaction', () => {
    // Regression: when the summary boundary lands in the middle of a tool
    // call/result pair, the tail-leading assistant still carries toolCalls
    // whose tool_results were dropped into the summary. Sending that to the
    // API would 400 on "tool_use without tool_result". The fix strips the
    // dangling toolCalls from the first assistant in the tail.
    //
    // Construct a message list where the last KEEP_RECENT (16) window starts
    // with an assistant(toolCalls) and the matching tool result is the second
    // message in that window — so the drop-leading-tool loop only kicks in if
    // we craft the boundary correctly. The simplest case: tail leading message
    // is assistant(toolCalls) whose tool result is in the head (already
    // summarized). The head/tail boundary is set so this assistant is the
    // first message in the tail.
    const msgs: ChatMessage[] = [];
    // 25 user msgs in head, then an assistant(toolCalls), then 14 trailing
    // messages. Total: 25 + 1 + 14 = 40 → KEEP_RECENT=16 keeps the last 16
    // (assistant + 15 tail), and the head summary absorbs the 25 user msgs +
    // the tool result that we then drop.
    for (let i = 0; i < 25; i++) msgs.push(mk('user', `pre-${i}`));
    // The tool result we want to "lose" by absorption into the summary.
    msgs.push({
      id: 't0', role: 'tool', content: '', timestamp: 1,
      toolResults: [{ toolCallId: 'tc0', content: 'ok' }],
    });
    // Boundary: assistant(toolCalls) at the very top of the kept window.
    msgs.push({
      id: 'a1', role: 'assistant', content: 'calling tool', timestamp: 2,
      toolCalls: [{ id: 'tc1', name: 'read_file', arguments: { path: 'a' } }],
    });
    // Pad the tail to 16 total so the assistant lands at the boundary.
    for (let i = 0; i < 15; i++) msgs.push(mk('user', `post-${i}`));

    const out = compactMessages(msgs);
    // The very first message after the summary must NOT carry toolCalls —
    // their results are not in the kept tail.
    const firstTail = out[1];
    expect(firstTail.role).toBe('assistant');
    expect(firstTail.toolCalls).toBeUndefined();
  });
});

describe('checkpointSnapshotPaths', () => {
  const cp = (id: string, files: Checkpoint['files']): Checkpoint => ({
    id, label: id, createdAt: 0, files,
  });
  it('collects .snap paths for snapshot-backed files only', () => {
    const cps = [
      cp('a', [
        { path: 'src/x.ts', before: '__snap__:111-aaa' },
        { path: 'src/new.ts', before: null }, // newly-created file → no snapshot
      ]),
      cp('b', [{ path: 'src/y.ts', before: '__snap__:222-bbb' }]),
    ];
    expect(checkpointSnapshotPaths(cps, '/repo')).toEqual([
      '/repo/.ide/.history/111-aaa.snap',
      '/repo/.ide/.history/222-bbb.snap',
    ]);
  });
  it('ignores legacy inline-content checkpoints and returns [] for none', () => {
    const cps = [cp('c', [{ path: 'a.ts', before: 'inline old content' }])];
    expect(checkpointSnapshotPaths(cps, '/repo')).toEqual([]);
    expect(checkpointSnapshotPaths([], '/repo')).toEqual([]);
  });
});

describe('mainRepoFromWorktreePath', () => {
  it('derives the main repo from the <root>_wt/<branch> convention', () => {
    expect(mainRepoFromWorktreePath('/Users/me/proj_wt/debate-123')).toBe('/Users/me/proj');
    // branch may contain slashes; the last _wt/ segment is the boundary
    expect(mainRepoFromWorktreePath('/a/x_wt/proj_wt/feat/y')).toBe('/a/x_wt/proj');
  });
  it('returns null for non-worktree paths', () => {
    expect(mainRepoFromWorktreePath('/Users/me/proj/src/a.ts')).toBeNull();
    expect(mainRepoFromWorktreePath('_wt/x')).toBeNull(); // nothing before the marker
  });
});
