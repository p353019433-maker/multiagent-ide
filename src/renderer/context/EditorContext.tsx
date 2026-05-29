import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
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

interface EditorContextValue {
  openFiles: OpenFile[];
  activeFilePath: string | null;
  openFile: (path: string) => Promise<void>;
  closeFile: (path: string) => void;
  setActiveFile: (path: string) => void;
  updateFileContent: (path: string, content: string) => void;
  saveFile: (path: string) => Promise<void>;
  saveActiveFile: () => Promise<void>;
}

const EditorContext = createContext<EditorContextValue | null>(null);

export function EditorProvider({ children }: { children: React.ReactNode }) {
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  // Use ref to avoid stale closure issues in callbacks
  const openFilesRef = useRef<OpenFile[]>([]);
  openFilesRef.current = openFiles;

  const openFile = useCallback(async (filePath: string) => {
    // Check if already open
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
    setOpenFiles((prev) => {
      const next = prev.filter((f) => f.path !== filePath);
      return next;
    });
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

  const saveFile = useCallback(async (filePath: string) => {
    const file = openFilesRef.current.find((f) => f.path === filePath);
    if (!file) return;
    await window.api.fs.writeFile(filePath, file.content);
    setOpenFiles((prev) =>
      prev.map((f) =>
        f.path === filePath ? { ...f, originalContent: f.content, isDirty: false } : f
      )
    );
  }, []);

  const saveActiveFile = useCallback(async () => {
    if (activeFilePath) await saveFile(activeFilePath);
  }, [activeFilePath, saveFile]);

  return (
    <EditorContext.Provider
      value={{
        openFiles,
        activeFilePath,
        openFile,
        closeFile,
        setActiveFile,
        updateFileContent,
        saveFile,
        saveActiveFile,
      }}
    >
      {children}
    </EditorContext.Provider>
  );
}

export function useEditor() {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error('useEditor must be used within EditorProvider');
  return ctx;
}
