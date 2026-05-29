import React from 'react';
import { useWorkspace } from '../../context/WorkspaceContext';
import { useEditor } from '../../context/EditorContext';
import FileTree from './FileTree';

export default function Sidebar() {
  const { rootPath, rootName, fileTree, openFolder, refreshTree } = useWorkspace();
  const { openFile } = useEditor();

  const handleNewFile = async () => {
    if (!rootPath) return;
    const name = prompt('File name:');
    if (!name) return;
    const filePath = rootPath + '/' + name;
    try {
      await window.api.fs.createFile(filePath);
      await refreshTree();
      openFile(filePath);
    } catch (err: any) {
      // silently fail
    }
  };

  const handleNewFolder = async () => {
    if (!rootPath) return;
    const name = prompt('Folder name:');
    if (!name) return;
    const dirPath = rootPath + '/' + name;
    try {
      await window.api.fs.createDirectory(dirPath);
      await refreshTree();
    } catch (err: any) {
      // silently fail
    }
  };

  return (
    <div className="h-full flex flex-col bg-editor-sidebar">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-editor-border">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
          {rootName || 'Explorer'}
        </span>
        <div className="flex items-center gap-0.5">
          {rootPath && (
            <>
              <button
                onClick={handleNewFile}
                className="text-xs px-1.5 py-0.5 rounded hover:bg-editor-active text-gray-400 hover:text-white transition-colors"
                title="New File"
              >
                📄
              </button>
              <button
                onClick={handleNewFolder}
                className="text-xs px-1.5 py-0.5 rounded hover:bg-editor-active text-gray-400 hover:text-white transition-colors"
                title="New Folder"
              >
                📁
              </button>
            </>
          )}
          <button
            onClick={openFolder}
            className="text-xs px-1.5 py-0.5 rounded hover:bg-editor-active text-gray-400 hover:text-white transition-colors"
            title="Open Folder"
          >
            📂
          </button>
        </div>
      </div>

      {/* File tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {rootPath ? (
          <FileTree nodes={fileTree} depth={0} />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <p className="text-sm text-gray-500 mb-3">No folder open</p>
            <button
              onClick={openFolder}
              className="text-xs px-3 py-1.5 bg-editor-accent text-white rounded hover:opacity-90 transition-opacity"
            >
              Open Folder
            </button>
          </div>
        )}
      </div>
    </div>
  );
}