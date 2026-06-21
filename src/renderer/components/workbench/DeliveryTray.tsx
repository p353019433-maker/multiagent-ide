import React, { useState } from 'react';
import { FileText } from 'lucide-react';
import { ArtifactList, CheckpointList } from '../task/TaskPanelSections';
import type { Artifact, Checkpoint, TaskToolExecution } from '@shared/types';

interface Props {
  toolExecutions: TaskToolExecution[];
  checkpoints: Checkpoint[];
  artifacts: Artifact[];
  onRevert: (cp: Checkpoint) => Promise<{ reverted: number; failed: number }>;
  onOpen: (path: string) => void;
}

type Tab = 'delivery' | 'verify' | 'checkpoint';

const WRITE_TOOLS = new Set(['write_file', 'replace_in_file', 'search_and_replace', 'create_file', 'apply_patch']);
const TOOL_TAG: Record<string, string> = {
  write_file: '写',
  create_file: '新',
  replace_in_file: '改',
  search_and_replace: '改',
  apply_patch: '改',
};

/** Changed files from this turn's write-type tool executions (dedup, last wins). */
function changedFiles(execs: TaskToolExecution[]): { file: string; tool: string }[] {
  const seen = new Map<string, string>();
  for (const e of execs) {
    if (!WRITE_TOOLS.has(e.name)) continue;
    const a = e.arguments as Record<string, unknown>;
    const f = (a.path || a.file || a.filePath || a.file_path) as string | undefined;
    if (f) seen.set(f, e.name);
  }
  return [...seen.entries()].map(([file, tool]) => ({ file, tool }));
}

/**
 * Chat-mode right tray (340): 本轮交付 / 验证记录 / 检查点. Reads the live task
 * engine state (changed files, verification artifacts, checkpoints).
 */
export default function DeliveryTray({ toolExecutions, checkpoints, artifacts, onRevert, onOpen }: Props) {
  const [tab, setTab] = useState<Tab>('delivery');
  const changed = changedFiles(toolExecutions);

  const TabBtn = ({ id, label, n }: { id: Tab; label: string; n?: number }) => (
    <button
      onClick={() => setTab(id)}
      className={`relative px-1 pb-2 text-xs font-medium transition-colors ${
        tab === id ? 'text-foreground' : 'text-foreground/45 hover:text-foreground/70'
      }`}
    >
      {label}
      {typeof n === 'number' && n > 0 && <span className="ml-1 font-mono text-10 text-foreground/40">{n}</span>}
      {tab === id && <span className="absolute -bottom-px left-0 right-0 h-0.5 rounded-full bg-foreground" />}
    </button>
  );

  return (
    <div className="flex h-full flex-col" style={{ background: 'var(--app-bg)' }}>
      <div className="flex flex-none items-center gap-4 border-b border-border px-4 pt-3">
        <TabBtn id="delivery" label="本轮交付" />
        <TabBtn id="verify" label="验证" n={artifacts.length} />
        <TabBtn id="checkpoint" label="检查点" n={checkpoints.length} />
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === 'delivery' && (
          <div className="p-3.5">
            {changed.length === 0 ? (
              <p className="px-1 text-11 leading-relaxed text-foreground/45">本轮还没有文件改动。Agent 写文件后，改动会在这里列出。</p>
            ) : (
              <div className="overflow-hidden rounded-[12px] border border-border bg-background shadow-card">
                <div className="flex items-center justify-between border-b border-border/60 px-3.5 py-2.5">
                  <span className="text-xs font-semibold text-foreground">改动文件</span>
                  <span className="font-mono text-10 text-foreground/45">{changed.length} 个</span>
                </div>
                {changed.map(({ file, tool }) => (
                  <button
                    key={file}
                    onClick={() => onOpen(file)}
                    className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left transition-colors hover:bg-foreground/[0.03]"
                  >
                    <span className="h-1.5 w-1.5 flex-none rounded-sm" style={{ background: tool === 'create_file' ? '#2f8a4e' : '#c08a14' }} />
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-foreground/90" title={file}>
                      {file.split('/').slice(-1)[0]}
                    </span>
                    <span className="flex-none whitespace-nowrap font-mono text-10 text-foreground/45">{TOOL_TAG[tool] || '改'}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'verify' &&
          (artifacts.length === 0 ? (
            <p className="p-4 text-11 leading-relaxed text-foreground/45">还没有验证记录。每轮改完会自动跑 ESLint/tsc 并生成交付报告。</p>
          ) : (
            <ArtifactList artifacts={artifacts} onOpen={onOpen} />
          ))}

        {tab === 'checkpoint' &&
          (checkpoints.length === 0 ? (
            <p className="p-4 text-11 leading-relaxed text-foreground/45">还没有检查点。每轮 Agent 改动前会自动快照，可在此一键回滚。</p>
          ) : (
            <CheckpointList checkpoints={checkpoints} onRevert={onRevert} />
          ))}
      </div>

      <div className="flex flex-none items-center gap-1.5 border-t border-border px-4 py-2.5 text-10 text-foreground/40">
        <FileText size={11} strokeWidth={1.7} />
        改完即查、查到即修；改动前自动建检查点。
      </div>
    </div>
  );
}
