import React, { createContext, useContext, useState, useCallback } from 'react';
import type { FileNode } from '@shared/types';

interface WorkspaceContextValue {
  rootPath: string | null;
  rootName: string | null;
  fileTree: FileNode[];
  openFolder: () => Promise<void>;
  refreshTree: () => Promise<void>;
  loadChildren: (node: FileNode) => Promise<FileNode[]>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

/** Extract folder name from path (cross-platform) */
function getFolderName(folderPath: string): string {
  // Handle both Unix and Windows separators
  const parts = folderPath.split(/[/\\]/);
  return parts[parts.length - 1] || parts[parts.length - 2] || folderPath;
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [rootPath, setRootPath] = useState<string | null>(null);
  const [fileTree, setFileTree] = useState<FileNode[]>([]);

  const refreshTree = useCallback(async () => {
    if (!rootPath) return;
    const tree = await window.api.fs.readDirectory(rootPath);
    setFileTree(tree);
  }, [rootPath]);

  const openFolder = useCallback(async () => {
    const folderPath = await window.api.openFolder();
    if (folderPath) {
      setRootPath(folderPath);
      const tree = await window.api.fs.readDirectory(folderPath);
      setFileTree(tree);
    }
  }, []);

  const loadChildren = useCallback(async (node: FileNode): Promise<FileNode[]> => {
    return window.api.fs.readDirectory(node.path);
  }, []);

  const rootName = rootPath ? getFolderName(rootPath) : null;

  return (
    <WorkspaceContext.Provider
      value={{ rootPath, rootName, fileTree, openFolder, refreshTree, loadChildren }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used within WorkspaceProvider');
  return ctx;
}
