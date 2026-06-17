import React, { createContext, useContext, useState, useCallback, useRef, useMemo, useEffect } from 'react';
import type { OpenFile } from '@shared/types';

function getLanguageFromPath(filePath: string): string {
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

interface EditorStateValue {
  openFiles: OpenFile[];
  activeFilePath: string | null;
}

interface EditorActionsValue {
  openFile: (path: string) => Promise<void>;
  closeFile: (path: string) => void;
  setActiveFile: (path: string) => void;
  updateFileContent: (path: string, content: string) => void;
  saveFile: (path: string) => Promise<void>;
  saveFileContent: (path: string, content: string) => Promise<void>;
  saveActiveFile: () => Promise<void>;
  reloadFileFromDisk: (path: string, content?: string) => Promise<void>;
}

const EditorStateContext = createContext<EditorStateValue | null>(null);
const EditorActionsContext = createContext<EditorActionsValue | null>(null);

export function EditorProvider({ children }: { children: React.ReactNode }) {
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const openFilesRef = useRef<OpenFile[]>([]);
  openFilesRef.current = openFiles;
  const activeFilePathRef = useRef<string | null>(null);
  activeFilePathRef.current = activeFilePath;

  const openFile = useCallback(async (filePath: string) => {
    const existing = openFilesRef.current.find((f) => f.path === filePath);
    if (existing) {
      setActiveFilePath(filePath);
      return;
    }

    const content = await window.api.fs.readFile(filePath);
    const newFile: OpenFile = {
      path: filePath,
      content,
      originalContent: content,
      language: getLanguageFromPath(filePath),
      isDirty: false,
    };
    setOpenFiles((prev) => [...prev, newFile]);
    setActiveFilePath(filePath);
  }, []);

  const closeFile = useCallback((filePath: string) => {
    setOpenFiles((prev) => prev.filter((f) => f.path !== filePath));
    setActiveFilePath((current) => {
      if (current !== filePath) return current;
      const remaining = openFilesRef.current.filter((f) => f.path !== filePath);
      return remaining.length ? remaining[remaining.length - 1].path : null;
    });
  }, []);

  const setActiveFile = useCallback((filePath: string) => {
    setActiveFilePath(filePath);
  }, []);

  const updateFileContent = useCallback((filePath: string, content: string) => {
    setOpenFiles((prev) =>
      prev.map((f) =>
        f.path === filePath
          ? { ...f, content, isDirty: content !== f.originalContent }
          : f
      )
    );
  }, []);

  const saveFileContent = useCallback(async (filePath: string, content: string) => {
    await window.api.fs.writeFile(filePath, content);
    setOpenFiles((prev) =>
      prev.map((f) =>
        f.path === filePath
          ? { ...f, content, originalContent: content, isDirty: false }
          : f
      )
    );
  }, []);

  const saveFile = useCallback(async (filePath: string) => {
    const file = openFilesRef.current.find((f) => f.path === filePath);
    if (!file) return;
    await saveFileContent(filePath, file.content);
  }, [saveFileContent]);

  const saveActiveFile = useCallback(async () => {
    const current = activeFilePathRef.current;
    if (current) await saveFile(current);
  }, [saveFile]);

  const reloadFileFromDisk = useCallback(async (filePath: string, content?: string) => {
    const diskContent = content ?? await window.api.fs.readFile(filePath).catch(() => null);
    if (diskContent === null) {
      setOpenFiles((prev) => prev.filter((f) => f.path !== filePath));
      return;
    }
    setOpenFiles((prev) =>
      prev.map((f) => {
        if (f.path !== filePath) return f;
        // isDirty is derived from `content !== originalContent`. If the user
        // has unsaved local edits (content !== disk), we update originalContent
        // to disk but keep the buffer intact — the file is still dirty because
        // the buffer differs from the new original. If the buffer already
        // matches disk, the file is not dirty.
        const stillDirty = f.content !== diskContent;
        return {
          ...f,
          content: f.content,           // keep the in-memory buffer
          originalContent: diskContent, // anchor the dirty check to disk
          isDirty: stillDirty,
        };
      })
    );
  }, []);

  // Listen for file changes from the main process (watcher)
  useEffect(() => {
    const cleanup = window.api.fs.onFileChanged((events) => {
      const openPaths = new Set(openFilesRef.current.map(f => f.path));
      for (const event of events) {
        if (openPaths.has(event.path)) {
          // If a file we have open was modified or deleted externally, reload it.
          // (reloadFileFromDisk handles deletes by closing the file if read fails).
          reloadFileFromDisk(event.path);
        }
      }
    });
    return cleanup;
  }, [reloadFileFromDisk]);

  const stateValue: EditorStateValue = { openFiles, activeFilePath };

  const actionsValue = useMemo<EditorActionsValue>(
    () => ({ openFile, closeFile, setActiveFile, updateFileContent, saveFile, saveFileContent, saveActiveFile, reloadFileFromDisk }),
    [openFile, closeFile, setActiveFile, updateFileContent, saveFile, saveFileContent, saveActiveFile, reloadFileFromDisk]
  );

  return (
    <EditorStateContext.Provider value={stateValue}>
      <EditorActionsContext.Provider value={actionsValue}>
        {children}
      </EditorActionsContext.Provider>
    </EditorStateContext.Provider>
  );
}

export function useEditorState() {
  const ctx = useContext(EditorStateContext);
  if (!ctx) throw new Error('useEditorState must be used within EditorProvider');
  return ctx;
}

export function useEditorActions() {
  const ctx = useContext(EditorActionsContext);
  if (!ctx) throw new Error('useEditorActions must be used within EditorProvider');
  return ctx;
}

export function useEditor() {
  return { ...useEditorState(), ...useEditorActions() };
}
