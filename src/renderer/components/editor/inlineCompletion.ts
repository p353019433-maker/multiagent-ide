/**
 * Inline completion provider for Monaco Editor.
 * Uses the active model provider to generate code completions at cursor position.
 * Non-FIM models receive prefix/suffix context through the model service.
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

type InlineCompletionSource = (params: {
  prefix: string;
  suffix: string;
  language: string;
  filePath: string;
  /** Recent edits in this session — lets the model predict the *next* edit. */
  recentEdits: string[];
}) => Promise<string | null>;

let _completionSource: InlineCompletionSource | null = null;

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
// FIM models are fast and cheap, so we can fire much more often than request/response models.
const DEBOUNCE_FIM_MS = 150;
const DEBOUNCE_CHAT_MS = 300;
const COOLDOWN_FIM_MS = 300;
const COOLDOWN_CHAT_MS = 2000;

export function setInlineCompletionSource(fn: InlineCompletionSource) {
  _completionSource = fn;
}

let _monaco: MonacoModule | null = null;
let _disposables: Monaco.IDisposable[] = [];
let _config: ProviderConfig = { providerId: null, model: null };

function disposeInlineCompletionProvider() {
  _disposables.forEach((d) => d.dispose());
  _disposables = [];
}

export function registerInlineCompletion(monaco: MonacoModule) {
  _monaco = monaco;
  disposeInlineCompletionProvider();

  const provider: Monaco.languages.InlineCompletionsProvider = {
    provideInlineCompletions: async (
      model: Monaco.editor.ITextModel,
      position: Monaco.Position,
      _context: Monaco.languages.InlineCompletionContext,
      _token: Monaco.CancellationToken
    ): Promise<Monaco.languages.InlineCompletions> => {
      if (!_completionSource || !_config.providerId) return { items: [] };

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
        const result = await _completionSource({
          prefix,
          suffix,
          language,
          filePath: model.uri.fsPath,
          recentEdits: [..._recentEdits],
        });

        if (!result || result.trim().length === 0 || _token.isCancellationRequested) return { items: [] };

        // Suffix overlap detection: if the completion text starts matching the immediate suffix,
        // we should overwrite that part of the suffix instead of just inserting.
        // This is crucial for multi-line edits to feel like a "diff" replacement.
        let overlapLength = 0;
        const maxOverlap = Math.min(result.length, suffix.length);
        // Look for the largest overlap where result ends with or matches a prefix of the suffix.
        // A simple heuristic: check how many characters of the suffix match the end of the completion,
        // or how many characters of the completion match the beginning of the suffix.
        for (let i = maxOverlap; i > 0; i--) {
          if (result.endsWith(suffix.substring(0, i))) {
            overlapLength = i;
            break;
          }
        }
        
        let endPos = position;
        if (overlapLength > 0) {
          // Calculate the end position in the model by advancing overlapLength characters
          endPos = model.getPositionAt(model.getOffsetAt(position) + overlapLength);
        }

        return {
          items: [
            {
              insertText: result,
              range: new monaco.Range(
                position.lineNumber,
                position.column,
                endPos.lineNumber,
                endPos.column
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

export function unregisterInlineCompletion() {
  disposeInlineCompletionProvider();
  _config = { providerId: null, model: null };
}

export function updateInlineCompletionConfig(config: ProviderConfig) {
  _config = config;
  if (!config.providerId) {
    unregisterInlineCompletion();
  } else if (_disposables.length === 0 && _monaco) {
    registerInlineCompletion(_monaco);
  }
}
