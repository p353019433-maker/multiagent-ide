import React from 'react';
import { useEditor } from '../../context/EditorContext';
import {
  registerAiInlineCompletion,
  unregisterAiInlineCompletion,
  recordEdit,
} from './aiInlineCompletion';

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
      const editor = monaco.editor.create(containerRef.current, {
        theme: 'vs-dark',
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
      registerAiInlineCompletion(monaco);

      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        const filePath = activeFilePathRef.current;
        const model = editor.getModel();
        if (!filePath || !model) return;
        const pending = syncTimersRef.current.get(filePath);
        if (pending) clearTimeout(pending);
        syncTimersRef.current.delete(filePath);
        void saveFileContentRef.current(filePath, model.getValue());
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
      unregisterAiInlineCompletion();
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
                role="tab"
                aria-selected={isActive}
                tabIndex={isActive ? 0 : -1}
                className={`flex items-center gap-1 px-3 py-1.5 text-xs cursor-pointer border-r border-editor-border ${
                  isActive
                    ? 'bg-editor-bg text-white border-t-2 border-t-editor-accent'
                    : 'bg-editor-sidebar text-gray-400 hover:bg-editor-hover'
                }`}
                onClick={() => setActiveFile(file.path)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') setActiveFile(file.path);
                  if (event.key === 'Delete') closeFile(file.path);
                }}
              >
                <span className="truncate max-w-[120px]">{name}</span>
                {file.isDirty && <span className="text-editor-accent">●</span>}
                <button
                  type="button"
                  aria-label={`关闭 ${name}`}
                  className="ml-1 text-gray-500 hover:text-white text-[10px]"
                  onClick={(event) => {
                    event.stopPropagation();
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
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center">
              <p className="text-4xl mb-4">🚀</p>
              <p className="text-sm">打开文件开始编辑</p>
              <p className="text-xs text-gray-600 mt-1">使用侧边栏浏览项目文件</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
