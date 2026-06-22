import React from 'react';
import { useWorkspace } from '../../context/WorkspaceContext';
import { Code2, Folder, Settings as SettingsIcon } from 'lucide-react';

interface Props {
  onOpenSettings: () => void;
  /** Open / switch the workspace folder. The project pill is the entry. */
  onOpenFolder: () => void;
  branch: string | null;
  statusText: string | null;
  running: boolean;
  editorOpen?: boolean;
  onToggleEditor?: () => void;
}

/**
 * Codex workbench title bar (46px). macOS draws the real traffic lights
 * (titleBarStyle: hiddenInset), so we leave the left inset and render the
 * project/branch pill, a pulsing run-status dot, settings and avatar.
 */
export default function TitleBar({ onOpenSettings, onOpenFolder, branch, statusText, running, editorOpen, onToggleEditor }: Props) {
  const { rootName } = useWorkspace();

  return (
    <header
      className="drag-region flex items-center justify-between border-b border-border px-4"
      style={{ height: 46, background: 'var(--app-bg)' }}
    >
      {/* left inset clears the macOS traffic lights */}
      <div className="flex items-center gap-3.5 pl-[68px]">
        <div className="h-4 w-px" style={{ background: 'rgba(13,13,13,.10)' }} />
        <button
          onClick={onOpenFolder}
          className="no-drag flex items-center gap-2 rounded-lg border border-border-strong bg-background px-2.5 py-[5px] shadow-[0_1px_2px_rgba(0,0,0,.04)] transition-colors hover:bg-[#fcfcfc]"
          title={rootName ? '切换文件夹' : '打开文件夹'}
          aria-label={rootName ? '切换文件夹' : '打开文件夹'}
        >
          <Folder size={14} strokeWidth={1.6} className="text-foreground/50" />
          <span className="text-[13px] font-semibold text-foreground">{rootName || '打开文件夹'}</span>
          {branch && (
            <span className="border-l border-border-strong pl-2 font-mono text-10 text-foreground/40">{branch}</span>
          )}
        </button>
      </div>

      <div className="no-drag flex items-center gap-2.5">
        {statusText && (
          <span className="flex items-center gap-1.5 text-xs font-medium text-foreground/60">
            <span
              className={`h-[7px] w-[7px] rounded-full ${running ? 'animate-pulse-dot' : ''}`}
              style={{ background: 'var(--status-green)' }}
            />
            {statusText}
          </span>
        )}
        {onToggleEditor && (
          <button
            onClick={onToggleEditor}
            title="代码编辑器 (⌘E)"
            aria-label="代码编辑器"
            aria-pressed={editorOpen}
            className={`flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-border-strong shadow-[0_1px_2px_rgba(0,0,0,.04)] transition-colors hover:bg-[#fcfcfc] ${
              editorOpen ? 'bg-secondary text-foreground' : 'bg-background text-foreground/50 hover:text-foreground'
            }`}
          >
            <Code2 size={15} strokeWidth={1.7} />
          </button>
        )}
        <button
          onClick={onOpenSettings}
          title="设置"
          aria-label="设置"
          className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-border-strong bg-background text-foreground/50 shadow-[0_1px_2px_rgba(0,0,0,.04)] transition-colors hover:bg-[#fcfcfc] hover:text-foreground"
        >
          <SettingsIcon size={15} strokeWidth={1.7} />
        </button>
        <span
          className="flex h-[29px] w-[29px] items-center justify-center rounded-full text-[11px] font-semibold text-white"
          style={{ background: '#0d0d0d' }}
        >
          AI
        </span>
      </div>
    </header>
  );
}
