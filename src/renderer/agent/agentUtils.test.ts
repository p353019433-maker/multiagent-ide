import { describe, it, expect } from 'vitest';
import { resolveWorkspacePath, classifyToolError, compactMessages } from './agentUtils';
import type { ChatMessage } from '@shared/types';

describe('resolveWorkspacePath', () => {
  it('resolves relative paths', () => {
    expect(resolveWorkspacePath('/repo', 'src/a.ts')).toBe('/repo/src/a.ts');
    expect(resolveWorkspacePath('/repo', './src/./a.ts')).toBe('/repo/src/a.ts');
  });
  it('rejects traversal and absolute escapes', () => {
    expect(() => resolveWorkspacePath('/repo', '../etc/passwd')).toThrow();
    expect(() => resolveWorkspacePath('/repo', '/etc/passwd')).toThrow();
    expect(() => resolveWorkspacePath(null, 'a.ts')).toThrow();
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
});
