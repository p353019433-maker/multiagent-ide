import React, { useState, useCallback, useRef, useEffect } from 'react';
import type { FileNode } from '@shared/types';
import { useEditor } from '../../context/EditorContext';
import { useWorkspace } from '../../context/WorkspaceContext';
import ContextMenu from '../ui/ContextMenu';

interface Props {
  nodes: FileNode[];
  depth: number;
}

function isSafeName(name: string): boolean {
  return !!name && !name.includes('/') && !name.includes('\\') && name !== '.' && name !== '..';
}

export default function FileTree({ nodes, depth }: Props) {
  const { refreshTree } = useWorkspace();

  useEffect(() => {
    const handleReverted = () => refreshTree();
    window.addEventListener('files-reverted', handleReverted);
    return () => window.removeEventListener('files-reverted', handleReverted);
  }, [refreshTree]);

  return (
    <div>
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
    const cleanName = newName.trim();
    if (!rootPath) return;
    if (!cleanName) {
      setCreating(null);
      setNewName('');
      return;
    }
    if (!isSafeName(cleanName)) {
      setNodeError('名称不能包含路径分隔符或 ..');
      return;
    }
    const fullPath = node.path + '/' + cleanName;
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setNodeError(message || '创建失败');
      return;
    }
    setCreating(null);
    setNewName('');
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
    try {
      await window.api.fs.rename(node.path, newPath);
      closeFile(node.path);
      closeFile(newPath);
      await refreshTree();
      if (expanded) {
        const loaded = await loadChildren(node);
        setChildren(loaded);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setNodeError(`重命名失败：${message}`);
    }
    setRenaming(false);
  }, [newName, node.name, node.path, rootPath, closeFile, refreshTree, expanded, loadChildren]);

  const isDirectory = node.isDirectory;
  const typeLabel = isDirectory ? 'DIR' : getFileLabel(node.name);

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
        className={`flex h-6 items-center gap-1 px-2 cursor-pointer text-sm hover:bg-editor-hover transition-colors ${
          isActive ? 'bg-editor-active text-white' : 'text-editor-text'
        }`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      >
        <span className="text-xs w-4 text-center flex-shrink-0 text-gray-500">
          {isDirectory && (expanded ? '▾' : '▸')}
        </span>
        <span className="w-7 flex-shrink-0 font-mono text-[9px] uppercase text-gray-500">
          {typeLabel}
        </span>
        {renaming ? (
          <input
            ref={renameInputRef}
            className="min-w-0 flex-1 border border-editor-accent bg-editor-active px-1 py-0 text-[13px] text-editor-text outline-none"
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
          <span className="truncate text-[13px]">{node.name}</span>
        )}
      </div>

      {creating && (
        <div
          className="flex h-6 items-center gap-1 px-2"
          style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
        >
          <span className="text-xs w-4 text-center flex-shrink-0" />
          <span className="w-7 flex-shrink-0 font-mono text-[9px] uppercase text-gray-500">
            {creating === 'file' ? 'NEW' : 'DIR'}
          </span>
          <input
            ref={createInputRef}
            className="min-w-0 flex-1 border border-editor-accent bg-editor-active px-1 py-0 text-[13px] text-editor-text outline-none"
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
            className="border border-red-700 px-1.5 py-0.5 text-[11px] text-red-300 hover:bg-editor-hover"
          >
            删除
          </button>
          <button
            onClick={() => setPendingDelete(false)}
            className="border border-editor-border px-1.5 py-0.5 text-[11px] text-gray-400 hover:bg-editor-hover hover:text-white"
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

function getFileLabel(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const labels: Record<string, string> = {
    ts: 'TS',
    tsx: 'TSX',
    js: 'JS',
    jsx: 'JSX',
    py: 'PY',
    rs: 'RS',
    go: 'GO',
    json: '{}',
    md: 'MD',
    html: '<>',
    css: 'CSS',
    yaml: 'YML',
    yml: 'YML',
    toml: 'TOML',
    sh: 'SH',
    sql: 'SQL',
  };
  return labels[ext] || 'FILE';
}
