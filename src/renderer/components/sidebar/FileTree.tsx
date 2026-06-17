import React, { useState, useCallback, useRef, useEffect } from 'react';
import type { FileNode } from '@shared/types';
import { useEditor } from '../../context/EditorContext';
import { useWorkspace } from '../../context/WorkspaceContext';
import ContextMenu from '../ui/ContextMenu';
<<<<<<< HEAD
import { logAndIgnore } from '../../utils/logAndIgnore';
import { isSafeName } from '../../utils/pathSafety';
=======
import {
  Braces,
  ChevronDown,
  ChevronRight,
  Code2,
  Database,
  File,
  FileText,
  Folder,
  FolderOpen,
  Globe,
  Palette,
  Terminal,
  type LucideIcon,
} from 'lucide-react';
>>>>>>> claude/review-repo-contents-tkoLx

interface Props {
  nodes: FileNode[];
  depth: number;
}

export default function FileTree({ nodes, depth }: Props) {
  const { refreshTree } = useWorkspace();

  useEffect(() => {
    const handleReverted = () => refreshTree();
    window.addEventListener('files-reverted', handleReverted);
    return () => window.removeEventListener('files-reverted', handleReverted);
  }, [refreshTree]);

  return (
    <div role={depth === 0 ? 'tree' : 'group'}>
      {nodes.map((node) => (
        <FileTreeNode key={node.path} node={node} depth={depth} />
      ))}
    </div>
  );
}

function FileTreeNode({ node, depth }: { node: FileNode; depth: number }) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FileNode[] | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(node.name);
  const [creating, setCreating] = useState<'file' | 'folder' | null>(null);
  const [pendingDelete, setPendingDelete] = useState(false);
  const [nodeError, setNodeError] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);
  const createInputRef = useRef<HTMLInputElement>(null);
  // Latches for the rename/create flows. Pressing Enter on the input fires
  // onKeyDown(Enter) and then onBlur; without this guard both call the
  // confirm handler, so the second call races against the first (renames a
  // path that no longer exists, or creates a duplicate file).
  const renameInFlightRef = useRef(false);
  const createInFlightRef = useRef(false);

  const { openFile, activeFilePath, closeFile } = useEditor();
  const { loadChildren, refreshTree, rootPath } = useWorkspace();

  const isActive = activeFilePath === node.path;

  const handleClick = useCallback(async () => {
    if (node.isDirectory) {
      if (!expanded && !children) {
        const loaded = await loadChildren(node);
        setChildren(loaded);
      }
      setExpanded(!expanded);
    } else {
      openFile(node.path);
    }
  }, [node, expanded, children, loadChildren, openFile]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ x: e.clientX, y: e.clientY });
    },
    []
  );

  const handleNewFile = useCallback(async () => {
    if (!expanded && node.isDirectory) {
      const loaded = await loadChildren(node);
      setChildren(loaded);
      setExpanded(true);
    }
    setCreating('file');
    setNewName('');
    setNodeError('');
  }, [expanded, node, loadChildren]);

  const handleNewFolder = useCallback(async () => {
    if (!expanded && node.isDirectory) {
      const loaded = await loadChildren(node);
      setChildren(loaded);
      setExpanded(true);
    }
    setCreating('folder');
    setNewName('');
    setNodeError('');
  }, [expanded, node, loadChildren]);

  const handleCreateConfirm = useCallback(async () => {
    if (createInFlightRef.current) return;
    const cleanName = newName.trim();
<<<<<<< HEAD
    if (!cleanName || !rootPath) {
=======
    if (!rootPath) return;
    if (!cleanName) {
>>>>>>> claude/review-repo-contents-tkoLx
      setCreating(null);
      setNewName('');
      return;
    }
    if (!isSafeName(cleanName)) {
<<<<<<< HEAD
      window.alert('名称不能包含路径分隔符或 ..');
      setCreating(null);
      setNewName('');
=======
      setNodeError('名称不能包含路径分隔符或 ..');
>>>>>>> claude/review-repo-contents-tkoLx
      return;
    }
    const fullPath = node.path + '/' + cleanName;
    createInFlightRef.current = true;
    try {
      if (creating === 'file') {
        await window.api.fs.createFile(fullPath);
      } else {
        await window.api.fs.createDirectory(fullPath);
      }
      await refreshTree();
      if (expanded) {
        const loaded = await loadChildren(node);
        setChildren(loaded);
      }
      if (creating === 'file') {
        openFile(fullPath);
      }
<<<<<<< HEAD
    } catch (err: any) {
      // Surface the failure to the user — silent loss is hostile UX.
      const verb = creating === 'file' ? '创建文件' : '创建文件夹';
      window.alert(`${verb}失败：${err?.message || err}`);
      logAndIgnore(err, { where: 'FileTree.create', path: fullPath });
    } finally {
      createInFlightRef.current = false;
      setCreating(null);
      setNewName('');
=======
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setNodeError(message || '创建失败');
      return;
>>>>>>> claude/review-repo-contents-tkoLx
    }
  }, [newName, rootPath, node.path, creating, refreshTree, expanded, loadChildren, openFile]);

  const requestDelete = useCallback(() => {
    setPendingDelete(true);
    setNodeError('');
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    try {
      closeFile(node.path);
      await window.api.fs.delete(node.path);
      await refreshTree();
      if (expanded) {
        const loaded = await loadChildren(node);
        setChildren(loaded);
      }
      setPendingDelete(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setNodeError(`删除失败：${message}`);
    }
  }, [node, closeFile, refreshTree, expanded, loadChildren]);

  const handleStartRename = useCallback(() => {
    setRenaming(true);
    setNewName(node.name);
    setNodeError('');
    setTimeout(() => renameInputRef.current?.focus(), 10);
    setTimeout(() => renameInputRef.current?.select(), 20);
  }, [node.name]);

  const handleRenameConfirm = useCallback(async () => {
    if (renameInFlightRef.current) return;
    if (!newName.trim() || newName.trim() === node.name || !rootPath) {
      setRenaming(false);
      return;
    }
    const cleanName = newName.trim();
    if (!isSafeName(cleanName)) {
      setNodeError('名称不能包含路径分隔符或 ..');
      setRenaming(false);
      return;
    }
    const dir = node.path.substring(0, node.path.lastIndexOf('/'));
    const newPath = dir + '/' + cleanName;
    renameInFlightRef.current = true;
    try {
      await window.api.fs.rename(node.path, newPath);
      closeFile(node.path);
      closeFile(newPath);
      await refreshTree();
      if (expanded) {
        const loaded = await loadChildren(node);
        setChildren(loaded);
      }
<<<<<<< HEAD
    } catch (err: any) {
      window.alert(`重命名失败：${err.message}`);
    } finally {
      renameInFlightRef.current = false;
      setRenaming(false);
=======
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setNodeError(`重命名失败：${message}`);
>>>>>>> claude/review-repo-contents-tkoLx
    }
  }, [newName, node.name, node.path, rootPath, closeFile, refreshTree, expanded, loadChildren]);

  const isDirectory = node.isDirectory;
  const icon = getFileIcon(node.name, isDirectory, expanded);
  const FileIcon = icon.Icon;

  const menuItems = isDirectory
    ? [
        { label: '新建文件', action: handleNewFile },
        { label: '新建文件夹', action: handleNewFolder },
        { label: '', separator: true },
        { label: '重命名', action: handleStartRename },
        { label: '', separator: true },
        { label: '删除', action: requestDelete },
      ]
    : [
        { label: '重命名', action: handleStartRename },
        { label: '', separator: true },
        { label: '删除', action: requestDelete },
      ];

  return (
    <div>
      <div
        className={`flex h-6 items-center gap-1 px-2 cursor-pointer text-sm transition-colors hover:bg-editor-hover focus:bg-editor-active focus:outline-none ${
          isActive ? 'bg-editor-active text-foreground' : 'text-editor-text'
        }`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={handleClick}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            void handleClick();
          }
        }}
        onContextMenu={handleContextMenu}
        role="treeitem"
        aria-expanded={isDirectory ? expanded : undefined}
        aria-selected={isActive}
        tabIndex={0}
      >
        <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center text-muted-foreground">
          {node.isDirectory && (
            expanded ? (
              <ChevronDown size={13} strokeWidth={1.8} />
            ) : (
              <ChevronRight size={13} strokeWidth={1.8} />
            )
          )}
        </span>
        <span className={`flex h-4 w-5 flex-shrink-0 items-center justify-center ${icon.color}`}>
          <FileIcon size={15} strokeWidth={1.7} />
        </span>
        {renaming ? (
          <input
            ref={renameInputRef}
            className="min-w-0 flex-1 border border-editor-accent bg-editor-active px-1 py-0 text-13 text-editor-text outline-none"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRenameConfirm();
              if (e.key === 'Escape') setRenaming(false);
            }}
            onBlur={handleRenameConfirm}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="truncate text-13">{node.name}</span>
        )}
      </div>

      {creating && (
        <div
          className="flex h-6 items-center gap-1 px-2"
          style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
        >
          <span className="text-xs w-4 text-center flex-shrink-0" />
          <span className="flex h-4 w-5 flex-shrink-0 items-center justify-center text-muted-foreground">
            {creating === 'file' ? (
              <File size={15} strokeWidth={1.7} />
            ) : (
              <Folder size={15} strokeWidth={1.7} />
            )}
          </span>
          <input
            ref={createInputRef}
            className="min-w-0 flex-1 border border-editor-accent bg-editor-active px-1 py-0 text-13 text-editor-text outline-none"
            value={newName}
            placeholder={creating === 'file' ? '文件名.ts' : '文件夹名'}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateConfirm();
              if (e.key === 'Escape') {
                setCreating(null);
                setNewName('');
              }
            }}
            onBlur={() => {
              if (newName.trim()) void handleCreateConfirm();
              else {
                setCreating(null);
                setNewName('');
              }
            }}
            onClick={(e) => e.stopPropagation()}
            autoFocus
          />
        </div>
      )}

      {pendingDelete && (
        <div
          className="flex min-h-7 items-center gap-2 px-2 text-xs"
          style={{ paddingLeft: `${depth * 12 + 28}px` }}
        >
          <span className="min-w-0 flex-1 truncate text-red-300">删除 {node.name}？</span>
          <button
            onClick={handleDeleteConfirm}
            className="border border-red-700 px-1.5 py-0.5 text-11 text-red-300 hover:bg-editor-hover"
          >
            删除
          </button>
          <button
            onClick={() => setPendingDelete(false)}
            className="border border-editor-border px-1.5 py-0.5 text-11 text-muted-foreground hover:bg-editor-hover hover:text-foreground"
          >
            取消
          </button>
        </div>
      )}

      {nodeError && (
        <div
          className="border-b border-editor-border px-2 py-1 text-xs text-red-400"
          style={{ paddingLeft: `${depth * 12 + 28}px` }}
        >
          {nodeError}
        </div>
      )}

      {expanded && children && <FileTree nodes={children} depth={depth + 1} />}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={menuItems}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}

function getFileIcon(
  name: string,
  isDirectory: boolean,
  expanded: boolean
): { Icon: LucideIcon; color: string } {
  if (isDirectory) {
    return {
      Icon: expanded ? FolderOpen : Folder,
      color: expanded ? 'text-editor-accent' : 'text-muted-foreground',
    };
  }

  const ext = name.split('.').pop()?.toLowerCase() || '';
  const icons: Record<string, { Icon: LucideIcon; color: string }> = {
    ts: { Icon: Code2, color: 'text-sky-400' },
    tsx: { Icon: Code2, color: 'text-sky-400' },
    js: { Icon: Code2, color: 'text-yellow-400' },
    jsx: { Icon: Code2, color: 'text-yellow-400' },
    py: { Icon: Code2, color: 'text-blue-400' },
    rs: { Icon: Code2, color: 'text-orange-400' },
    go: { Icon: Code2, color: 'text-cyan-400' },
    json: { Icon: Braces, color: 'text-yellow-500' },
    md: { Icon: FileText, color: 'text-blue-300' },
    html: { Icon: Globe, color: 'text-orange-400' },
    css: { Icon: Palette, color: 'text-violet-400' },
    yaml: { Icon: Braces, color: 'text-muted-foreground' },
    yml: { Icon: Braces, color: 'text-muted-foreground' },
    toml: { Icon: Braces, color: 'text-muted-foreground' },
    sh: { Icon: Terminal, color: 'text-green-400' },
    sql: { Icon: Database, color: 'text-cyan-400' },
  };
  return icons[ext] || { Icon: File, color: 'text-muted-foreground' };
}
