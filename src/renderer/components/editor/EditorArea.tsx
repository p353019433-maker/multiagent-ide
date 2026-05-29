import React, { useEffect, useRef } from 'react';
import { useEditor } from '../../context/EditorContext';
import * as monaco from 'monaco-editor';

export default function EditorArea() {
  const { openFiles, activeFilePath, updateFileContent, closeFile, setActiveFile, saveActiveFile } =
    useEditor();
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const modelsRef = useRef<Map<string, monaco.editor.ITextModel>>(new Map());
  const listenedModelsRef = useRef<Set<string>>(new Set());
  // Keep a ref to saveActiveFile so the keybinding always calls the latest version
  const saveRef = useRef(saveActiveFile);
  saveRef.current = saveActiveFile;

  const activeFile = openFiles.find((f) => f.path === activeFilePath);

  // Initialize editor once (container is always rendered, just hidden when empty)
  useEffect(() => {
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

    // Cmd+S / Ctrl+S to save
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

  // Switch model when active file changes
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !activeFile) {
      // No active file: detach model
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

    // Bind content-change listener only once per model
    if (!listenedModelsRef.current.has(activeFile.path)) {
      listenedModelsRef.current.add(activeFile.path);
      const filePath = activeFile.path;
      model.onDidChangeContent(() => {
        const m = modelsRef.current.get(filePath);
        if (m) updateFileContent(filePath, m.getValue());
      });
    }

    if (editor.getModel() !== model) {
      editor.setModel(model);
    }
  }, [activeFile?.path, updateFileContent]);

  // Update model content if file reloaded externally (e.g. after save or agent edit)
  useEffect(() => {
    if (!activeFile) return;
    const model = modelsRef.current.get(activeFile.path);
    if (model && model.getValue() !== activeFile.content) {
      // Preserve cursor position
      const editor = editorRef.current;
      const position = editor?.getPosition();
      model.setValue(activeFile.content);
      if (editor && position) {
        editor.setPosition(position);
      }
    }
  }, [activeFile?.originalContent]);

  // Cleanup models for closed files
  useEffect(() => {
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
      {/* Tabs */}
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

      {/* Editor container (always rendered) */}
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
              <p className="text-sm">Open a file to start editing</p>
              <p className="text-xs text-gray-600 mt-1">
                Use the sidebar to browse your project
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
