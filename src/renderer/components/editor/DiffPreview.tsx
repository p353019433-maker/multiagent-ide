import React, { useEffect, useRef } from 'react';

type MonacoModule = typeof import('monaco-editor');

interface Props {
  original: string;
  modified: string;
  filePath: string;
  language?: string;
  visible: boolean;
  onAccept: () => void;
  onReject: () => void;
}

/**
 * Inline diff preview using Monaco's built-in diff editor.
 * Shows original on the left, modified on the right,
 * with accept/reject buttons.
 */
export default function DiffPreview({ original, modified, filePath, language, visible, onAccept, onReject }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const diffEditorRef = useRef<import('monaco-editor').editor.IStandaloneDiffEditor | null>(null);
  const acceptRef = useRef(onAccept);
  const rejectRef = useRef(onReject);

  useEffect(() => {
    acceptRef.current = onAccept;
    rejectRef.current = onReject;
  }, [onAccept, onReject]);

  useEffect(() => {
    if (!containerRef.current || !visible) return;

    let disposed = false;
    let diffEditor: import('monaco-editor').editor.IStandaloneDiffEditor | null = null;
    let originalModel: import('monaco-editor').editor.ITextModel | null = null;
    let modifiedModel: import('monaco-editor').editor.ITextModel | null = null;

    void import('monaco-editor').then((monaco: MonacoModule) => {
      if (disposed || !containerRef.current) return;

      const lang = language || guessLanguage(filePath);
      originalModel = monaco.editor.createModel(original, lang);
      modifiedModel = monaco.editor.createModel(modified, lang);

      diffEditor = monaco.editor.createDiffEditor(containerRef.current, {
        theme: 'vs-dark',
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
    };
  }, [visible, filePath, original, modified, language]);

  if (!visible) return null;

  return (
    <div className="flex flex-col h-full bg-editor-bg border-t border-editor-border">
      <div className="flex items-center justify-between px-3 py-1.5 bg-editor-sidebar border-b border-editor-border">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-yellow-400 font-semibold">Diff 预览</span>
          <span className="text-gray-500 truncate max-w-[200px]">
            {filePath.split('/').pop() || filePath}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-gray-500">
            ⌘Enter 接受 · ⌘Esc 拒绝
          </span>
          <button
            onClick={onAccept}
            className="px-2 py-0.5 text-xs bg-green-600 text-white rounded hover:bg-green-700"
          >
            接受
          </button>
          <button
            onClick={onReject}
            className="px-2 py-0.5 text-xs bg-red-600 text-white rounded hover:bg-red-700"
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
