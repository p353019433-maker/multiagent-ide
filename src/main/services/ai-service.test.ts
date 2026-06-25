/**
 * Tests for AIService message/tool transformation.
 *
 * These are the OpenAI/Anthropic request builders the reviewer flagged as
 * untested. They are pure data transforms (no network), so we instantiate the
 * service with a stub store and call the builders directly. The cross-provider
 * shape (tool calls, tool results, multimodal images, prompt-cache breakpoints)
 * is exactly the surface most likely to break on an SDK bump.
 */

import { describe, it, expect } from 'vitest';
import { AIService, openAIBaseURL, GEMINI_OPENAI_BASE } from './ai-service';
import type { ChatMessage, ChatOptions, ToolDefinition } from '../../shared/types';

// Stub store — the builders don't touch it.
const svc = new AIService({ get: () => undefined, set: () => {} } as any);
const oai = (m: ChatMessage[], sys?: string) => (svc as any).buildOpenAIMessages(m, sys) as any[];
const ant = (m: ChatMessage[]) => (svc as any).buildAnthropicMessages(m) as any[];
const oaiTools = (o: ChatOptions) => (svc as any).buildOpenAITools(o);
const antTools = (o: ChatOptions) => (svc as any).buildAnthropicTools(o);
const parseToolArguments = (raw: string) => (svc as any).parseToolArguments(raw);

const userMsg = (content: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'u', role: 'user', content, timestamp: 0, ...extra,
});

describe('buildOpenAIMessages', () => {
  it('prepends system prompt and maps a user turn', () => {
    const out = oai([userMsg('hi')], 'SYS');
    expect(out[0]).toEqual({ role: 'system', content: 'SYS' });
    expect(out[1]).toEqual({ role: 'user', content: 'hi' });
  });

  it('maps assistant tool calls to OpenAI tool_calls (args JSON-stringified)', () => {
    const out = oai([
      { id: 'a', role: 'assistant', content: '', timestamp: 0,
        toolCalls: [{ id: 'tc1', name: 'read_file', arguments: { path: 'a.ts' } }] },
    ]);
    expect(out[0].tool_calls[0]).toMatchObject({
      id: 'tc1', type: 'function',
      function: { name: 'read_file', arguments: JSON.stringify({ path: 'a.ts' }) },
    });
  });

  it('expands a tool message into per-result tool entries', () => {
    const out = oai([
      { id: 't', role: 'tool', content: '', timestamp: 0,
        toolResults: [{ toolCallId: 'tc1', content: 'ok' }] },
    ]);
    expect(out[0]).toEqual({ role: 'tool', tool_call_id: 'tc1', content: 'ok' });
  });

  it('encodes images as image_url parts (vision format)', () => {
    const out = oai([userMsg('look', { images: ['data:image/png;base64,AAA'] })]);
    expect(out[0].content[0]).toEqual({ type: 'text', text: 'look' });
    expect(out[0].content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } });
  });
});

describe('buildAnthropicMessages', () => {
  it('maps tool calls to tool_use blocks', () => {
    const out = ant([
      { id: 'a', role: 'assistant', content: 'doing', timestamp: 0,
        toolCalls: [{ id: 'tc1', name: 'read_file', arguments: { path: 'a.ts' } }] },
    ]);
    const blocks = out[0].content;
    expect(blocks.some((b: any) => b.type === 'text' && b.text === 'doing')).toBe(true);
    expect(blocks.some((b: any) => b.type === 'tool_use' && b.name === 'read_file')).toBe(true);
  });

  it('maps tool results to a user tool_result block', () => {
    const out = ant([
      { id: 't', role: 'tool', content: '', timestamp: 0,
        toolResults: [{ toolCallId: 'tc1', content: 'ok', isError: false }] },
    ]);
    expect(out[0].role).toBe('user');
    expect(out[0].content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'tc1', content: 'ok' });
  });

  it('parses data-URL images into base64 image blocks', () => {
    const out = ant([userMsg('look', { images: ['data:image/jpeg;base64,ZZZ'] })]);
    const img = out[0].content.find((b: any) => b.type === 'image');
    expect(img.source).toEqual({ type: 'base64', media_type: 'image/jpeg', data: 'ZZZ' });
  });

  it('places a prompt-cache breakpoint on the last message', () => {
    const out = ant([userMsg('one'), userMsg('two')]);
    const last = out[out.length - 1];
    // string content gets promoted to a text block carrying cache_control
    expect(Array.isArray(last.content)).toBe(true);
    expect(last.content[last.content.length - 1].cache_control).toEqual({ type: 'ephemeral' });
  });
});

describe('tool builders', () => {
  const tools: ToolDefinition[] = [
    { name: 't1', description: 'd1', parameters: { type: 'object', properties: {} } },
    { name: 't2', description: 'd2', parameters: { type: 'object', properties: {} } },
  ];

  it('OpenAI tools wrap each definition under function', () => {
    const out = oaiTools({ model: 'm', tools });
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ type: 'function', function: { name: 't1' } });
  });

  it('Anthropic tools cache the last (whole) tool block', () => {
    const out = antTools({ model: 'm', tools });
    expect(out[0].cache_control).toBeUndefined();
    expect(out[out.length - 1].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('both return undefined when no tools', () => {
    expect(oaiTools({ model: 'm' })).toBeUndefined();
    expect(antTools({ model: 'm' })).toBeUndefined();
  });
});

describe('tool argument parsing', () => {
  it('parses valid JSON object arguments', () => {
    expect(parseToolArguments('{"path":"a.ts"}')).toEqual({ path: 'a.ts' });
  });

  it('falls back to an empty object when provider tool arguments are malformed', () => {
    expect(parseToolArguments('{bad json')).toEqual({});
  });

  it('rejects non-object JSON values as tool argument objects', () => {
    expect(parseToolArguments('"not an object"')).toEqual({});
  });
});

describe('openAIBaseURL', () => {
  it('honors an explicit baseURL for any type', () => {
    expect(openAIBaseURL({ type: 'google', baseURL: 'https://my.proxy/v1' })).toBe('https://my.proxy/v1');
    expect(openAIBaseURL({ type: 'openai', baseURL: 'https://x/v1' })).toBe('https://x/v1');
  });
  it('defaults a google provider with no baseURL to the Gemini OpenAI endpoint', () => {
    expect(openAIBaseURL({ type: 'google', baseURL: '' })).toBe(GEMINI_OPENAI_BASE);
  });
  it('leaves non-google types to the SDK default (undefined) when no baseURL', () => {
    expect(openAIBaseURL({ type: 'openai', baseURL: '' })).toBeUndefined();
    expect(openAIBaseURL({ type: 'custom', baseURL: '' })).toBeUndefined();
  });
});
