import { Boxes, Hexagon, Code2, Star, type LucideIcon } from 'lucide-react';
import type { AgentKind } from '@shared/types';

/**
 * Per-kind visual theme for the round-table roster / discussion / impl cards.
 * Short badges (CC/CX/API/agy) + type-tinted icon chip, matching the Codex
 * workbench design. Colors are inline hex (design终值), not theme tokens.
 */
export interface AgentVisual {
  badge: string;
  badgeColor: string;
  badgeBg: string;
  iconColor: string;
  iconBg: string;
  Icon: LucideIcon;
}

const MAP: Record<AgentKind, AgentVisual> = {
  'claude-code': { badge: 'CC', badgeColor: '#9a5a2a', badgeBg: '#f6ece1', iconColor: '#c2632a', iconBg: '#f3ede2', Icon: Hexagon },
  codex: { badge: 'CX', badgeColor: '#4a4d54', badgeBg: '#eceef0', iconColor: '#3a3d44', iconBg: '#e8e9eb', Icon: Code2 },
  api: { badge: 'API', badgeColor: '#2563c9', badgeBg: '#e3edf6', iconColor: '#2563c9', iconBg: '#e3edf6', Icon: Boxes },
  antigravity: { badge: 'agy', badgeColor: '#6a4fc0', badgeBg: '#e8e6f3', iconColor: '#6a4fc0', iconBg: '#e8e6f3', Icon: Star },
};

export function agentVisual(kind: AgentKind): AgentVisual {
  return MAP[kind] ?? MAP.api;
}
