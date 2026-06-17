/**
 * Default command set + keymap installer.
 *
 * Wire every user-invokable action the IDE exposes as a `Command` here so
 * it can be reached from the Command Palette (Cmd+Shift+P) and from any
 * registered chord. Adding a new panel toggle / view action should mean:
 *   1. add an entry to this list
 *   2. (if it has UI side-effects) listen for the dispatched event in
 *      MainLayout — see the `panel:toggle-*` event names below.
 *
 * The actions intentionally just emit DOM CustomEvents; this keeps the
 * commands tree-shakeable, free of context-import cycles, and easy to
 * test (no React, no hooks).
 */

import { cmd, setCommands, togglePalette, openPalette } from './registry';
import { installKeymap } from './keymap';
import type { Command } from './types';

function emit(type: string): () => void {
  return () => {
    window.dispatchEvent(new CustomEvent(type));
  };
}

/**
 * Build the canonical command list. Exposed separately so it can be
 * unit-tested or composed with feature-specific commands later.
 */
export function buildDefaultCommands(): Command[] {
  return [
    // ── View: panel toggles ────────────────────────────────────────
    cmd('view.toggleSidebar', '切换侧边栏', emit('panel:toggle-sidebar'), {
      category: '视图',
      shortcut: 'Cmd+B',
      keywords: ['sidebar', 'tree', 'explorer', '侧边栏', '文件树'],
    }),
    cmd('view.toggleChat', '切换 AI 聊天面板', emit('panel:toggle-chat'), {
      category: '视图',
      shortcut: 'Cmd+J',
      keywords: ['chat', 'agent', 'ai', '聊天', '助手'],
    }),
    cmd('view.toggleTerminal', '切换终端', emit('panel:toggle-terminal'), {
      category: '视图',
      shortcut: 'Cmd+`',
      keywords: ['terminal', 'shell', '终端'],
    }),
    cmd('view.toggleSearch', '切换搜索', emit('panel:toggle-search'), {
      category: '视图',
      shortcut: 'Cmd+Shift+F',
      keywords: ['search', 'find', '搜索', '查找'],
    }),
    cmd('view.toggleBrowser', '切换浏览器预览', emit('panel:toggle-browser'), {
      category: '视图',
      keywords: ['browser', 'preview', '浏览器', '预览'],
    }),

    // ── Command Palette itself ─────────────────────────────────────
    cmd('palette.open', '打开命令面板', () => togglePalette(), {
      category: '命令面板',
      shortcut: 'Cmd+Shift+P',
      keywords: ['palette', 'command', 'cmd', '命令面板', '搜索命令'],
    }),
    cmd('palette.openPrefixed', '打开命令面板（带 > 前缀）', () => openPalette('>'), {
      category: '命令面板',
      keywords: ['palette', 'prefix', '命令面板'],
    }),

    // ── Settings ───────────────────────────────────────────────────
    cmd('settings.open', '打开设置', emit('settings:open'), {
      category: '设置',
      shortcut: 'Cmd+,',
      keywords: ['settings', 'preferences', 'config', '设置', '偏好', '配置'],
    }),
  ];
}

/**
 * Install the default command set and attach the global keymap.
 * Returns a teardown that uninstalls both. Call once from the app root.
 */
export function installDefaultCommands(): () => void {
  setCommands(buildDefaultCommands());
  return installKeymap();
}
