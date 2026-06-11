import React, { useEffect, useRef, useState } from 'react';
import { useWorkspace } from '../../context/WorkspaceContext';
import { useEditor } from '../../context/EditorContext';
import FileTree from './FileTree';
import GitPanel from './GitPanel';
import ProblemsPanel from './ProblemsPanel';
import GitHubPanel from './GitHubPanel';
import TaskRunsPanel from './TaskRunsPanel';
import {
  Files,
  FilePlus,
  GitBranch,
  GitPullRequest,
  FolderOpen,
  FolderPlus,
  ListChecks,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

type SidebarTab = 'explorer' | 'git' | 'github' | 'problems' | 'tasks';
type PendingCreateKind = 'file' | 'folder';

function isSafeName(name: string): boolean {
  return !!name && !name.includes('/') && !name.includes('\\') && name !== '.' && name !== '..';
}

function WorkspaceRequiredState() {
  return (
    <div className="border-b border-editor-border px-3 py-2 text-xs text-muted-foreground">
      未打开文件夹
    </div>
  );
}

export default function Sidebar() {
  const { rootPath, rootName, fileTree, openFolder, refreshTree } = useWorkspace();
  const { openFile } = useEditor();
  const [activeTab, setActiveTab] = useState<SidebarTab>('explorer');
  const [pendingCreate, setPendingCreate] = useState<PendingCreateKind | null>(null);
  const [pendingCreateName, setPendingCreateName] = useState('');
  const [createError, setCreateError] = useState('');
  const createInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (pendingCreate) createInputRef.current?.focus();
  }, [pendingCreate]);

  const startCreate = (kind: PendingCreateKind) => {
    if (!rootPath) return;
    setPendingCreate(kind);
    setPendingCreateName('');
    setCreateError('');
  };

  const cancelCreate = () => {
    setPendingCreate(null);
    setPendingCreateName('');
    setCreateError('');
  };

  const submitCreate = async () => {
    if (!rootPath || !pendingCreate) return;
    const name = pendingCreateName.trim();
    if (!isSafeName(name)) {
      setCreateError('名称不能包含路径分隔符或 ..');
      return;
    }

    const targetPath = rootPath + '/' + name;
    try {
      if (pendingCreate === 'file') {
        await window.api.fs.createFile(targetPath);
      } else {
        await window.api.fs.createDirectory(targetPath);
      }
      await refreshTree();
      if (pendingCreate === 'file') openFile(targetPath);
      cancelCreate();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setCreateError(message || '创建失败');
    }
  };

  const tabs: { id: SidebarTab; label: string; Icon: LucideIcon }[] = [
    { id: 'explorer', label: '资源管理器', Icon: Files },
    { id: 'git', label: '源代码管理', Icon: GitBranch },
    { id: 'github', label: 'GitHub', Icon: GitPullRequest },
    { id: 'problems', label: '问题', Icon: ListChecks },
    { id: 'tasks', label: '任务', Icon: Workflow },
  ];
  const activeLabel = tabs.find((t) => t.id === activeTab)?.label || '侧边栏';

  return (
    <div className="h-full flex bg-editor-bg">
      <div className="w-11 flex-shrink-0 border-r border-editor-border bg-editor-sidebar">
        <div className="py-1">
          {tabs.map(({ Icon, ...tab }) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`relative flex h-10 w-full items-center justify-center transition-colors ${
                activeTab === tab.id
                  ? 'text-foreground bg-editor-active'
                  : 'text-muted-foreground hover:text-foreground hover:bg-editor-hover'
              }`}
              title={tab.label}
            >
              {activeTab === tab.id && (
                <span className="absolute left-0 top-1 bottom-1 w-[2px] bg-editor-accent" />
              )}
              <Icon size={19} strokeWidth={1.7} />
            </button>
          ))}
        </div>
      </div>

      <div className="min-w-0 flex-1 flex flex-col bg-editor-sidebar">
        <div className="px-3 py-2 border-b border-editor-border">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-11 font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">
                {activeLabel}
              </div>
              {rootName && activeTab === 'explorer' && (
                <div className="mt-0.5 truncate text-11 text-muted-foreground">{rootName}</div>
              )}
            </div>
            <div className="flex items-center gap-0.5">
              {activeTab === 'explorer' && rootPath && (
                <>
                  <button
                    onClick={() => startCreate('file')}
                    className="flex h-6 w-6 items-center justify-center text-muted-foreground transition-colors duration-75 hover:bg-editor-active hover:text-foreground"
                    title="新建文件"
                    aria-label="新建文件"
                  >
                    <FilePlus size={14} strokeWidth={1.8} />
                  </button>
                  <button
                    onClick={() => startCreate('folder')}
                    className="flex h-6 w-6 items-center justify-center text-muted-foreground transition-colors duration-75 hover:bg-editor-active hover:text-foreground"
                    title="新建文件夹"
                    aria-label="新建文件夹"
                  >
                    <FolderPlus size={14} strokeWidth={1.8} />
                  </button>
                </>
              )}
              {activeTab === 'explorer' && (
                <button
                  onClick={openFolder}
                  className="flex h-6 w-6 items-center justify-center text-muted-foreground transition-colors duration-75 hover:bg-editor-active hover:text-foreground"
                  title="打开文件夹"
                  aria-label="打开文件夹"
                >
                  <FolderOpen size={14} strokeWidth={1.8} />
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {activeTab === 'explorer' && (
            rootPath ? (
              <div className="py-1">
                {pendingCreate && (
                  <div className="flex h-7 items-center gap-2 px-3 text-xs text-editor-text">
                    {pendingCreate === 'file' ? (
                      <FilePlus size={13} strokeWidth={1.8} className="flex-shrink-0 text-muted-foreground" />
                    ) : (
                      <FolderPlus size={13} strokeWidth={1.8} className="flex-shrink-0 text-muted-foreground" />
                    )}
                    <input
                      ref={createInputRef}
                      value={pendingCreateName}
                      onChange={(e) => {
                        setPendingCreateName(e.target.value);
                        setCreateError('');
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void submitCreate();
                        } else if (e.key === 'Escape') {
                          cancelCreate();
                        }
                      }}
                      onBlur={() => {
                        if (!pendingCreateName.trim()) cancelCreate();
                      }}
                      placeholder={pendingCreate === 'file' ? '文件名' : '文件夹名'}
                      spellCheck={false}
                      className="min-w-0 flex-1 border border-editor-accent bg-editor-bg px-1 py-0.5 font-mono text-11 text-editor-text outline-none"
                    />
                  </div>
                )}
                {createError && (
                  <div className="border-b border-editor-border px-3 py-1.5 text-xs text-red-400">
                    {createError}
                  </div>
                )}
                <FileTree nodes={fileTree} depth={0} />
              </div>
            ) : (
              <div className="text-left">
                <div className="border-b border-editor-border px-3 py-2 text-xs text-muted-foreground">
                  未打开文件夹
                </div>
                <button
                  onClick={openFolder}
                  className="flex h-8 w-full items-center gap-2 border-b border-editor-border px-3 text-left text-xs text-editor-text hover:bg-editor-hover"
                >
                  <FolderOpen size={14} strokeWidth={1.8} />
                  打开文件夹
                </button>
              </div>
            )
          )}

          {activeTab === 'git' && (
            rootPath ? <GitPanel /> : (
              <WorkspaceRequiredState />
            )
          )}

          {activeTab === 'github' && (
            rootPath ? <GitHubPanel /> : (
              <WorkspaceRequiredState />
            )
          )}

          {activeTab === 'problems' && (
            rootPath ? <ProblemsPanel /> : (
              <WorkspaceRequiredState />
            )
          )}

          {activeTab === 'tasks' && (
            rootPath ? <TaskRunsPanel /> : (
              <WorkspaceRequiredState />
            )
          )}
        </div>
      </div>
    </div>
  );
}
