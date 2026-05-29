import { describe, it, expect } from 'vitest';
import { getFimCapability, fimBaseURL } from './fim';

describe('getFimCapability', () => {
  it('detects DeepSeek V3/V4 native suffix', () => {
    expect(getFimCapability('custom', 'deepseek-v4-pro')?.transport).toBe('completions-suffix');
    expect(getFimCapability('custom', 'deepseek-v4-flash')?.transport).toBe('completions-suffix');
    expect(getFimCapability('custom', 'deepseek-chat')?.transport).toBe('completions-suffix');
  });
  it('detects Codestral mistral-fim', () => {
    expect(getFimCapability('custom', 'codestral-latest')?.transport).toBe('mistral-fim');
  });
  it('detects sentinel models', () => {
    expect(getFimCapability('ollama', 'qwen3-coder')?.transport).toBe('sentinel');
    expect(getFimCapability('ollama', 'starcoder2:15b')?.transport).toBe('sentinel');
    expect(getFimCapability('ollama', 'deepseek-coder-v2')?.transport).toBe('sentinel');
  });
  it('returns null for chat-only models', () => {
    expect(getFimCapability('anthropic', 'claude-opus-4-8')).toBeNull();
    expect(getFimCapability('openai', 'gpt-4o')).toBeNull();
    expect(getFimCapability('google', 'gemini-2.5-pro')).toBeNull();
  });
  it('sentinel format wraps correctly', () => {
    const qwen = getFimCapability('ollama', 'qwen3-coder');
    expect(qwen?.format?.('A', 'B')).toBe('<|fim_prefix|>A<|fim_suffix|>B<|fim_middle|>');
  });
});

describe('fimBaseURL', () => {
  it('rewrites DeepSeek to /beta', () => {
    expect(fimBaseURL('completions-suffix', 'https://api.deepseek.com/v1')).toBe('https://api.deepseek.com/beta');
    expect(fimBaseURL('completions-suffix', 'https://api.deepseek.com')).toBe('https://api.deepseek.com/beta');
  });
  it('leaves non-deepseek untouched', () => {
    expect(fimBaseURL('completions-suffix', 'https://api.other.com/v1')).toBe('https://api.other.com/v1');
  });
});
