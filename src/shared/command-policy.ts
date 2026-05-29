/**
 * Command & approval policy shared between main and renderer.
 *
 * The approval model has three tiers, modeled after Codex's sandbox modes:
 *  - readonly: every write / command needs an explicit manual approval
 *  - auto:     reads run freely; workspace writes auto-accept after a short
 *              preview; shell commands run unless they match a danger pattern,
 *              in which case they require manual approval regardless of tier
 *  - full:     everything runs with no prompts (the original behavior)
 */

export type ApprovalMode = 'readonly' | 'auto' | 'full';

export const DEFAULT_APPROVAL_MODE: ApprovalMode = 'auto';

export const APPROVAL_MODE_META: Record<
  ApprovalMode,
  { icon: string; label: string; hint: string }
> = {
  readonly: {
    icon: '🔒',
    label: '只读',
    hint: '所有写入与命令都需手动批准',
  },
  auto: {
    icon: '⚖️',
    label: '自动',
    hint: '读放行，写入预览后自动接受，危险命令拦截',
  },
  full: {
    icon: '⚡',
    label: '完全',
    hint: '全部自动执行，无拦截（有风险）',
  },
};

/**
 * Patterns for shell commands considered destructive / high-risk. A match
 * forces a manual approval even in `auto` mode. Kept deliberately broad — false
 * positives just mean an extra confirmation, false negatives mean silent harm.
 */
const DANGEROUS_COMMAND_PATTERNS: { re: RegExp; reason: string }[] = [
  { re: /\brm\s+(-[a-z]*r[a-z]*|--recursive)\b/i, reason: '递归删除文件 (rm -r)' },
  { re: /\brm\s+(-[a-z]*f[a-z]*|--force)\b/i, reason: '强制删除文件 (rm -f)' },
  { re: /\b(mkfs|fdisk|parted)\b/i, reason: '磁盘格式化/分区操作' },
  { re: /\bdd\s+.*\bof=/i, reason: '裸写磁盘 (dd of=)' },
  { re: /:\s*\(\s*\)\s*\{.*\|.*&\s*\}\s*;/, reason: 'fork bomb' },
  { re: /\bgit\s+push\b.*(--force\b|--force-with-lease\b|\s-f\b)/i, reason: '强制推送 (git push --force)' },
  { re: /\bgit\s+reset\s+--hard\b/i, reason: '硬重置丢弃改动 (git reset --hard)' },
  { re: /\bgit\s+clean\s+-[a-z]*f/i, reason: '清理未跟踪文件 (git clean -f)' },
  { re: /\b(curl|wget)\b[\s\S]*\|\s*(sudo\s+)?(sh|bash|zsh)\b/i, reason: '下载并执行脚本 (curl | sh)' },
  { re: /\bsudo\b/i, reason: '提权执行 (sudo)' },
  { re: /\bchmod\s+(-R\s+)?(777|a\+rwx)\b/i, reason: '放开全部权限 (chmod 777)' },
  { re: /\b(shutdown|reboot|halt|poweroff)\b/i, reason: '关机/重启' },
  { re: />\s*\/dev\/(sd|nvme|disk)/i, reason: '写入裸设备' },
  { re: /\bnpm\s+(i|install)\b.*(-g|--global)\b/i, reason: '全局安装包 (npm i -g)' },
  { re: /\b(killall|pkill)\b/i, reason: '批量结束进程' },
  { re: /\bgit\s+checkout\s+--\s+\./i, reason: '丢弃工作区改动 (git checkout -- .)' },
];

export interface CommandRisk {
  dangerous: boolean;
  reason?: string;
}

/** Classify a shell command. Returns the first matched danger reason, if any. */
export function classifyCommand(command: string): CommandRisk {
  for (const { re, reason } of DANGEROUS_COMMAND_PATTERNS) {
    if (re.test(command)) return { dangerous: true, reason };
  }
  return { dangerous: false };
}

/**
 * Decide how a tool action should be gated for a given mode.
 * Returns one of:
 *  - 'allow':   run immediately, no prompt
 *  - 'auto':    show preview, auto-accept after countdown (user can reject)
 *  - 'manual':  block until the user explicitly approves (no countdown)
 */
export type ApprovalDecision = 'allow' | 'auto' | 'manual';

export function decideApproval(
  mode: ApprovalMode,
  kind: 'read' | 'write' | 'command' | 'external',
  opts?: { dangerous?: boolean }
): ApprovalDecision {
  if (kind === 'read') return 'allow';

  if (mode === 'full') return 'allow';

  if (mode === 'readonly') return 'manual';

  // auto mode
  if (kind === 'command' || kind === 'external') {
    return opts?.dangerous ? 'manual' : 'allow';
  }
  // workspace write in auto mode: preview + countdown
  return 'auto';
}
