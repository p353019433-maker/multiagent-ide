import React, { useEffect, useState } from 'react';
import { GitBranch, Circle, Folder, FileText } from 'lucide-react';
import { useWorkspace } from '../../context/WorkspaceContext';
import { useEditor } from '../../context/EditorContext';

export default function StatusBar() {
  const { rootPath, rootName } = useWorkspace();
  const { openFiles, activeFilePath } = useEditor();
  const [branch, setBranch] = useState('');
  const activeFile = openFiles.find((file) => file.path === activeFilePath);

  useEffect(() => {
    let cancelled = false;
    if (!rootPath) {
      setBranch('');
      return;
    }

    window.api.git
      .currentBranch(rootPath)
      .then((current) => {
        if (!cancelled) setBranch(current || '');
      })
      .catch(() => {
        if (!cancelled) setBranch('');
      });

    return () => {
      cancelled = true;
    };
  }, [rootPath]);

  return (
    <div className="flex h-6 flex-shrink-0 items-center justify-between border-t border-editor-border bg-editor-sidebar px-2 text-[11px] text-gray-500">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex min-w-0 items-center gap-1.5" title={rootPath || '未打开文件夹'}>
          <Folder size={13} strokeWidth={1.8} />
          <span className="truncate">{rootName || '未打开文件夹'}</span>
        </div>
        {branch && (
          <div className="flex min-w-0 items-center gap-1.5" title={`Git branch: ${branch}`}>
            <GitBranch size={13} strokeWidth={1.8} />
            <span className="max-w-[180px] truncate font-mono">{branch}</span>
          </div>
        )}
      </div>

      <div className="flex min-w-0 items-center gap-3">
        {activeFile ? (
          <>
            <div className="hidden min-w-0 items-center gap-1.5 sm:flex" title={activeFile.path}>
              <FileText size={13} strokeWidth={1.8} />
              <span className="max-w-[220px] truncate">{activeFile.path.split('/').pop()}</span>
              {activeFile.isDirty && <Circle size={7} fill="currentColor" strokeWidth={0} />}
            </div>
            <span className="hidden font-mono sm:inline">{activeFile.language}</span>
          </>
        ) : (
          <span className="hidden sm:inline">就绪</span>
        )}
        <span className="font-mono">UTF-8</span>
      </div>
    </div>
  );
}
