import React from 'react';
import { Plus } from 'lucide-react';
import { useTaskWorkspace } from '../../context/TaskContext';
import { agentVisual } from './agentTheme';
import type { Agent } from '@shared/types';

/** Backend subline, e.g. "Claude Code · opus-4.6" / "Codex CLI · 外壳" / "Google 登录 · 单例". */
function subline(a: Agent): string {
  if (a.kind === 'antigravity') return 'Google 登录 · 单例';
  if (a.kind === 'api') return a.model || 'API 后端';
  const label = agentVisual(a.kind).label;
  return `${label} · ${a.model || '外壳'}`;
}

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      className="relative flex-none rounded-full transition-colors"
      style={{ width: 30, height: 17, background: on ? 'var(--status-green)' : 'rgba(13,13,13,.18)' }}
    >
      <span
        className="absolute rounded-full bg-white transition-all"
        style={{ top: 2, left: on ? 15 : 2, width: 13, height: 13, boxShadow: '0 1px 2px rgba(0,0,0,.25)' }}
      />
    </button>
  );
}

/**
 * Round-mode agent roster (left column): enabled toggles + type badges
 * (CC/CX/API/agy) + Antigravity singleton note + add-agent entry.
 */
export default function AgentRoster({ onAddAgent }: { onAddAgent: () => void }) {
  const { agents, toggleAgent } = useTaskWorkspace();
  const enabledCount = agents.filter((a) => a.enabled).length;

  return (
    <div>
      <div className="flex items-center px-1 pb-1.5 pt-2">
        <span className="text-10 font-bold uppercase tracking-[0.06em] text-foreground/40">智能体</span>
        <span className="ml-auto font-mono text-10 tabular-nums text-foreground/45">{enabledCount}/{agents.length || 4} 启用</span>
      </div>

      <div className="overflow-hidden rounded-[11px] border border-border bg-background shadow-card">
        {agents.length === 0 && (
          <p className="px-3 py-3 text-11 leading-relaxed text-foreground/45">
            还没有智能体。点下方「添加智能体」，或去设置配置 Claude Code / Codex / API。
          </p>
        )}
        {agents.map((a, i) => {
          const v = agentVisual(a.kind);
          return (
            <div
              key={a.id}
              className={`flex items-center gap-[9px] px-3 py-2.5 ${i < agents.length - 1 ? 'border-b border-border/60' : ''}`}
            >
              <span
                className="flex h-6 w-6 flex-none items-center justify-center rounded-[7px]"
                style={{ background: v.iconBg }}
              >
                <v.Icon size={13} strokeWidth={1.8} style={{ color: v.iconColor }} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="text-[12.5px] font-semibold text-foreground">{a.name}</span>
                  <span
                    className="rounded font-mono text-[9px] font-semibold"
                    style={{ color: v.badgeColor, background: v.badgeBg, padding: '1px 5px' }}
                  >
                    {v.badge}
                  </span>
                </span>
                <span className="mt-0.5 block truncate text-[10.5px] text-foreground/45">{subline(a)}</span>
              </span>
              <Toggle on={a.enabled} onClick={() => toggleAgent(a.id, !a.enabled)} label={`切换 ${a.name}`} />
            </div>
          );
        })}
      </div>

      {agents.some((a) => a.kind === 'antigravity') && (
        <div className="px-1 pt-[7px] text-10 leading-[1.5] text-foreground/40">
          Antigravity 共享本机 Google 登录，多开会互相影响，只允许一个。
        </div>
      )}

      <button
        onClick={onAddAgent}
        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-[9px] border border-dashed border-foreground/20 py-2 text-xs font-medium text-foreground/50 transition-colors hover:bg-foreground/[0.03] hover:text-foreground"
      >
        <Plus size={13} strokeWidth={2} />
        添加智能体
      </button>
    </div>
  );
}
