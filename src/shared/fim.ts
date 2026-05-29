/**
 * FIM (Fill-In-the-Middle) capability detection for inline code completion.
 *
 * Chat/reasoning models (Claude, GPT, Gemini) have no FIM endpoint — they fall
 * back to the chat-based completion path. Dedicated code models do support FIM,
 * via one of three transports:
 *   - 'completions-suffix': OpenAI-compatible /completions with prompt+suffix
 *       (DeepSeek V3/V4 beta endpoint)
 *   - 'mistral-fim': Mistral's dedicated /v1/fim/completions (Codestral)
 *   - 'sentinel': wrap prefix/suffix in the model's FIM special tokens and send
 *       to a plain /completions endpoint (local Ollama/vLLM models)
 */

export type FimTransport = 'completions-suffix' | 'mistral-fim' | 'sentinel';

export interface FimCapability {
  transport: FimTransport;
  /** For sentinel transport: build the single prompt string from prefix/suffix. */
  format?: (prefix: string, suffix: string) => string;
  /** Stop sequences to cut the model off cleanly. */
  stop?: string[];
}

/** Qwen2.5/Qwen3-Coder, StarCoder2, CodeGemma, Stable Code — same token scheme. */
const sentinelStarcoderStyle = (prefix: string, suffix: string) =>
  `<|fim_prefix|>${prefix}<|fim_suffix|>${suffix}<|fim_middle|>`;
const STARCODER_STOP = ['<|fim_pad|>', '<|endoftext|>', '<|fim_prefix|>', '<|file_sep|>'];

/** DeepSeek-Coder V2 (local) token scheme. */
const sentinelDeepseekCoder = (prefix: string, suffix: string) =>
  `<｜fim▁begin｜>${prefix}<｜fim▁hole｜>${suffix}<｜fim▁end｜>`;
const DEEPSEEK_CODER_STOP = ['<｜fim▁end｜>', '<|EOT|>'];

/** CodeLlama token scheme. */
const sentinelCodeLlama = (prefix: string, suffix: string) =>
  `<PRE> ${prefix} <SUF>${suffix} <MID>`;
const CODELLAMA_STOP = ['<EOT>', '<MID>'];

/**
 * Decide the FIM capability for a model name. Returns null for chat-only models
 * (which use the chat-completion fallback). Detection is name-based; matching is
 * deliberately loose so e.g. "deepseek-v4-pro", "deepseek-chat" all resolve.
 */
export function getFimCapability(
  providerType: string,
  model: string
): FimCapability | null {
  const m = (model || '').toLowerCase();

  // ── Dedicated FIM endpoints (cloud) ──

  // DeepSeek V3/V4 chat models expose FIM on the /beta completions endpoint.
  // Note: "deepseek-coder" V2 (local) is handled in the sentinel block below.
  if (/deepseek-(v[34]|chat)/.test(m) || m === 'deepseek') {
    return { transport: 'completions-suffix' };
  }

  // Mistral Codestral — dedicated /v1/fim/completions endpoint.
  if (/codestral/.test(m)) {
    return { transport: 'mistral-fim' };
  }

  // ── Sentinel-token models (typically local: Ollama / vLLM / LM Studio) ──

  if (/deepseek-coder/.test(m)) {
    return { transport: 'sentinel', format: sentinelDeepseekCoder, stop: DEEPSEEK_CODER_STOP };
  }
  if (/qwen.*coder|qwen3-coder|qwen2\.?5-coder/.test(m)) {
    return { transport: 'sentinel', format: sentinelStarcoderStyle, stop: STARCODER_STOP };
  }
  if (/starcoder|stable-?code|codegemma|aixcoder/.test(m)) {
    return { transport: 'sentinel', format: sentinelStarcoderStyle, stop: STARCODER_STOP };
  }
  if (/codellama|code-llama/.test(m)) {
    return { transport: 'sentinel', format: sentinelCodeLlama, stop: CODELLAMA_STOP };
  }

  // Anthropic / Google / generic chat models: no FIM.
  void providerType;
  return null;
}

/**
 * Resolve the base URL to use for a FIM request. DeepSeek requires the `/beta`
 * path for FIM; other providers use their configured base URL as-is.
 */
export function fimBaseURL(transport: FimTransport, baseURL: string | undefined): string | undefined {
  if (transport === 'completions-suffix' && baseURL && /deepseek/.test(baseURL)) {
    // Normalize ".../v1" or trailing slash, then ensure "/beta".
    const root = baseURL.replace(/\/v1\/?$/, '').replace(/\/+$/, '');
    return `${root}/beta`;
  }
  return baseURL || undefined;
}
