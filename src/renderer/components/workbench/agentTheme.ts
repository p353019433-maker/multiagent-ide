import { Boxes, Hexagon, Code2, Star, Terminal, type LucideIcon } from 'lucide-react';
import type { AgentKind } from '@shared/types';

/**
 * Per-kind visual theme for the round-table roster / discussion / impl cards.
 * Short badges (CC/CX/API/agy/OC) + type-tinted icon chip, matching the Codex
 * workbench design. Colors are inline hex (design终值), not theme tokens.
 */
export interface AgentVisual {
  badge: string;
  label: string;
  badgeColor: string;
  badgeBg: string;
  iconColor: string;
  iconBg: string;
  Icon: LucideIcon;
}

const MAP: Record<AgentKind, AgentVisual> = {
  'claude-code': { badge: 'CC', label: 'Claude Code', badgeColor: '#9a5a2a', badgeBg: '#f6ece1', iconColor: '#c2632a', iconBg: '#f3ede2', Icon: Hexagon },
  codex: { badge: 'CX', label: 'Codex CLI', badgeColor: '#4a4d54', badgeBg: '#eceef0', iconColor: '#3a3d44', iconBg: '#e8e9eb', Icon: Code2 },
  api: { badge: 'API', label: 'API', badgeColor: '#2563c9', badgeBg: '#e3edf6', iconColor: '#2563c9', iconBg: '#e3edf6', Icon: Boxes },
  antigravity: { badge: 'agy', label: 'Antigravity', badgeColor: '#6a4fc0', badgeBg: '#e8e6f3', iconColor: '#6a4fc0', iconBg: '#e8e6f3', Icon: Star },
  opencode: { badge: 'OC', label: 'OpenCode', badgeColor: '#0e7c66', badgeBg: '#dff1ec', iconColor: '#0e9488', iconBg: '#dff1ec', Icon: Terminal },
};

export function agentVisual(kind: AgentKind): AgentVisual {
  return MAP[kind] ?? MAP.api;
}
