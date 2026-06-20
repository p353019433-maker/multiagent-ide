import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
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

  // Start watching the workspace and handle file tree changes
  useEffect(() => {
    if (!rootPath) return;
    
    window.api.fs.startWatching(rootPath);
    
    const cleanup = window.api.fs.onFileChanged((events) => {
      // Only refresh tree if there are adds or deletes.
      // Changes to existing files don't affect the tree structure.
      const needsTreeRefresh = events.some(e => e.type === 'add' || e.type === 'unlink');
      if (needsTreeRefresh) {
        refreshTree();
      }
    });

    return () => {
      cleanup();
      window.api.fs.stopWatching();
    };
  }, [rootPath, refreshTree]);

  const openFolder = useCallback(async () => {
    const folderPath = await window.api.openFolder();
    if (folderPath) {
      setRootPath(folderPath);
      await window.api.git.authorizeWorktrees(folderPath).catch(() => []);
      const tree = await window.api.fs.readDirectory(folderPath);
      setFileTree(tree);
    }
  }, []);

  const loadChildren = useCallback(async (node: FileNode): Promise<FileNode[]> => {
    return window.api.fs.readDirectory(node.path);
  }, []);

  const rootName = rootPath ? getFolderName(rootPath) : null;

  // Memo the value object so consumers (FileTree, GitPanel, GitHubPanel,
  // ProblemsPanel, TerminalPanel, SearchPanel) only re-render when an actual
  // field changes — not on every unrelated parent render.
  const value = useMemo<WorkspaceContextValue>(
    () => ({ rootPath, rootName, fileTree, openFolder, refreshTree, loadChildren }),
    [rootPath, rootName, fileTree, openFolder, refreshTree, loadChildren]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used within WorkspaceProvider');
  return ctx;
}
