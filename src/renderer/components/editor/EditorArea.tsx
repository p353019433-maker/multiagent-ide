import React from 'react';
import { CheckCircle2, CircleAlert, CircleDot, FileText, FolderOpen, PanelLeft, X } from 'lucide-react';
import { useEditor } from '../../context/EditorContext';
import { useWorkspace } from '../../context/WorkspaceContext';
import type { AgentReadiness, ReadinessActionId, ReadinessStatus } from '../../readiness/agentReadiness';
import {
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
  return <CircleDot size={14} strokeWidth={1.8} className="text-gray-500" />;
}

export default function EditorArea({ readiness, onReadinessAction }: Props) {
  const { openFiles, activeFilePath, updateFileContent, closeFile, setActiveFile, saveActiveFile } =
    useEditor();
  const { rootName } = useWorkspace();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const monacoRef = React.useRef<MonacoModule | null>(null);
  const editorRef = React.useRef<import('monaco-editor').editor.IStandaloneCodeEditor | null>(null);
  const modelsRef = React.useRef<Map<string, import('monaco-editor').editor.ITextModel>>(new Map());
  const listenedModelsRef = React.useRef<Set<string>>(new Set());
  const saveRef = React.useRef(saveActiveFile);
  const [isMonacoReady, setIsMonacoReady] = React.useState(false);
  saveRef.current = saveActiveFile;

  const activeFile = openFiles.find((f) => f.path === activeFilePath);

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
        smoothScrolling: true,
        cursorBlinking: 'smooth',
        cursorSmoothCaretAnimation: 'on',
      });

      editorRef.current = editor;
      registerInlineCompletion(monaco);

      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        saveRef.current();
      });
      setIsMonacoReady(true);
    });

    return () => {
      disposed = true;
      editorRef.current?.dispose();
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
    const monaco = monacoRef.current;
    const editor = editorRef.current;
    if (!monaco || !editor || !activeFile) {
      if (editor && editor.getModel()) {
        editor.setModel(null);
      }
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
      model.onDidChangeContent((e) => {
        const m = modelsRef.current.get(filePath);
        if (m) updateFileContent(filePath, m.getValue());
        // Feed non-trivial inserts to the next-edit predictor.
        for (const c of e.changes) {
          if (c.text && c.text.trim().length > 1) recordEdit(c.text);
        }
      });
    }

    if (editor.getModel() !== model) {
      editor.setModel(model);
    }
  }, [activeFile?.path, isMonacoReady, updateFileContent]);

  React.useEffect(() => {
    if (!activeFile) return;
    const model = modelsRef.current.get(activeFile.path);
    if (model && model.getValue() !== activeFile.content) {
      const editor = editorRef.current;
      const position = editor?.getPosition();
      model.setValue(activeFile.content);
      if (editor && position) {
        editor.setPosition(position);
      }
    }
  }, [activeFile?.originalContent]);

  React.useEffect(() => {
    const openPaths = new Set(openFiles.map((f) => f.path));
    for (const [filePath, model] of modelsRef.current) {
      if (!openPaths.has(filePath)) {
        model.dispose();
        modelsRef.current.delete(filePath);
        listenedModelsRef.current.delete(filePath);
      }
    }
  }, [openFiles]);

  return (
    <div className="flex flex-col h-full">
      {openFiles.length > 0 && (
        <div className="flex items-center bg-editor-sidebar border-b border-editor-border overflow-x-auto flex-shrink-0">
          {openFiles.map((file) => {
            const name = file.path.split('/').pop() || file.path;
            const isActive = file.path === activeFilePath;
            return (
              <div
                key={file.path}
                className={`group flex h-8 min-w-[128px] max-w-[240px] items-center gap-2 border-r border-editor-border px-2.5 text-xs cursor-pointer transition-colors focus:outline-none focus:ring-1 focus:ring-editor-accent ${
                  isActive
                    ? 'bg-editor-bg text-white border-t-2 border-t-editor-accent'
                    : 'bg-editor-sidebar text-gray-400 hover:bg-editor-hover'
                }`}
                onClick={() => setActiveFile(file.path)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setActiveFile(file.path);
                  }
                }}
                role="tab"
                aria-selected={isActive}
                tabIndex={0}
              >
                <FileText size={14} strokeWidth={1.7} className="flex-shrink-0 text-gray-500" />
                <span className="min-w-0 flex-1 truncate">{name}</span>
                {file.isDirty && <span className="text-editor-accent">●</span>}
                <button
                  className="flex h-5 w-5 flex-shrink-0 items-center justify-center text-gray-500 transition-colors hover:bg-editor-active hover:text-white"
                  title={`关闭 ${name}`}
                  aria-label={`关闭 ${name}`}
                  onClick={(e) => {
                    e.stopPropagation();
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
          <div className="h-full overflow-hidden bg-editor-bg text-gray-500">
            <div className="mx-auto mt-20 w-full max-w-[520px] px-8">
              <div className="flex h-8 items-center gap-2 border-b border-editor-border text-[10px] font-semibold uppercase tracking-wide text-gray-600">
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
                  <div className="flex h-8 min-w-0 items-center gap-2 text-sm text-gray-400">
                    <FolderOpen size={15} strokeWidth={1.8} />
                    <span className="truncate">{rootName}</span>
                  </div>
                )}
              </div>
              <div className="flex h-10 items-center gap-2 border-b border-editor-border text-sm text-gray-500">
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
                        isNext ? 'text-editor-text' : 'text-gray-500'
                      }`}
                    >
                      <ReadinessIcon status={item.status} />
                      <span className="min-w-0">
                        <span className="block truncate">{item.label}</span>
                        <span className="block truncate font-mono text-[10px] text-gray-600">
                          {STATUS_LABEL[item.status]}
                        </span>
                      </span>
                      <span className={`text-right text-[11px] ${isNext ? 'text-editor-accent' : 'text-gray-600'}`}>
                        {item.actionLabel}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
