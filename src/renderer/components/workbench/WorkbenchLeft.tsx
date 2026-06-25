import React from 'react';
import { GitBranch, Plus, TerminalSquare } from 'lucide-react';
import { useTaskWorkspace } from '../../context/TaskContext';
import SkillsList from './SkillsList';

interface Props {
  rootPath: string | null;
  indexStatus: string;
  onNewWorktree: () => void;
  onOpenTerminal: () => void;
}

/** Left column of the Agent-first workbench: workspace card + task history + skills. */
export default function WorkbenchLeft({ rootPath, indexStatus, onNewWorktree, onOpenTerminal }: Props) {
  const { conversations, activeConversationId, setActiveConversation, newConversation } = useTaskWorkspace();
  const projectName = rootPath ? rootPath.split('/').filter(Boolean).slice(-1)[0] : '未打开项目';

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ background: '#ececea' }}>
      <div className="flex-none px-3.5 pb-2 pt-3.5">
        <div className="rounded-[16px] border border-border bg-background p-3 shadow-ambient">
          <div className="text-10 font-bold uppercase tracking-[0.08em] text-foreground/35">Agent Workspace</div>
          <div className="mt-1 truncate text-[15px] font-semibold text-foreground" title={rootPath || undefined}>{projectName}</div>
          <div className="mt-1 truncate font-mono text-10 text-foreground/40">{indexStatus}</div>
        </div>
      </div>

      <div className="flex flex-none gap-2 px-3.5 pb-2.5 pt-0.5">
        <button
          onClick={() => newConversation()}
          className="flex flex-1 items-center justify-center gap-[7px] rounded-[10px] py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-[#262626]"
          style={{ background: '#0d0d0d' }}
        >
          <Plus size={15} strokeWidth={2} />
          新任务
        </button>
        <button
          onClick={onNewWorktree}
          title="在隔离 worktree 中开始"
          className="flex w-[38px] flex-none items-center justify-center rounded-[10px] border border-border-strong bg-background text-foreground/50 shadow-[0_1px_2px_rgba(0,0,0,.05)] transition-colors hover:bg-[#f6f6f4] hover:text-foreground"
        >
          <GitBranch size={15} strokeWidth={1.7} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-3.5">
        <div className="px-2 py-1.5 text-10 font-bold uppercase tracking-[0.06em] text-foreground/40">任务历史</div>
        {conversations.length === 0 && (
          <p className="px-2 py-1 text-11 text-foreground/45">还没有任务，点「新任务」开始。</p>
        )}
        {conversations.map((conv) => {
          const active = conv.id === activeConversationId;
          return (
            <div
              key={conv.id}
              onClick={() => setActiveConversation(conv.id)}
              className={`my-0.5 cursor-pointer rounded-[9px] px-[11px] py-[9px] ${
                active
                  ? 'border border-border-strong bg-background shadow-[0_1px_3px_rgba(0,0,0,.07)]'
                  : 'border border-transparent hover:bg-foreground/[0.05]'
              }`}
            >
              <span className="min-w-0 truncate text-[13px] font-medium text-foreground">{conv.title}</span>
            </div>
          );
        })}
      </div>

      <div className="min-h-0 flex-shrink-0 overflow-y-auto border-t border-border px-3 pb-3.5 pt-2">
        <SkillsList rootPath={rootPath} />
      </div>

      <div className="flex flex-none items-center gap-2 border-t border-border px-4 py-2.5">
        <button
          onClick={onOpenTerminal}
          className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11.5px] text-foreground/55 transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
          title="打开终端"
        >
          <TerminalSquare size={13} strokeWidth={1.7} />
          终端
        </button>
        <span className="ml-auto truncate font-mono text-[10.5px] text-foreground/40">{indexStatus}</span>
      </div>
    </div>
  );
}
