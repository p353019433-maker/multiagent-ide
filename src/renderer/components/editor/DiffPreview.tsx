import React, { useEffect, useRef } from 'react';
import { useTheme } from '../../context/ThemeContext';
import { applyMonacoTheme, defineMonacoThemes, monacoThemeName } from '../../monacoTheme';

type MonacoModule = typeof import('monaco-editor');

interface Props {
  original: string;
  modified: string;
  filePath: string;
  language?: string;
  visible: boolean;
  onAccept: () => void;
  onReject: () => void;
  statusText?: string;
  statusTone?: 'warning' | 'danger';
}

/**
 * Inline diff preview using Monaco's built-in diff editor.
 * Shows original on the left, modified on the right,
 * with accept/reject buttons.
 */
export default function DiffPreview({
  original,
  modified,
  filePath,
  language,
  visible,
  onAccept,
  onReject,
  statusText,
  statusTone = 'warning',
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const diffEditorRef = useRef<import('monaco-editor').editor.IStandaloneDiffEditor | null>(null);
  const monacoRef = useRef<MonacoModule | null>(null);
  const acceptRef = useRef(onAccept);
  const rejectRef = useRef(onReject);
  const { themeName } = useTheme();
  const themeNameRef = useRef(themeName);
  themeNameRef.current = themeName;

  // Latest content kept in refs so the async construction effect reads current
  // values, and the content-update effect can setValue without recreating the
  // whole diff editor on every streamed chunk.
  const originalRef = useRef(original);
  const modifiedRef = useRef(modified);
  const originalModelRef = useRef<import('monaco-editor').editor.ITextModel | null>(null);
  const modifiedModelRef = useRef<import('monaco-editor').editor.ITextModel | null>(null);

  // Update model content in place when the streamed diff changes — avoids
  // disposing/recreating the entire IStandaloneDiffEditor on every chunk.
  useEffect(() => {
    originalRef.current = original;
    modifiedRef.current = modified;
    if (originalModelRef.current) originalModelRef.current.setValue(original);
    if (modifiedModelRef.current) modifiedModelRef.current.setValue(modified);
  }, [original, modified]);

  useEffect(() => {
    acceptRef.current = onAccept;
    rejectRef.current = onReject;
  }, [onAccept, onReject]);

  // Construct/dispose the diff editor + models. Deps intentionally exclude
  // `original`/`modified` — content updates are handled by the effect above so
  // a streaming diff doesn't tear down and rebuild the editor each chunk.
  useEffect(() => {
    if (!containerRef.current || !visible) return;

    let disposed = false;
    let diffEditor: import('monaco-editor').editor.IStandaloneDiffEditor | null = null;
    let originalModel: import('monaco-editor').editor.ITextModel | null = null;
    let modifiedModel: import('monaco-editor').editor.ITextModel | null = null;

    void import('monaco-editor').then((monaco: MonacoModule) => {
      if (disposed || !containerRef.current) return;

      const lang = language || guessLanguage(filePath);
      originalModel = monaco.editor.createModel(originalRef.current, lang);
      modifiedModel = monaco.editor.createModel(modifiedRef.current, lang);
      originalModelRef.current = originalModel;
      modifiedModelRef.current = modifiedModel;

      monacoRef.current = monaco;
      defineMonacoThemes(monaco);

      diffEditor = monaco.editor.createDiffEditor(containerRef.current, {
        theme: monacoThemeName(themeNameRef.current),
        fontSize: 12,
        fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
        readOnly: true,
        automaticLayout: true,
        renderSideBySide: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        lineNumbers: 'on',
        renderOverviewRuler: false,
        diffWordWrap: 'on',
        ignoreTrimWhitespace: false,
        // Monaco 0.52+ uses renderOptions
        originalEditable: false,
      });

      diffEditor.setModel({ original: originalModel, modified: modifiedModel });
      diffEditorRef.current = diffEditor;

      // Keyboard shortcuts
      diffEditor.addAction({
        id: 'accept-diff',
        label: 'Accept',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
        run: () => acceptRef.current(),
      });
      diffEditor.addAction({
        id: 'reject-diff',
        label: 'Reject',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Escape],
        run: () => rejectRef.current(),
      });
    });

    return () => {
      disposed = true;
      diffEditor?.dispose();
      originalModel?.dispose();
      modifiedModel?.dispose();
      diffEditorRef.current = null;
      monacoRef.current = null;
      originalModelRef.current = null;
      modifiedModelRef.current = null;
    };
  }, [visible, filePath, language]);

  // 主题切换时跟随（不重建 diff editor）
  useEffect(() => {
    const monaco = monacoRef.current;
    if (monaco) applyMonacoTheme(monaco, themeName);
  }, [themeName]);

  if (!visible) return null;

  return (
    <div className="flex flex-col h-full bg-editor-bg border-t border-editor-border">
      <div className="flex h-8 items-center justify-between border-b border-editor-border bg-editor-sidebar px-3">
        <div className="flex min-w-0 items-center gap-2 text-xs">
          <span className="text-10 font-semibold uppercase tracking-wide text-muted-foreground">差异</span>
          <span className="text-muted-foreground truncate max-w-[200px]">
            {filePath.split('/').pop() || filePath}
          </span>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          {statusText && (
            <span
              className={`truncate text-11 ${
                statusTone === 'danger' ? 'text-red-400' : 'text-yellow-400'
              }`}
            >
              {statusText}
            </span>
          )}
          <button
            onClick={onAccept}
            className="h-6 border border-green-700 bg-green-700 px-2 text-xs text-white hover:bg-green-600"
            aria-label="接受差异"
          >
            接受
          </button>
          <button
            onClick={onReject}
            className="h-6 border border-red-700 bg-red-700 px-2 text-xs text-white hover:bg-red-600"
            aria-label="拒绝差异"
          >
            拒绝
          </button>
        </div>
      </div>
      <div ref={containerRef} className="flex-1" />
    </div>
  );
}

function guessLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript',
    js: 'javascript', jsx: 'javascript',
    py: 'python', rb: 'ruby', go: 'go', rs: 'rust',
    java: 'java', c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
    cs: 'csharp', php: 'php', swift: 'swift', kt: 'kotlin',
    json: 'json', yaml: 'yaml', yml: 'yaml',
    md: 'markdown', html: 'html', css: 'css', scss: 'scss',
    sh: 'shell', sql: 'sql', xml: 'xml', toml: 'toml',
  };
  return map[ext] || 'plaintext';
}
