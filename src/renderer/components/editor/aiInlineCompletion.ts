/**
 * AI Inline Completion provider for Monaco Editor.
 * Uses current AI provider to generate code completions at cursor position.
 * Does NOT use FIM (fill-in-the-middle) — sends context as chat completion.
 */

import type * as Monaco from 'monaco-editor';

type MonacoModule = typeof Monaco;

type ProviderConfig = {
  providerId: string | null;
  model: string | null;
  /** When true the active model has a real FIM transport — completions are fast
   * and cheap, so we can debounce/cooldown more aggressively. */
  fim?: boolean;
};

type AiCompleteFn = (params: {
  prefix: string;
  suffix: string;
  language: string;
  filePath: string;
  /** Recent edits in this session — lets the model predict the *next* edit. */
  recentEdits: string[];
}) => Promise<string | null>;

let _aiCompleteFn: AiCompleteFn | null = null;

// Ring buffer of recent edits (Cursor-Tab style "next edit" context).
const _recentEdits: string[] = [];
export function recordEdit(snippet: string) {
  const s = snippet.trim();
  if (!s || s.length < 2) return;
  _recentEdits.push(s.slice(0, 200));
  if (_recentEdits.length > 5) _recentEdits.shift();
}
let _pendingId = 0;
let _lastRequestTime = 0;
// FIM models are fast & cheap, so we can fire much more often than chat models.
const DEBOUNCE_FIM_MS = 150;
const DEBOUNCE_CHAT_MS = 300;
const COOLDOWN_FIM_MS = 300;
const COOLDOWN_CHAT_MS = 2000;

export function setAiCompleteFn(fn: AiCompleteFn) {
  _aiCompleteFn = fn;
}

let _monaco: MonacoModule | null = null;
let _disposables: Monaco.IDisposable[] = [];
let _config: ProviderConfig = { providerId: null, model: null };

function disposeInlineCompletionProvider() {
  _disposables.forEach((d) => d.dispose());
  _disposables = [];
}

function installProvider(monaco: MonacoModule) {
  const provider: Monaco.languages.InlineCompletionsProvider = {
    provideInlineCompletions: async (
      model: Monaco.editor.ITextModel,
      position: Monaco.Position,
      _context: Monaco.languages.InlineCompletionContext,
      _token: Monaco.CancellationToken
    ): Promise<Monaco.languages.InlineCompletions> => {
      if (!_aiCompleteFn || !_config.providerId) return { items: [] };

      const cooldown = _config.fim ? COOLDOWN_FIM_MS : COOLDOWN_CHAT_MS;
      const debounce = _config.fim ? DEBOUNCE_FIM_MS : DEBOUNCE_CHAT_MS;

      // Cooldown: don't fire more than once per window
      const now = Date.now();
      if (now - _lastRequestTime < cooldown) return { items: [] };

      // Debounce: assign an ID and wait. Listen for cancellation so we don't
      // burn the full debounce window when the user has already moved on.
      const thisId = ++_pendingId;
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, debounce);
        _token.onCancellationRequested(() => {
          clearTimeout(t);
          resolve();
        });
      });

      // If another request came in during debounce, or we were cancelled, skip.
      if (thisId !== _pendingId || _token.isCancellationRequested) return { items: [] };

      _lastRequestTime = Date.now();

      const prefix = model.getValueInRange({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });

      const suffix = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: position.column,
        endLineNumber: model.getLineCount(),
        endColumn: model.getLineMaxColumn(model.getLineCount()),
      });

      // Skip if prefix is too short (less than 10 chars of code)
      const codeChars = prefix.replace(/[\s]/g, '').length;
      if (codeChars < 10) return { items: [] };

      const language = model.getLanguageId();

      try {
        const result = await _aiCompleteFn({
          prefix,
          suffix,
          language,
          filePath: model.uri.fsPath,
          recentEdits: [..._recentEdits],
        });

        if (!result || result.trim().length === 0 || _token.isCancellationRequested) return { items: [] };

        return {
          items: [
            {
              insertText: result,
              range: new monaco.Range(
                position.lineNumber,
                position.column,
                position.lineNumber,
                position.column
              ),
            },
          ],
        };
      } catch {
        return { items: [] };
      }
    },
    freeInlineCompletions: () => {},
  };

  const d1 = monaco.languages.registerInlineCompletionsProvider(
    { pattern: '**/*' },
    provider
  );

  _disposables = [d1];
}

export function registerAiInlineCompletion(monaco: MonacoModule) {
  _monaco = monaco;
  // If a config was queued before monaco was ready (common — ChatPanel sets
  // the provider id during initial mount, before EditorArea lazy-loads
  // monaco), register the provider immediately so inline completion works.
  disposeInlineCompletionProvider();
  if (_config.providerId) {
    installProvider(monaco);
  }
}

export function unregisterAiInlineCompletion() {
  disposeInlineCompletionProvider();
  _config = { providerId: null, model: null };
}

export function updateInlineCompletionConfig(config: ProviderConfig) {
  _config = config;
  if (!config.providerId) {
    unregisterAiInlineCompletion();
    return;
  }
  // If monaco isn't ready yet, _config is queued; registerAiInlineCompletion
  // (called later from EditorArea) will install the provider using the
  // current _config value. Otherwise, (re)install right now.
  if (_monaco && _disposables.length === 0) {
    installProvider(_monaco);
  } else if (_monaco && _disposables.length > 0) {
    // Config changed but provider is already installed — re-install so the
    // captured closure (debounce/cooldown via _config) takes the new values.
    installProvider(_monaco);
  }
}
