import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import type { StoreService } from './store-service';
import type {
  ChatMessage,
  ChatOptions,
  ChatResult,
  StreamCallbacks,
  ToolCall,
  AIProvider,
  FimRequest,
} from '../../shared/types';
import { getFimCapability, fimBaseURL } from '../../shared/fim';

export class AIService {
  private store: StoreService;
  private abortController: AbortController | null = null;

  constructor(store: StoreService) {
    this.store = store;
  }

  abort() {
    this.abortController?.abort();
    this.abortController = null;
  }

  private getProviders(): AIProvider[] {
    return (this.store.get('providers') as AIProvider[]) || [];
  }

  private async getApiKey(provider: AIProvider): Promise<string> {
    const encrypted = this.store.get(provider.apiKeyRef) as string | undefined;
    if (!encrypted) return '';
    try {
      const { safeStorage } = await import('electron');
      if (safeStorage.isEncryptionAvailable()) {
        return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
      }
    } catch {}
    return encrypted;
  }

  async testConnection(providerId: string): Promise<{ ok: boolean; error?: string }> {
    const providers = this.getProviders();
    const provider = providers.find((p) => p.id === providerId);
    if (!provider) return { ok: false, error: 'Provider not found' };

    try {
      const apiKey = await this.getApiKey(provider);
      if (provider.type === 'anthropic') {
        const client = new Anthropic({ apiKey, baseURL: provider.baseURL || undefined });
        await client.messages.create({
          model: provider.defaultModel || 'claude-3-haiku-20240307',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'hi' }],
        });
      } else {
        // OpenAI-compatible
        const client = new OpenAI({ apiKey, baseURL: provider.baseURL || undefined });
        await client.chat.completions.create({
          model: provider.defaultModel || 'gpt-4o-mini',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'hi' }],
        });
      }
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
  }

  /**
   * Fill-In-the-Middle completion for inline editor suggestions.
   *
   * Returns the middle text to insert, or null if the model is chat-only (the
   * renderer then falls back to chat-based completion). Errors resolve to null
   * so a flaky completion never interrupts typing.
   */
  async fimComplete(req: FimRequest): Promise<string | null> {
    const providers = this.getProviders();
    const provider = providers.find((p) => p.id === req.providerId);
    if (!provider) return null;

    const cap = getFimCapability(provider.type, req.model);
    if (!cap) return null; // chat-only model — caller falls back

    const apiKey = await this.getApiKey(provider);
    const maxTokens = req.maxTokens ?? 256;

    try {
      if (cap.transport === 'mistral-fim') {
        // Mistral dedicated FIM endpoint.
        const base = (provider.baseURL || 'https://api.mistral.ai').replace(/\/+$/, '');
        const res = await fetch(`${base}/v1/fim/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: req.model,
            prompt: req.prefix,
            suffix: req.suffix,
            max_tokens: maxTokens,
            temperature: 0.1,
          }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) return null;
        const data: any = await res.json();
        return data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || null;
      }

      if (cap.transport === 'completions-suffix') {
        // OpenAI-compatible /completions with prompt + suffix (DeepSeek beta).
        const baseURL = fimBaseURL(cap.transport, provider.baseURL);
        const client = new OpenAI({ apiKey, baseURL });
        const resp = await client.completions.create({
          model: req.model,
          prompt: req.prefix,
          suffix: req.suffix,
          max_tokens: maxTokens,
          temperature: 0.1,
        });
        return resp.choices?.[0]?.text || null;
      }

      // sentinel transport: wrap in FIM tokens, send as a plain completion.
      const client = new OpenAI({ apiKey, baseURL: provider.baseURL || undefined });
      const prompt = cap.format!(req.prefix, req.suffix);
      const resp = await client.completions.create({
        model: req.model,
        prompt,
        max_tokens: maxTokens,
        temperature: 0.1,
        stop: cap.stop,
      });
      return resp.choices?.[0]?.text || null;
    } catch {
      return null;
    }
  }

  /** Whether the given provider/model supports a real FIM transport. */
  supportsFim(providerId: string, model: string): boolean {
    const provider = this.getProviders().find((p) => p.id === providerId);
    if (!provider) return false;
    return getFimCapability(provider.type, model) !== null;
  }

  /**
   * Embed texts via an OpenAI-compatible /embeddings endpoint. Works for
   * DeepSeek (deepseek-embedding-v2), OpenAI (text-embedding-3-small), Ollama
   * (nomic-embed-text/bge-m3) and any compatible provider. Returns one vector
   * per input, in order.
   */
  async embed(providerId: string, model: string, texts: string[]): Promise<number[][]> {
    const provider = this.getProviders().find((p) => p.id === providerId);
    if (!provider) throw new Error(`Provider "${providerId}" not found`);
    if (texts.length === 0) return [];

    const apiKey = await this.getApiKey(provider);
    const client = new OpenAI({ apiKey, baseURL: provider.baseURL || undefined });
    const resp = await client.embeddings.create({ model, input: texts });
    // Preserve input order via the index field.
    const out: number[][] = new Array(texts.length);
    for (const item of resp.data) {
      out[item.index] = item.embedding as number[];
    }
    return out;
  }

  async chat(
    providerId: string,
    messages: ChatMessage[],
    options: ChatOptions
  ): Promise<ChatResult> {
    const providers = this.getProviders();
    const provider = providers.find((p) => p.id === providerId);
    if (!provider) throw new Error(`Provider "${providerId}" not found`);

    const apiKey = await this.getApiKey(provider);

    if (provider.type === 'anthropic') {
      return this.chatAnthropic(apiKey, provider, messages, options);
    }
    return this.chatOpenAI(apiKey, provider, messages, options);
  }

  async chatStream(
    providerId: string,
    messages: ChatMessage[],
    options: ChatOptions,
    callbacks: StreamCallbacks
  ): Promise<void> {
    const providers = this.getProviders();
    const provider = providers.find((p) => p.id === providerId);
    if (!provider) {
      callbacks.onError(`Provider "${providerId}" not found`);
      return;
    }

    const apiKey = await this.getApiKey(provider);
    this.abortController = new AbortController();

    try {
      if (provider.type === 'anthropic') {
        await this.streamAnthropic(apiKey, provider, messages, options, callbacks);
      } else {
        await this.streamOpenAI(apiKey, provider, messages, options, callbacks);
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        callbacks.onComplete({ content: '', finishReason: 'stop' });
      } else {
        callbacks.onError(e?.message || String(e));
      }
    } finally {
      this.abortController = null;
    }
  }

  // ─── OpenAI-compatible ───────────────────────────────────────────────────────

  private buildOpenAIMessages(messages: ChatMessage[], systemPrompt?: string) {
    const result: OpenAI.ChatCompletionMessageParam[] = [];
    if (systemPrompt) result.push({ role: 'system', content: systemPrompt });

    for (const msg of messages) {
      if (msg.role === 'system') continue;
      if (msg.role === 'user') {
        if (msg.images?.length) {
          // Multimodal user turn: text + image_url parts (OpenAI vision format).
          result.push({
            role: 'user',
            content: [
              { type: 'text' as const, text: msg.content },
              ...msg.images.map((url) => ({
                type: 'image_url' as const,
                image_url: { url },
              })),
            ],
          });
        } else {
          result.push({ role: 'user', content: msg.content });
        }
      } else if (msg.role === 'assistant') {
        if (msg.toolCalls?.length) {
          result.push({
            role: 'assistant',
            content: msg.content || null,
            tool_calls: msg.toolCalls.map((tc) => ({
              id: tc.id,
              type: 'function' as const,
              function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
            })),
          });
        } else {
          result.push({ role: 'assistant', content: msg.content });
        }
      } else if (msg.role === 'tool' && msg.toolResults) {
        for (const tr of msg.toolResults) {
          result.push({
            role: 'tool',
            tool_call_id: tr.toolCallId,
            content: tr.content,
          });
        }
      }
    }
    return result;
  }

  private buildOpenAITools(options: ChatOptions): OpenAI.ChatCompletionTool[] | undefined {
    if (!options.tools?.length) return undefined;
    return options.tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters as Record<string, unknown>,
      },
    }));
  }

  private async chatOpenAI(
    apiKey: string,
    provider: AIProvider,
    messages: ChatMessage[],
    options: ChatOptions
  ): Promise<ChatResult> {
    const client = new OpenAI({ apiKey, baseURL: provider.baseURL || undefined });
    const oaiMessages = this.buildOpenAIMessages(messages, options.systemPrompt);
    const tools = this.buildOpenAITools(options);

    const resp = await client.chat.completions.create({
      model: options.model || provider.defaultModel,
      messages: oaiMessages,
      tools,
      tool_choice: tools ? 'auto' : undefined,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 4096,
    });

    const choice = resp.choices[0];
    const toolCalls: ToolCall[] = (choice.message.tool_calls || []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments || '{}'),
    }));

    return {
      content: choice.message.content || '',
      toolCalls: toolCalls.length ? toolCalls : undefined,
      finishReason:
        choice.finish_reason === 'tool_calls'
          ? 'tool_calls'
          : choice.finish_reason === 'stop'
          ? 'stop'
          : 'length',
      usage: resp.usage
        ? {
            promptTokens: resp.usage.prompt_tokens,
            completionTokens: resp.usage.completion_tokens,
          }
        : undefined,
    };
  }

  private async streamOpenAI(
    apiKey: string,
    provider: AIProvider,
    messages: ChatMessage[],
    options: ChatOptions,
    callbacks: StreamCallbacks
  ): Promise<void> {
    const client = new OpenAI({ apiKey, baseURL: provider.baseURL || undefined });
    const oaiMessages = this.buildOpenAIMessages(messages, options.systemPrompt);
    const tools = this.buildOpenAITools(options);

    const stream = await client.chat.completions.create(
      {
        model: options.model || provider.defaultModel,
        messages: oaiMessages,
        tools,
        tool_choice: tools ? 'auto' : undefined,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 4096,
        stream: true,
        stream_options: { include_usage: true },
      },
      { signal: this.abortController?.signal }
    );

    let content = '';
    const toolCallAccum: Record<number, { id: string; name: string; args: string }> = {};
    let finishReason: 'tool_calls' | 'stop' | 'length' = 'stop';
    let usage: ChatResult['usage'];

    // Consume the entire stream before finalizing. Returning early on the first
    // finish_reason chunk used to drop the trailing usage chunk and, for some
    // providers that split tool-call arguments across the final chunks, the tail
    // of a parallel tool call's arguments.
    for await (const chunk of stream) {
      if (chunk.usage) {
        usage = {
          promptTokens: chunk.usage.prompt_tokens,
          completionTokens: chunk.usage.completion_tokens,
        };
      }

      const choice = chunk.choices[0];
      if (!choice) continue;
      const delta = choice.delta;

      if (delta?.content) {
        content += delta.content;
        callbacks.onToken(delta.content);
      }

      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          if (!toolCallAccum[idx]) {
            toolCallAccum[idx] = { id: tc.id || '', name: tc.function?.name || '', args: '' };
          }
          if (tc.id) toolCallAccum[idx].id = tc.id;
          if (tc.function?.name) toolCallAccum[idx].name = tc.function.name;
          if (tc.function?.arguments) toolCallAccum[idx].args += tc.function.arguments;
        }
      }

      if (choice.finish_reason === 'tool_calls') finishReason = 'tool_calls';
      else if (choice.finish_reason === 'length') finishReason = 'length';
      else if (choice.finish_reason === 'stop') finishReason = 'stop';
    }

    const toolCalls: ToolCall[] = Object.values(toolCallAccum).map((tc) => ({
      id: tc.id,
      name: tc.name,
      arguments: (() => { try { return JSON.parse(tc.args); } catch { return {}; } })(),
    }));
    // If the model emitted tool calls, that is the effective finish reason even
    // when the terminal chunk reported 'stop'.
    if (toolCalls.length) finishReason = 'tool_calls';

    for (const tc of toolCalls) callbacks.onToolCall(tc);

    callbacks.onComplete({
      content,
      toolCalls: toolCalls.length ? toolCalls : undefined,
      finishReason,
      usage,
    });
  }

  // ─── Anthropic ───────────────────────────────────────────────────────────────

  private buildAnthropicMessages(messages: ChatMessage[]) {
    const result: Anthropic.MessageParam[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') continue;

      if (msg.role === 'user') {
        if (msg.images?.length) {
          // Multimodal user turn for Anthropic: parse data URLs into base64
          // image source blocks.
          const blocks: Anthropic.ContentBlockParam[] = [
            { type: 'text', text: msg.content },
          ];
          for (const url of msg.images) {
            const m = url.match(/^data:(image\/[a-zA-Z.+-]+);base64,(.+)$/);
            if (m) {
              blocks.push({
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: m[1] as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
                  data: m[2],
                },
              });
            }
          }
          result.push({ role: 'user', content: blocks });
        } else {
          result.push({ role: 'user', content: msg.content });
        }
      } else if (msg.role === 'assistant') {
        if (msg.toolCalls?.length) {
          result.push({
            role: 'assistant',
            content: [
              ...(msg.content ? [{ type: 'text' as const, text: msg.content }] : []),
              ...msg.toolCalls.map((tc) => ({
                type: 'tool_use' as const,
                id: tc.id,
                name: tc.name,
                input: tc.arguments,
              })),
            ],
          });
        } else {
          result.push({ role: 'assistant', content: msg.content });
        }
      } else if (msg.role === 'tool' && msg.toolResults) {
        result.push({
          role: 'user',
          content: msg.toolResults.map((tr) => ({
            type: 'tool_result' as const,
            tool_use_id: tr.toolCallId,
            content: tr.content,
            is_error: tr.isError,
          })),
        });
      }
    }

    // Place a cache breakpoint on the last content block of the most recent
    // message. On each agent turn the conversation prefix is identical, so the
    // whole history up to here is served from cache rather than re-billed.
    const last = result[result.length - 1];
    if (last) {
      if (typeof last.content === 'string') {
        last.content = [
          { type: 'text', text: last.content, cache_control: { type: 'ephemeral' } },
        ] as unknown as Anthropic.MessageParam['content'];
      } else if (Array.isArray(last.content) && last.content.length) {
        const block = last.content[last.content.length - 1] as unknown as Record<string, unknown>;
        block.cache_control = { type: 'ephemeral' };
      }
    }

    return result;
  }

  private buildAnthropicTools(options: ChatOptions): Anthropic.Tool[] | undefined {
    if (!options.tools?.length) return undefined;
    const tools = options.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Tool['input_schema'],
    }));
    // Mark the last (and therefore the whole) tool definition block as cacheable.
    // The tool list is large and stable across an agent loop, so caching it
    // avoids re-billing those tokens on every turn.
    if (tools.length) {
      (tools[tools.length - 1] as Record<string, unknown>).cache_control = {
        type: 'ephemeral',
      };
    }
    return tools;
  }

  /**
   * Build a cacheable system prompt block for Anthropic. The system prompt is
   * identical on every turn of an agent loop, so caching it is a large win.
   */
  private buildAnthropicSystem(
    systemPrompt?: string
  ): Anthropic.MessageParam['content'] | string | undefined {
    if (!systemPrompt) return undefined;
    return [
      {
        type: 'text' as const,
        text: systemPrompt,
        cache_control: { type: 'ephemeral' as const },
      },
    ] as unknown as Anthropic.MessageParam['content'];
  }

  private async chatAnthropic(
    apiKey: string,
    provider: AIProvider,
    messages: ChatMessage[],
    options: ChatOptions
  ): Promise<ChatResult> {
    const client = new Anthropic({ apiKey, baseURL: provider.baseURL || undefined });
    const anthropicMessages = this.buildAnthropicMessages(messages);
    const tools = this.buildAnthropicTools(options);

    const resp = await client.messages.create({
      model: options.model || provider.defaultModel,
      max_tokens: options.maxTokens ?? 4096,
      system: this.buildAnthropicSystem(options.systemPrompt) as any,
      messages: anthropicMessages,
      tools,
    });

    let content = '';
    const toolCalls: ToolCall[] = [];

    for (const block of resp.content) {
      if (block.type === 'text') content += block.text;
      if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input as Record<string, unknown>,
        });
      }
    }

    return {
      content,
      toolCalls: toolCalls.length ? toolCalls : undefined,
      finishReason: resp.stop_reason === 'tool_use' ? 'tool_calls' : 'stop',
      usage: {
        promptTokens: resp.usage.input_tokens,
        completionTokens: resp.usage.output_tokens,
      },
    };
  }

  private async streamAnthropic(
    apiKey: string,
    provider: AIProvider,
    messages: ChatMessage[],
    options: ChatOptions,
    callbacks: StreamCallbacks
  ): Promise<void> {
    const client = new Anthropic({ apiKey, baseURL: provider.baseURL || undefined });
    const anthropicMessages = this.buildAnthropicMessages(messages);
    const tools = this.buildAnthropicTools(options);

    const stream = client.messages.stream(
      {
        model: options.model || provider.defaultModel,
        max_tokens: options.maxTokens ?? 4096,
        system: this.buildAnthropicSystem(options.systemPrompt) as any,
        messages: anthropicMessages,
        tools,
      },
      { signal: this.abortController?.signal }
    );

    let content = '';
    stream.on('text', (text) => {
      content += text;
      callbacks.onToken(text);
    });

    const final = await stream.finalMessage();
    const toolCalls: ToolCall[] = [];
    for (const block of final?.content || []) {
      if (block.type === 'tool_use') {
        const tc: ToolCall = {
          id: block.id,
          name: block.name,
          arguments: block.input as Record<string, unknown>,
        };
        toolCalls.push(tc);
        callbacks.onToolCall(tc);
      }
    }

    callbacks.onComplete({
      content,
      toolCalls: toolCalls.length ? toolCalls : undefined,
      finishReason: toolCalls.length ? 'tool_calls' : 'stop',
      usage: final?.usage
        ? {
            promptTokens: final.usage.input_tokens,
            completionTokens: final.usage.output_tokens,
          }
        : undefined,
    });
  }
}
