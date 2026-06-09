import React from 'react';
import { FileText, FolderOpen, PanelLeft } from 'lucide-react';
import { useEditor } from '../../context/EditorContext';
import { useWorkspace } from '../../context/WorkspaceContext';
import {
  registerInlineCompletion,
  unregisterInlineCompletion,
  updateInlineCompletionConfig,
  recordEdit,
} from './inlineCompletion';

type MonacoModule = typeof import('monaco-editor');

export default function EditorArea() {
  const { openFiles, activeFilePath, updateFileContent, closeFile, setActiveFile, saveActiveFile } =
    useEditor();
  const { rootName, openFolder } = useWorkspace();
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
                className={`flex items-center gap-1 px-3 py-1.5 text-xs cursor-pointer border-r border-editor-border transition-colors ${
                  isActive
                    ? 'bg-editor-bg text-white border-t-2 border-t-editor-accent'
                    : 'bg-editor-sidebar text-gray-400 hover:bg-editor-hover'
                }`}
                onClick={() => setActiveFile(file.path)}
              >
                <span className="truncate max-w-[120px]">{name}</span>
                {file.isDirty && <span className="text-editor-accent">●</span>}
                <button
                  className="ml-1 text-gray-500 hover:text-white text-[10px]"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeFile(file.path);
                  }}
                >
                  ✕
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
            <div className="grid grid-cols-[72px_minmax(0,1fr)] border-b border-editor-border text-sm">
              <div className="border-r border-editor-border bg-editor-sidebar px-2 py-2 font-mono text-[10px] leading-5 text-gray-600">
                WORK
              </div>
              <div>
                <div className="flex h-8 items-center gap-2 border-b border-editor-border px-3 text-[10px] font-semibold uppercase tracking-wide text-gray-600">
                  <PanelLeft size={14} strokeWidth={1.8} />
                  工作台
                </div>
                {!rootName ? (
                  <button
                    onClick={openFolder}
                    className="flex h-9 w-full items-center gap-2 border-b border-editor-border px-3 text-left text-editor-text hover:bg-editor-hover"
                  >
                    <FolderOpen size={15} strokeWidth={1.8} />
                    <span>打开文件夹</span>
                  </button>
                ) : (
                  <div className="flex h-9 items-center gap-2 border-b border-editor-border px-3 text-gray-400">
                    <FolderOpen size={15} strokeWidth={1.8} />
                    <span className="truncate">{rootName}</span>
                  </div>
                )}
                <div className="flex h-9 items-center gap-2 px-3 text-gray-500">
                  <FileText size={15} strokeWidth={1.8} />
                  <span>没有活动编辑器</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
