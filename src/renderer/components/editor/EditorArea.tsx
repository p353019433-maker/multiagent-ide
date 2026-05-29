import React from 'react';
import { useEditor } from '../../context/EditorContext';
import * as monaco from 'monaco-editor';
import {
  registerAiInlineCompletion,
  updateInlineCompletionConfig,
  recordEdit,
} from './aiInlineCompletion';

export default function EditorArea() {
  const { openFiles, activeFilePath, updateFileContent, closeFile, setActiveFile, saveActiveFile } =
    useEditor();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const editorRef = React.useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const modelsRef = React.useRef<Map<string, monaco.editor.ITextModel>>(new Map());
  const listenedModelsRef = React.useRef<Set<string>>(new Set());
  const saveRef = React.useRef(saveActiveFile);
  saveRef.current = saveActiveFile;

  const activeFile = openFiles.find((f) => f.path === activeFilePath);

  React.useEffect(() => {
    if (!containerRef.current || editorRef.current) return;

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
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      cursorSmoothCaretAnimation: 'on',
    });

    editorRef.current = editor;

    // Register AI inline completion
    registerAiInlineCompletion();

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      saveRef.current();
    });

    return () => {
      editor.dispose();
      modelsRef.current.forEach((m) => m.dispose());
      modelsRef.current.clear();
      listenedModelsRef.current.clear();
      editorRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !activeFile) {
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
  }, [activeFile?.path, updateFileContent]);

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
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center">
              <p className="text-4xl mb-4">🚀</p>
              <p className="text-sm">打开文件开始编辑</p>
              <p className="text-xs text-gray-600 mt-1">
                使用侧边栏浏览项目文件
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}