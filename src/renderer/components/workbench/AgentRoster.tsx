import React from 'react';
import { AlertTriangle, ExternalLink, Plus } from 'lucide-react';
import { useTaskWorkspace } from '../../context/TaskContext';
import { useWorkspace } from '../../context/WorkspaceContext';
import { agentVisual } from './agentTheme';
import type { Agent } from '@shared/types';

/** Backend subline, e.g. "Claude Code · opus-4.6" / "Codex CLI · 外壳" / "Google 登录 · 单例". */
function subline(a: Agent): string {
  if (a.kind === 'antigravity') return 'Google 登录 · 单例';
  if (a.kind === 'api') return a.model || 'API 后端';
  const label = agentVisual(a.kind).label;
  return `${label} · ${a.model || '外壳'}`;
}

export interface BlockedReason {
  short: string;
  long: string;
  /** When set, clicking the warning chip jumps to the agent settings tab. */
  actionable: boolean;
}

/**
 * Returns why an enabled agent can't actually participate in a round-table run,
 * or null if it's good to go. Two distinct concerns:
 *
 *  1. **Agent-level mis-config** — API agent without provider/model. We can
 *     detect this from the agent record alone; the fix is in Settings.
 *
 *  2. **Run-time prerequisite missing** — CLI shells need a workspace (rootPath).
 *     A user enabling a CLI agent before opening a folder gets a real "won't
 *     run" with no UI feedback otherwise, so surface it here. Caller passes
 *     `hasWorkspace` because the agent record alone can't know.
 *
 * Both are exported (the helper used to flag only #1) so this is a behavior
 * change: clicking enable on a CLI shell without an open project now shows
 * "需先打开项目" instead of looking like it worked.
 */
export function agentBlockedReason(a: Agent, hasWorkspace: boolean): BlockedReason | null {
  if (!a.enabled) return null;
  if (a.kind === 'api') {
    if (!a.providerId) return { short: '待配置', long: '未绑定 API 服务,去设置补上', actionable: true };
    if (!a.model) return { short: '待配置', long: '未指定模型,去设置补上', actionable: true };
    return null;
  }
  // CLI shells: need a workspace (cliAgent service requires cwd inside it).
  if (!hasWorkspace) {
    return { short: '需打开项目', long: 'CLI 智能体需要一个已打开的工作区才能运行', actionable: false };
  }
  // We can't verify the binary is installed from here without spawning it;
  // a missing `claude` / `codex` / `agy` surfaces as an error in the log on
  // the first round-table run.
  return null;
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
 *
 * Diagnostic surface: agents that are enabled but can't participate (API w/o
 * provider, CLI w/o workspace) get an inline orange "待配置" / "需打开项目"
 * chip with the reason in the subline. For API mis-config the chip is also a
 * shortcut to the settings page — one click to fix.
 *
 * If every enabled agent is blocked we render a banner above the list that
 * spells out what's needed before the round-table will produce anything; this
 * is the user-visible answer to "I clicked enable and nothing happened".
 */
export default function AgentRoster({ onAddAgent }: { onAddAgent: () => void }) {
  const { agents, toggleAgent } = useTaskWorkspace();
  const { rootPath } = useWorkspace();
  const hasWorkspace = !!rootPath;
  const enabledCount = agents.filter((a) => a.enabled).length;

  // How many enabled agents are *actually* runnable. If this is 0 but there are
  // enabled agents, that's the silent-fail case — show a banner.
  const runnableCount = agents.filter((a) => a.enabled && !agentBlockedReason(a, hasWorkspace)).length;
  const allBlocked = enabledCount > 0 && runnableCount === 0;

  return (
    <div>
      <div className="flex items-center px-1 pb-1.5 pt-2">
        <span className="text-10 font-bold uppercase tracking-[0.06em] text-foreground/40">智能体</span>
        <span className="ml-auto font-mono text-10 tabular-nums text-foreground/45">
          {runnableCount}/{enabledCount || agents.length || 0} 可参与
        </span>
      </div>

      {allBlocked && (
        <div
          className="mb-2 rounded-[9px] px-3 py-2 text-[11px] leading-[1.55]"
          style={{ color: '#9a4a00', background: '#fdeccd', border: '1px solid #f3d99c' }}
        >
          已启用 {enabledCount} 个智能体,但都不能参与圆桌。
          <br />
          {!hasWorkspace ? (
            <span>
              CLI 智能体需要先打开一个项目;API 智能体需要在设置里绑定供应商。
              <button
                onClick={onAddAgent}
                className="ml-1 inline-flex items-center gap-0.5 underline underline-offset-2"
              >
                去设置 <ExternalLink size={9} strokeWidth={2.2} />
              </button>
            </span>
          ) : (
            <span>
              在设置里为每个 API 智能体绑定供应商和模型。
              <button
                onClick={onAddAgent}
                className="ml-1 inline-flex items-center gap-0.5 underline underline-offset-2"
              >
                去设置 <ExternalLink size={9} strokeWidth={2.2} />
              </button>
            </span>
          )}
        </div>
      )}

      <div className="overflow-hidden rounded-[11px] border border-border bg-background shadow-card">
        {agents.length === 0 && (
          <p className="px-3 py-3 text-11 leading-relaxed text-foreground/45">
            还没有智能体。点下方「添加智能体」，或去设置配置 Claude Code / Codex / API。
          </p>
        )}
        {agents.map((a, i) => {
          const v = agentVisual(a.kind);
          const blocked = agentBlockedReason(a, hasWorkspace);
          // Pad each row uniformly. The chip is a clickable shortcut when the
          // reason is fixable from settings.
          const Chip = blocked ? (
            blocked.actionable ? (
              <button
                onClick={onAddAgent}
                title={`${blocked.long} · 点击去设置`}
                className="flex flex-none items-center gap-0.5 rounded font-mono text-[9px] font-semibold transition-colors hover:brightness-95"
                style={{ color: '#9a4a00', background: '#fdeccd', padding: '1px 5px' }}
              >
                <AlertTriangle size={9} strokeWidth={2} />
                {blocked.short}
              </button>
            ) : (
              <span
                title={blocked.long}
                className="flex flex-none items-center gap-0.5 rounded font-mono text-[9px] font-semibold"
                style={{ color: '#9a4a00', background: '#fdeccd', padding: '1px 5px' }}
              >
                <AlertTriangle size={9} strokeWidth={2} />
                {blocked.short}
              </span>
            )
          ) : null;
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
                  <span className="truncate text-[12.5px] font-semibold text-foreground">{a.name}</span>
                  <span
                    className="flex-none rounded font-mono text-[9px] font-semibold"
                    style={{ color: v.badgeColor, background: v.badgeBg, padding: '1px 5px' }}
                  >
                    {v.badge}
                  </span>
                  {Chip}
                </span>
                <span className="mt-0.5 block truncate text-[10.5px] text-foreground/45">
                  {blocked ? blocked.long : subline(a)}
                </span>
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
