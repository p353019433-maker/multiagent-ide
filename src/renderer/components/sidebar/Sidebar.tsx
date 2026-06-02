import React, { useState } from 'react';
import { useWorkspace } from '../../context/WorkspaceContext';
import { useEditor } from '../../context/EditorContext';
import FileTree from './FileTree';
import GitPanel from './GitPanel';
import ProblemsPanel from './ProblemsPanel';
import GitHubPanel from './GitHubPanel';
import MultiAgentPanel from './MultiAgentPanel';

type SidebarTab = 'explorer' | 'git' | 'github' | 'problems' | 'multiagent';

function isSafeName(name: string): boolean {
  return !!name && !name.includes('/') && !name.includes('\\') && name !== '.' && name !== '..';
}

export default function Sidebar() {
  const { rootPath, rootName, fileTree, openFolder, refreshTree } = useWorkspace();
  const { openFile } = useEditor();
  const [activeTab, setActiveTab] = useState<SidebarTab>('explorer');

  const handleNewFile = async () => {
    if (!rootPath) return;
    const name = prompt('文件名：');
    if (!name || !isSafeName(name)) {
      alert('文件名不能包含路径分隔符或 ..');
      return;
    }
    const filePath = rootPath + '/' + name;
    try {
      await window.api.fs.createFile(filePath);
      await refreshTree();
      openFile(filePath);
    } catch {
      // silently fail
    }
  };

  const handleNewFolder = async () => {
    if (!rootPath) return;
    const name = prompt('文件夹名：');
    if (!name || !isSafeName(name)) {
      alert('文件夹名不能包含路径分隔符或 ..');
      return;
    }
    const dirPath = rootPath + '/' + name;
    try {
      await window.api.fs.createDirectory(dirPath);
      await refreshTree();
    } catch {
      // silently fail
    }
  };

  const tabs: { id: SidebarTab; label: string; icon: string }[] = [
    { id: 'explorer', label: '资源管理器', icon: '📁' },
    { id: 'git', label: 'Git', icon: '⑂' },
    { id: 'github', label: 'GitHub', icon: '🐙' },
    { id: 'problems', label: '问题', icon: '⚠' },
    { id: 'multiagent', label: '多 Agent', icon: '🎯' },
  ];

  return (
    <div className="h-full flex flex-col bg-editor-sidebar">
      {/* Header with tab switcher */}
      <div className="px-3 pt-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
            {tabs.find((t) => t.id === activeTab)?.label || '侧边栏'}
          </span>
          <div className="flex items-center gap-0.5">
            {activeTab === 'explorer' && rootPath && (
              <>
                <button
                  onClick={handleNewFile}
                  className="text-xs px-1.5 py-0.5 rounded hover:bg-editor-active text-gray-400 hover:text-white transition-colors duration-75"
                  title="新建文件"
                >
                  📄
                </button>
                <button
                  onClick={handleNewFolder}
                  className="text-xs px-1.5 py-0.5 rounded hover:bg-editor-active text-gray-400 hover:text-white transition-colors duration-75"
                  title="新建文件夹"
                >
                  📁
                </button>
              </>
            )}
            {activeTab === 'explorer' && (
              <button
                onClick={openFolder}
                className="text-xs px-1.5 py-0.5 rounded hover:bg-editor-active text-gray-400 hover:text-white transition-colors duration-75"
                title="打开文件夹"
              >
                📂
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-editor-border mt-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1.5 text-[11px] transition-colors border-b-2 ${
              activeTab === tab.id
                ? 'text-white border-editor-accent'
                : 'text-gray-500 border-transparent hover:text-gray-300'
            }`}
            title={tab.label}
          >
            {tab.icon}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'explorer' && (
          rootPath ? (
            <div className="py-1">
              <FileTree nodes={fileTree} depth={0} />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center px-4">
              <p className="text-sm text-gray-500 mb-3">未打开文件夹</p>
              <button
                onClick={openFolder}
                className="text-xs px-3 py-1.5 bg-editor-accent text-white rounded-xl hover:opacity-90"
              >
                打开文件夹
              </button>
            </div>
          )
        )}

        {activeTab === 'git' && (
          rootPath ? <GitPanel /> : (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-gray-500">需要先打开项目文件夹</p>
            </div>
          )
        )}

        {activeTab === 'github' && (
          rootPath ? <GitHubPanel /> : (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-gray-500">需要先打开项目文件夹</p>
            </div>
          )
        )}

        {activeTab === 'problems' && (
          rootPath ? <ProblemsPanel /> : (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-gray-500">需要先打开项目文件夹</p>
            </div>
          )
        )}

        {activeTab === 'multiagent' && (
          rootPath ? <MultiAgentPanel /> : (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-gray-500">需要先打开项目文件夹</p>
            </div>
          )
        )}
      </div>
    </div>
  );
}