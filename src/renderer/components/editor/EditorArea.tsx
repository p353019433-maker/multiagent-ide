import React from 'react';
import { CheckCircle2, CircleAlert, CircleDot, FileText, FolderOpen, PanelLeft, X } from 'lucide-react';
import { useEditor, useEditorState } from '../../context/EditorContext';
import { useWorkspace } from '../../context/WorkspaceContext';
import { useTheme } from '../../context/ThemeContext';
import { applyMonacoTheme, defineMonacoThemes, monacoThemeName } from '../../monacoTheme';
import { openPalette } from '../palette/paletteEvents';
import type { AgentReadiness, ReadinessActionId, ReadinessStatus } from '../../readiness/agentReadiness';
import {
  registerInlineCompletion,
  unregisterInlineCompletion,
  updateInlineCompletionConfig,
  recordEdit,
} from './inlineCompletion';
import { setCursorState, DEFAULT_CURSOR } from '../../editor/cursorPosition';

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
  const { editorSettings } = useEditorState();
  const { rootName } = useWorkspace();
  const { themeName } = useTheme();
  const themeNameRef = React.useRef(themeName);
  themeNameRef.current = themeName;
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

      defineMonacoThemes(monaco);

      const editor = monaco.editor.create(containerRef.current, {
        theme: monacoThemeName(themeNameRef.current),
        fontSize: editorSettings.fontSize,
        fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
        minimap: { enabled: true },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: editorSettings.tabSize,
        wordWrap: editorSettings.wordWrap ? 'on' : 'off',
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
      // 编辑器内也能唤起 Quick Open / 命令面板（Monaco 会吞掉全局 keydown）
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyP, () => {
        openPalette('files');
      });
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, () => {
        openPalette('commands');
      });

      // Publish cursor position/selection to the leaf-only bus the StatusBar
      // subscribes to (keeps per-keystroke changes out of React context).
      const publishCursor = () => {
        const ed = editorRef.current;
        const model = ed?.getModel();
        const pos = ed?.getPosition();
        if (!ed || !model || !pos) return;
        const sel = ed.getSelection();
        setCursorState({
          filePath: model.uri.fsPath,
          lineNumber: pos.lineNumber,
          column: pos.column,
          selectionLength: sel ? model.getValueInRange(sel).length : 0,
          language: model.getLanguageId(),
        });
      };
      editor.onDidChangeCursorPosition(publishCursor);
      editor.onDidChangeCursorSelection(publishCursor);

      setIsMonacoReady(true);
    });

    return () => {
      disposed = true;
      setCursorState(DEFAULT_CURSOR);
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

  // 主题切换时全局更新 Monaco（setTheme 对所有 editor 实例生效，含 diff editor）
  React.useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco || !isMonacoReady) return;
    applyMonacoTheme(monaco, themeName);
  }, [themeName, isMonacoReady]);

  // Apply editor preferences (font size / tab size / word wrap) without re-creating
  // the editor. `updateOptions` is cheap and keeps the cursor, scroll and models.
  React.useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !isMonacoReady) return;
    editor.updateOptions({
      fontSize: editorSettings.fontSize,
      tabSize: editorSettings.tabSize,
      wordWrap: editorSettings.wordWrap ? 'on' : 'off',
    });
    // tabSize is per-model in Monaco; the option above only sets the default
    // for new models. Stamp it onto every existing model too so changes apply
    // to already-open files.
    modelsRef.current.forEach((m) => m.updateOptions({ tabSize: editorSettings.tabSize }));
  }, [editorSettings.fontSize, editorSettings.tabSize, editorSettings.wordWrap, isMonacoReady]);


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
                    ? 'bg-editor-bg text-foreground border-t-2 border-t-editor-accent'
                    : 'bg-editor-sidebar text-muted-foreground hover:bg-editor-hover'
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
                <FileText size={14} strokeWidth={1.7} className="flex-shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{name}</span>
                {file.isDirty && <span className="text-editor-accent">●</span>}
                <button
                  className="flex h-5 w-5 flex-shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-editor-active hover:text-foreground"
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
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
