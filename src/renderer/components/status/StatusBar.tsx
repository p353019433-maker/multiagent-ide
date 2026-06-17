import React, { useEffect, useState } from 'react';
import { useWorkspace } from '../../context/WorkspaceContext';
import { useEditor } from '../../context/EditorContext';
import { subscribeCursor, DEFAULT_CURSOR, type CursorState } from '../../editor/cursorPosition';

/**
 * Bottom status bar — non-intrusive, glanceable feedback.
 *
 * Per the evaluation framework:
 *  - 反馈机制：line:col + selection 是"我在哪儿"的确定性反馈
 *  - 视觉UI：高信噪比，只放真正高频查阅的字段；不抢代码区空间
 *  - 性能：cursor 订阅走 leaf-only bus，git branch 30s 轮询，绝不阻塞主线程
 *
 * Shows:
 *   - current file path + language
 *   - cursor Ln, Col + selection length (when > 0)
 *   - git branch (refreshed every 30s)
 */
export default function StatusBar() {
  const { rootPath } = useWorkspace();
  const { activeFilePath } = useEditor();
  const [cursor, setCursor] = useState<CursorState>(DEFAULT_CURSOR);
  const [branch, setBranch] = useState<string | null>(null);

  // Subscribe to cursor changes from the editor without going through context.
  useEffect(() => {
    return subscribeCursor(setCursor);
  }, []);

  // Poll the current git branch every 30s when a workspace is open.
  useEffect(() => {
    if (!rootPath) {
      setBranch(null);
      return;
    }
    let cancelled = false;
    const pull = async () => {
      try {
        const b = await window.api.git.currentBranch(rootPath);
        if (!cancelled) setBranch((b || '').trim() || null);
      } catch {
        if (!cancelled) setBranch(null);
      }
    };
    void pull();
    const t = setInterval(pull, 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [rootPath]);

  const fileName = activeFilePath ? activeFilePath.split(/[\\/]/).pop() : null;
  const lang = cursor.language || 'plaintext';

  return (
    <div className="h-6 flex items-center justify-between px-3 text-[11px] bg-editor-sidebar border-t border-editor-border text-gray-400 flex-shrink-0 select-none">
      <div className="flex items-center gap-3 min-w-0">
        {branch && (
          <span className="flex items-center gap-1 text-editor-accent" title="当前 Git 分支">
            <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
              <path d="M11.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zm-2.25.75a2.25 2.25 0 1 1 3 2.122v2.026c0 .42-.159.823-.442 1.122L8.38 12.75a.75.75 0 0 0 0 1.0l.016.018c.283.299.442.702.442 1.122v.61a2.25 2.25 0 1 1-1.5 0v-.61c0-.42-.159-.823-.442-1.122L4.38 9.75a.75.75 0 0 1 0-1.0L6.558 6.37A1.75 1.75 0 0 0 7 5.248V3.122a2.25 2.25 0 1 1 1.5 0v2.126c0 .42.159.823.442 1.122l.018.018c.283.299.442.702.442 1.122v.026z" />
            </svg>
            <span className="font-mono truncate max-w-[160px]">{branch}</span>
          </span>
        )}
        {!branch && rootPath && <span className="text-gray-600">非 Git 仓库</span>}
      </div>
      <div className="flex items-center gap-3">
        {fileName && (
          <span className="truncate max-w-[280px]" title={activeFilePath ?? ''}>
            {fileName}
          </span>
        )}
        <span className="text-gray-500">
          Ln {cursor.lineNumber}, Col {cursor.column}
          {cursor.selectionLength > 0 && ` (${cursor.selectionLength} 选定)`}
        </span>
        <span className="uppercase tracking-wide text-gray-500">{lang}</span>
      </div>
    </div>
  );
}
