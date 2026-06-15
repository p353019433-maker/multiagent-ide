import React, { useState, useCallback, useRef } from 'react';
import type { FileNode } from '@shared/types';
import { useEditor } from '../../context/EditorContext';
import { useWorkspace } from '../../context/WorkspaceContext';
import ContextMenu from '../ui/ContextMenu';
import { logAndIgnore } from '../../utils/logAndIgnore';

interface Props {
  nodes: FileNode[];
  depth: number;
}

function isSafeName(name: string): boolean {
  return !!name && !name.includes('/') && !name.includes('\\') && name !== '.' && name !== '..';
}

export default function FileTree({ nodes, depth }: Props) {
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
  }, [expanded, node, loadChildren]);

  const handleNewFolder = useCallback(async () => {
    if (!expanded && node.isDirectory) {
      const loaded = await loadChildren(node);
      setChildren(loaded);
      setExpanded(true);
    }
    setCreating('folder');
    setNewName('');
  }, [expanded, node, loadChildren]);

  const handleCreateConfirm = useCallback(async () => {
    const cleanName = newName.trim();
    if (!cleanName || !rootPath) return;
    if (!isSafeName(cleanName)) {
      window.alert('名称不能包含路径分隔符或 ..');
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
    } catch (err) {
      // was: // silently fail. Now logs to console so the failure shows up
      // in DevTools without forcing the user-facing alert on every create.
      logAndIgnore(err, { where: 'FileTree.create', path: fullPath });
    }
    setCreating(null);
    setNewName('');
  }, [newName, rootPath, node.path, creating, refreshTree, expanded, loadChildren, openFile]);

  const handleDelete = useCallback(async () => {
    const name = node.name;
    const confirmed = window.confirm(`确定删除「${name}」？此操作不可撤销。`);
    if (!confirmed) return;
    try {
      closeFile(node.path);
      await window.api.fs.delete(node.path);
      await refreshTree();
      if (expanded) {
        const loaded = await loadChildren(node);
        setChildren(loaded);
      }
    } catch (err: any) {
      window.alert(`删除失败：${err.message}`);
    }
  }, [node, closeFile, refreshTree, expanded, loadChildren]);

  const handleStartRename = useCallback(() => {
    setRenaming(true);
    setNewName(node.name);
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
      window.alert('名称不能包含路径分隔符或 ..');
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
    } catch (err: any) {
      window.alert(`重命名失败：${err.message}`);
    }
    setRenaming(false);
  }, [newName, node.name, node.path, rootPath, closeFile, refreshTree, expanded, loadChildren]);

  const isDirectory = node.isDirectory;
  const icon = isDirectory
    ? expanded
      ? '📂'
      : '📁'
    : getFileIcon(node.name);

  const menuItems = isDirectory
    ? [
        { label: '新建文件', action: handleNewFile },
        { label: '新建文件夹', action: handleNewFolder },
        { label: 'separator' },
        { label: '重命名', action: handleStartRename },
        { label: 'separator' },
        { label: '删除', action: handleDelete },
      ]
    : [
        { label: '重命名', action: handleStartRename },
        { label: 'separator' },
        { label: '删除', action: handleDelete },
      ];

  return (
    <div>
      <div
        className={`flex items-center gap-1 px-2 py-[2px] cursor-pointer text-sm hover:bg-editor-hover transition-colors ${
          isActive ? 'bg-editor-active text-white' : 'text-editor-text'
        }`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      >
        <span className="text-xs w-4 text-center flex-shrink-0">
          {isDirectory && (expanded ? '▾' : '▸')}
        </span>
        <span className="text-xs">{icon}</span>
        {renaming ? (
          <input
            ref={renameInputRef}
            className="bg-editor-active text-editor-text text-[13px] border border-editor-accent rounded px-1 py-0 outline-none flex-1 min-w-0"
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
          className="flex items-center gap-1 px-2 py-[2px]"
          style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
        >
          <span className="text-xs w-4 text-center flex-shrink-0" />
          <span className="text-xs">{creating === 'file' ? '📄' : '📁'}</span>
          <input
            ref={createInputRef}
            className="bg-editor-active text-editor-text text-[13px] border border-editor-accent rounded px-1 py-0 outline-none flex-1 min-w-0"
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
            onBlur={handleCreateConfirm}
            onClick={(e) => e.stopPropagation()}
            autoFocus
          />
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

function getFileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const icons: Record<string, string> = {
    ts: '🔷',
    tsx: '⚛️',
    js: '🟨',
    jsx: '⚛️',
    py: '🐍',
    rs: '🦀',
    go: '🐹',
    json: '📋',
    md: '📝',
    html: '🌐',
    css: '🎨',
    yaml: '⚙️',
    yml: '⚙️',
    toml: '⚙️',
    sh: '🖥️',
    sql: '🗃️',
  };
  return icons[ext] || '📄';
}