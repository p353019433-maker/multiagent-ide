import React from 'react';
import { useWorkspace } from '../../context/WorkspaceContext';
import {
  ChevronRight,
  Monitor,
  PanelRight,
  Search,
  Settings as SettingsIcon,
  SquareTerminal,
} from 'lucide-react';

interface Props {
  onOpenSettings: () => void;
  onToggleTaskPanel: () => void;
  onToggleTerminal: () => void;
  onToggleSearch: () => void;
  onToggleBrowser: () => void;
  showTaskPanel: boolean;
  showTerminal: boolean;
  showSearch: boolean;
  showBrowser: boolean;
}

function titleButtonClass(active: boolean): string {
  return `flex h-8 w-8 items-center justify-center border-l border-editor-border border-b-2 transition-colors duration-75 ${
    active
      ? 'border-b-editor-accent bg-editor-bg text-foreground'
      : 'border-b-transparent text-muted-foreground hover:bg-editor-hover hover:text-foreground'
  }`;
}

export default function TitleBar({
  onOpenSettings,
  onToggleTaskPanel,
  onToggleTerminal,
  onToggleSearch,
  onToggleBrowser,
  showTaskPanel,
  showTerminal,
  showSearch,
  showBrowser,
}: Props) {
  const { rootName } = useWorkspace();

  return (
    <div className="grid h-8 grid-cols-[minmax(0,1fr)_minmax(150px,420px)_minmax(0,1fr)] items-center bg-editor-sidebar border-b border-editor-border drag-region">
      <div className="flex min-w-0 items-center gap-1.5 px-2 no-drag sm:px-3">
        <span className="text-xs font-medium text-editor-text">Code IDE</span>
        {rootName && (
          <>
            <ChevronRight size={13} strokeWidth={1.8} className="flex-shrink-0 text-muted-foreground" />
            <span className="truncate text-11 text-muted-foreground">{rootName}</span>
          </>
        )}
      </div>

      <button
        onClick={onToggleSearch}
        className={`no-drag hidden h-6 min-w-0 items-center gap-2 border px-2 text-11 transition-colors md:flex ${
          showSearch
            ? 'border-editor-accent bg-editor-bg text-foreground'
            : 'border-editor-border bg-editor-bg text-muted-foreground hover:bg-editor-hover hover:text-foreground'
        }`}
        title="搜索文件和命令 (Cmd+Shift+F)"
        aria-label="搜索文件和命令"
      >
        <Search size={14} strokeWidth={1.8} />
        <span className="truncate">{rootName ? `搜索 ${rootName}` : '搜索工作区'}</span>
        <span className="hidden flex-shrink-0 font-mono text-10 text-muted-foreground lg:inline">
          Cmd Shift F
        </span>
      </button>

      <div className="flex shrink-0 items-center justify-end no-drag justify-self-end">
        <button
          onClick={onToggleSearch}
          className={titleButtonClass(showSearch)}
          title="搜索 (Cmd+Shift+F)"
          aria-label="搜索"
        >
          <Search size={14} strokeWidth={1.8} />
        </button>
        <button
          onClick={onToggleTerminal}
          className={titleButtonClass(showTerminal)}
          title={showTerminal ? '收起终端' : '显示终端'}
          aria-label={showTerminal ? '收起终端' : '显示终端'}
        >
          <SquareTerminal size={14} strokeWidth={1.8} />
        </button>
        <button
          onClick={onToggleTaskPanel}
          className={titleButtonClass(showTaskPanel)}
          title={showTaskPanel ? '收起任务面板' : '显示任务面板'}
          aria-label={showTaskPanel ? '收起任务面板' : '显示任务面板'}
        >
          <PanelRight size={14} strokeWidth={1.8} />
        </button>
        <button
          onClick={onToggleBrowser}
          className={titleButtonClass(showBrowser)}
          title={showBrowser ? '收起浏览器' : '内置浏览器'}
          aria-label={showBrowser ? '收起浏览器' : '内置浏览器'}
        >
          <Monitor size={14} strokeWidth={1.8} />
        </button>
        <button
          onClick={onOpenSettings}
          className={titleButtonClass(false)}
          title="设置"
          aria-label="设置"
        >
          <SettingsIcon size={14} strokeWidth={1.8} />
        </button>
      </div>
    </div>
  );
}
