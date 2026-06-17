import React from 'react';
import { CheckCircle2, CircleAlert, CircleDot, FileText, FolderOpen, PanelLeft, X } from 'lucide-react';
import { useEditor } from '../../context/EditorContext';
import { useWorkspace } from '../../context/WorkspaceContext';
import type { AgentReadiness, ReadinessActionId, ReadinessStatus } from '../../readiness/agentReadiness';
import {
<<<<<<< HEAD
  registerAiInlineCompletion,
  unregisterAiInlineCompletion,
  recordEdit,
} from './aiInlineCompletion';
import { setCursorState } from '../../editor/cursorPosition';

type MonacoModule = typeof import('monaco-editor');

const LARGE_FILE_BYTES = 10 * 1024 * 1024;
const STATE_SYNC_DELAY_MS = 180;

export default function EditorArea() {
  const {
    openFiles,
    activeFilePath,
    updateFileContent,
    closeFile,
    setActiveFile,
    saveFileContent,
  } = useEditor();
=======
  registerInlineCompletion,
  unregisterInlineCompletion,
  updateInlineCompletionConfig,
  recordEdit,
} from './inlineCompletion';

type MonacoModule = typeof import('monaco-editor');

interface Props {
  readiness: AgentReadiness;
  onReadinessAction: (actionId: ReadinessActionId) => void;
}

const STATUS_LABEL: Record<ReadinessStatus, string> = {
  done: '完成',
  ready: '就绪',
  blocked: '需要处理',
  optional: '可选',
};

function ReadinessIcon({ status }: { status: ReadinessStatus }) {
  if (status === 'done' || status === 'ready') {
    return <CheckCircle2 size={14} strokeWidth={1.8} className="text-emerald-400" />;
  }
  if (status === 'blocked') {
    return <CircleAlert size={14} strokeWidth={1.8} className="text-yellow-400" />;
  }
  return <CircleDot size={14} strokeWidth={1.8} className="text-muted-foreground" />;
}

export default function EditorArea({ readiness, onReadinessAction }: Props) {
  const { openFiles, activeFilePath, updateFileContent, closeFile, setActiveFile, saveActiveFile } =
    useEditor();
  const { rootName } = useWorkspace();
>>>>>>> claude/review-repo-contents-tkoLx
  const containerRef = React.useRef<HTMLDivElement>(null);
  const monacoRef = React.useRef<MonacoModule | null>(null);
  const editorRef = React.useRef<import('monaco-editor').editor.IStandaloneCodeEditor | null>(null);
  const modelsRef = React.useRef<Map<string, import('monaco-editor').editor.ITextModel>>(new Map());
  const modelDisposablesRef = React.useRef<Map<string, import('monaco-editor').IDisposable>>(new Map());
  const syncTimersRef = React.useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const listenedModelsRef = React.useRef<Set<string>>(new Set());
  const activeFilePathRef = React.useRef(activeFilePath);
  const saveFileContentRef = React.useRef(saveFileContent);
  const [isMonacoReady, setIsMonacoReady] = React.useState(false);
  saveRef.current = saveActiveFile;
  // Mirror activeFilePath into a ref so the cursor handler (registered once
  // on editor creation) always sees the latest path without re-subscribing.
  activeFilePathRef.current = activeFilePath;
  saveFileContentRef.current = saveFileContent;

  const activeFile = openFiles.find((f) => f.path === activeFilePath);

  const flushModelToState = React.useCallback((filePath: string) => {
    const pending = syncTimersRef.current.get(filePath);
    if (pending) clearTimeout(pending);
    syncTimersRef.current.delete(filePath);

    const model = modelsRef.current.get(filePath);
    if (model) updateFileContent(filePath, model.getValue());
  }, [updateFileContent]);

  React.useEffect(() => {
    if (!containerRef.current || editorRef.current) return;

    let disposed = false;

    void import('monaco-editor').then((monaco) => {
      if (disposed || !containerRef.current || editorRef.current) return;

      monacoRef.current = monaco;

      monaco.editor.defineTheme('workbench-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [
          { token: 'comment', foreground: '9aa0a6' },
          { token: 'keyword', foreground: '8ab4f8' },
          { token: 'string', foreground: 'fde293' },
          { token: 'function', foreground: '81c995' },
          { token: 'variable', foreground: 'e8eaed' },
          { token: 'number', foreground: 'f28b82' },
          { token: 'type', foreground: '8ab4f8' },
        ],
        colors: {
          'editor.background': '#1f2024',
          'editor.foreground': '#e8eaed',
          'editor.lineHighlightBackground': '#ffffff08',
          'editorLineNumber.foreground': '#5f6368',
          'editor.selectionBackground': '#4285f444',
          'editorIndentGuide.background': '#ffffff10',
          'editorIndentGuide.activeBackground': '#ffffff30',
        },
      });

      const editor = monaco.editor.create(containerRef.current, {
        theme: 'workbench-dark',
        fontSize: 14,
        fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
        minimap: { enabled: true },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 2,
        wordWrap: 'on',
        lineNumbers: 'on',
        renderWhitespace: 'selection',
        bracketPairColorization: { enabled: true },
        smoothScrolling: false,
        cursorBlinking: 'blink',
        cursorSmoothCaretAnimation: 'off',
      });

      editorRef.current = editor;
      registerInlineCompletion(monaco);

      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        const filePath = activeFilePathRef.current;
        const model = editor.getModel();
        if (!filePath || !model) return;
        const pending = syncTimersRef.current.get(filePath);
        if (pending) clearTimeout(pending);
        syncTimersRef.current.delete(filePath);
        void saveFileContentRef.current(filePath, model.getValue());
      });

      // Broadcast cursor position to the StatusBar via the leaf-only bus —
      // avoids pushing per-keystroke updates through React context.
      editor.onDidChangeCursorPosition((e) => {
        const model = editor.getModel();
        const sel = editor.getSelection();
        setCursorState({
          filePath: activeFilePathRef.current,
          lineNumber: e.position.lineNumber,
          column: e.position.column,
          selectionLength: sel ? (sel.endLineNumber - sel.startLineNumber) || (sel.endColumn - sel.startColumn) : 0,
          language: model ? model.getLanguageId() : 'plaintext',
        });
      });
      // Toggle line comment on Cmd+/ — VS Code parity for keyboard-driven editing.
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Slash, () => {
        editor.getAction('editor.action.commentLine')?.run();
      });

      setIsMonacoReady(true);
    });

    return () => {
      disposed = true;
      syncTimersRef.current.forEach((timer) => clearTimeout(timer));
      syncTimersRef.current.clear();
      editorRef.current?.dispose();
      modelDisposablesRef.current.forEach((d) => d.dispose());
      modelDisposablesRef.current.clear();
      modelsRef.current.forEach((m) => m.dispose());
      modelsRef.current.clear();
      listenedModelsRef.current.clear();
      unregisterInlineCompletion();
      monacoRef.current = null;
      editorRef.current = null;
      setIsMonacoReady(false);
    };
  }, []);

  React.useEffect(() => {
    if (typeof PerformanceObserver === 'undefined') return;
    const supported = PerformanceObserver.supportedEntryTypes?.includes('longtask');
    if (!supported) return;

    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration > 16.6) {
          console.warn(`[performance] renderer long task: ${entry.duration.toFixed(1)}ms`);
        }
      }
    });
    observer.observe({ entryTypes: ['longtask'] });
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    const monaco = monacoRef.current;
    const editor = editorRef.current;
    if (!monaco || !editor || !activeFile) {
      if (editor?.getModel()) editor.setModel(null);
      return;
    }

    let model = modelsRef.current.get(activeFile.path);
    if (!model) {
      const uri = monaco.Uri.file(activeFile.path);
      model = monaco.editor.createModel(activeFile.content, activeFile.language, uri);
      modelsRef.current.set(activeFile.path, model);
    }

    if (!listenedModelsRef.current.has(activeFile.path)) {
      listenedModelsRef.current.add(activeFile.path);
      const filePath = activeFile.path;
      const disposable = model.onDidChangeContent((e) => {
        const previous = syncTimersRef.current.get(filePath);
        if (previous) clearTimeout(previous);
        syncTimersRef.current.set(filePath, setTimeout(() => {
          syncTimersRef.current.delete(filePath);
          const currentModel = modelsRef.current.get(filePath);
          if (currentModel) updateFileContent(filePath, currentModel.getValue());
        }, STATE_SYNC_DELAY_MS));

        for (const change of e.changes) {
          if (change.text && change.text.trim().length > 1) recordEdit(change.text);
        }
      });
      modelDisposablesRef.current.set(filePath, disposable);
    }

    if (editor.getModel() !== model) editor.setModel(model);

    const isLargeFile = model.getValueLength() >= LARGE_FILE_BYTES;
    editor.updateOptions({
      minimap: { enabled: !isLargeFile },
      wordWrap: isLargeFile ? 'off' : 'on',
      renderWhitespace: isLargeFile ? 'none' : 'selection',
      bracketPairColorization: { enabled: !isLargeFile },
      folding: !isLargeFile,
      codeLens: !isLargeFile,
      glyphMargin: !isLargeFile,
    });
  }, [activeFile?.path, isMonacoReady, updateFileContent]);

  React.useEffect(() => {
    if (!activeFile) return;
    const model = modelsRef.current.get(activeFile.path);
    if (model && model.getValue() !== activeFile.content) {
      const editor = editorRef.current;
      const position = editor?.getPosition();
      model.setValue(activeFile.content);
      if (editor && position) editor.setPosition(position);
    }
  }, [activeFile?.originalContent]);

  React.useEffect(() => {
    const openPaths = new Set(openFiles.map((f) => f.path));
    for (const [filePath, model] of modelsRef.current) {
      if (!openPaths.has(filePath)) {
        flushModelToState(filePath);
        modelDisposablesRef.current.get(filePath)?.dispose();
        modelDisposablesRef.current.delete(filePath);
        model.dispose();
        modelsRef.current.delete(filePath);
        listenedModelsRef.current.delete(filePath);
      }
    }
  }, [openFiles, flushModelToState]);

  return (
    <div className="flex flex-col h-full">
      {openFiles.length > 0 && (
        <div
          className="flex items-center bg-editor-sidebar border-b border-editor-border overflow-x-auto flex-shrink-0"
          role="tablist"
          aria-label="打开的文件"
        >
          {openFiles.map((file) => {
            const name = file.path.split('/').pop() || file.path;
            const isActive = file.path === activeFilePath;
            return (
              <div
                key={file.path}
<<<<<<< HEAD
                role="tab"
                aria-selected={isActive}
                tabIndex={isActive ? 0 : -1}
                className={`flex items-center gap-1 px-3 py-1.5 text-xs cursor-pointer border-r border-editor-border ${
=======
                className={`group flex h-8 min-w-[128px] max-w-[240px] items-center gap-2 border-r border-editor-border px-2.5 text-xs cursor-pointer transition-colors focus:outline-none focus:ring-1 focus:ring-editor-accent ${
>>>>>>> claude/review-repo-contents-tkoLx
                  isActive
                    ? 'bg-editor-bg text-foreground border-t-2 border-t-editor-accent'
                    : 'bg-editor-sidebar text-muted-foreground hover:bg-editor-hover'
                }`}
                onClick={() => setActiveFile(file.path)}
                onKeyDown={(event) => {
<<<<<<< HEAD
                  if (event.key === 'Enter' || event.key === ' ') setActiveFile(file.path);
                  if (event.key === 'Delete') closeFile(file.path);
                }}
=======
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setActiveFile(file.path);
                  }
                }}
                role="tab"
                aria-selected={isActive}
                tabIndex={0}
>>>>>>> claude/review-repo-contents-tkoLx
              >
                <FileText size={14} strokeWidth={1.7} className="flex-shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{name}</span>
                {file.isDirty && <span className="text-editor-accent">●</span>}
                <button
<<<<<<< HEAD
                  type="button"
                  aria-label={`关闭 ${name}`}
                  className="ml-1 text-gray-500 hover:text-white text-[10px]"
                  onClick={(event) => {
                    event.stopPropagation();
=======
                  className="flex h-5 w-5 flex-shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-editor-active hover:text-foreground"
                  title={`关闭 ${name}`}
                  aria-label={`关闭 ${name}`}
                  onClick={(e) => {
                    e.stopPropagation();
>>>>>>> claude/review-repo-contents-tkoLx
                    closeFile(file.path);
                  }}
                >
                  <X size={13} strokeWidth={1.8} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex-1 relative">
        <div
          ref={containerRef}
          className="monaco-container absolute inset-0"
          style={{ display: activeFile ? 'block' : 'none' }}
        />
        {!activeFile && (
<<<<<<< HEAD
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center">
              <p className="text-4xl mb-4">🚀</p>
              <p className="text-sm">打开文件开始编辑</p>
              <p className="text-xs text-gray-600 mt-1">使用侧边栏浏览项目文件</p>
=======
          <div className="h-full overflow-hidden bg-editor-bg text-muted-foreground">
            <div className="mx-auto mt-20 w-full max-w-[520px] px-8">
              <div className="flex h-8 items-center gap-2 border-b border-editor-border text-10 font-semibold uppercase tracking-wide text-muted-foreground">
                <PanelLeft size={14} strokeWidth={1.8} />
                工作台
              </div>
              <div className="border-b border-editor-border py-4">
                {!rootName ? (
                  <button
                    onClick={() => onReadinessAction('openWorkspace')}
                    className="inline-flex h-8 items-center gap-2 border border-editor-border bg-editor-sidebar px-3 text-sm text-editor-text transition-colors hover:bg-editor-hover"
                  >
                    <FolderOpen size={15} strokeWidth={1.8} />
                    <span>打开文件夹</span>
                  </button>
                ) : (
                  <div className="flex h-8 min-w-0 items-center gap-2 text-sm text-muted-foreground">
                    <FolderOpen size={15} strokeWidth={1.8} />
                    <span className="truncate">{rootName}</span>
                  </div>
                )}
              </div>
              <div className="flex h-10 items-center gap-2 border-b border-editor-border text-sm text-muted-foreground">
                <FileText size={15} strokeWidth={1.8} />
                <span>没有活动编辑器</span>
              </div>
              <div className="border-b border-editor-border">
                {readiness.items.map((item) => {
                  const isNext = item.actionId === readiness.nextActionId;
                  return (
                    <button
                      key={item.id}
                      onClick={() => onReadinessAction(item.actionId)}
                      className={`grid min-h-10 w-full grid-cols-[20px_minmax(0,1fr)_72px] items-center gap-2 border-b border-editor-border px-0 text-left text-xs transition-colors last:border-b-0 hover:bg-editor-hover ${
                        isNext ? 'text-editor-text' : 'text-muted-foreground'
                      }`}
                    >
                      <ReadinessIcon status={item.status} />
                      <span className="min-w-0">
                        <span className="block truncate">{item.label}</span>
                        <span className="block truncate font-mono text-10 text-muted-foreground">
                          {STATUS_LABEL[item.status]}
                        </span>
                      </span>
                      <span className={`text-right text-11 ${isNext ? 'text-editor-accent' : 'text-muted-foreground'}`}>
                        {item.actionLabel}
                      </span>
                    </button>
                  );
                })}
              </div>
>>>>>>> claude/review-repo-contents-tkoLx
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
