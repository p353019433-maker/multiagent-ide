/**
 * Command & approval policy shared between main and renderer.
 *
 * The approval model has three tiers, modeled after Codex's sandbox modes:
 *  - readonly: every write / command needs an explicit manual approval
 *  - auto:     reads run freely; workspace writes auto-accept after a short
 *              preview; shell commands run unless they match a danger pattern,
 *              in which case they require manual approval regardless of tier
 *  - full:     local operations run with minimal prompts EXCEPT external /
 *              irreversible operations (GitHub writes, remote API writes),
 *              which still need an explicit manual approval unless the user has
 *              opted in to `allowExternalInFull`.
 */

export type ApprovalMode = 'readonly' | 'auto' | 'full';

export const DEFAULT_APPROVAL_MODE: ApprovalMode = 'auto';

export const APPROVAL_MODE_META: Record<
  ApprovalMode,
  { label: string; hint: string }
> = {
  readonly: {
    label: '只读',
    hint: '所有写入与命令都需手动批准',
  },
  auto: {
    label: '自动',
    hint: '读放行，写入预览后自动接受，危险命令拦截',
  },
  full: {
    label: '完全',
    hint: '本地操作尽量自动；对外/不可逆操作默认仍需确认',
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
  { re: /\brm\s+-[a-z]*rf/i, reason: '强制递归删除 (rm -rf)' },
  { re: /\b(mkfs|fdisk|parted|wipefs)\b/i, reason: '磁盘格式化/分区操作' },
  { re: /\bdd\s+.*\bof=/i, reason: '裸写磁盘 (dd of=)' },
  { re: /:\s*\(\s*\)\s*\{.*\|.*&\s*\}\s*;/, reason: 'fork bomb' },
  { re: /\bgit\s+push\b.*(--force\b|--force-with-lease\b|\s-f\b)/i, reason: '强制推送 (git push --force)' },
  { re: /\bgit\s+reset\s+--hard\b/i, reason: '硬重置丢弃改动 (git reset --hard)' },
  { re: /\bgit\s+clean\s+-[a-z]*f/i, reason: '清理未跟踪文件 (git clean -f)' },
  { re: /\bgit\s+branch\s+-D\b/i, reason: '强制删除分支 (git branch -D)' },
  { re: /\bgit\s+stash\s+drop\b/i, reason: '丢弃 stash (git stash drop)' },
  { re: /\bgit\s+update-ref\s+-d\b/i, reason: '删除 git ref (git update-ref -d)' },
  { re: /\b(curl|wget|fetch)\b[\s\S]*\|\s*(sudo\s+)?(sh|bash|zsh|python|node|perl|ruby)\b/i, reason: '下载并执行脚本 (curl | sh)' },
  { re: /\bsudo\b/i, reason: '提权执行 (sudo)' },
  { re: /\bsu\s+-?\b/i, reason: '切换用户 (su)' },
  { re: /\bchmod\s+(-R\s+)?(777|a\+rwx|o\+w)\b/i, reason: '放开全部权限 (chmod 777)' },
  { re: /\bchown\s+-R\b/i, reason: '递归改文件属主 (chown -R)' },
  { re: /\b(shutdown|reboot|halt|poweroff|init\s+0|init\s+6)\b/i, reason: '关机/重启' },
  { re: />\s*\/dev\/(sd|nvme|disk|hd)/i, reason: '写入裸设备' },
  { re: /\bnpm\s+(i|install)\b.*(-g|--global)\b/i, reason: '全局安装包 (npm i -g)' },
  { re: /\bnpm\s+publish\b/i, reason: '发布 npm 包 (npm publish)' },
  { re: /\b(killall|pkill)\b/i, reason: '批量结束进程' },
  { re: /\bgit\s+checkout\s+--\s+\./i, reason: '丢弃工作区改动 (git checkout -- .)' },
  // /etc/, /System, ssh keys, AWS/GCP credentials — common exfil targets
  { re: /\b(cat|less|more|head|tail|cp|mv|scp|rsync)\b[^\n]*(\/etc\/(?:passwd|shadow|sudoers)|~\/\.ssh|~\/\.aws|~\/\.config\/gcloud)/i, reason: '读取系统/凭据文件' },
  // eval / source / exec with substitution — common injection sinks
  { re: /\beval\s+/i, reason: 'eval 动态执行' },
  { re: /\bsource\s+[^\n]*\$\(/i, reason: 'source + 命令替换' },
  // Direct disk write bypassing the FS
  { re: /\bdd\s+if=/i, reason: '裸读设备 (dd if=)' },
  // Command-substitution / backticks combined with network or credential
  // access. Shell metacharacters alone are too noisy to gate, but a
  // substitution that touches the network or reads secrets is a classic
  // exfiltration vector (e.g. `curl host/$(cat ~/.aws/credentials)`).
  { re: /\$\([^)]*\)/i, reason: '命令替换 $(...)，可能拼接外部数据' },
  { re: /`[^`]*`/, reason: '反引号命令替换，可能拼接外部数据' },
  // Network egress by a non-interactive tool is worth a confirmation.
  { re: /\b(curl|wget|nc|ncat|netcat|telnet)\b/i, reason: '网络下载/连接工具 (curl/wget/nc)' },
  // Piping into an interpreter runs arbitrary remote/local code.
  { re: /\|\s*(sh|bash|zsh|python|python3|node|perl|ruby|php)\b/i, reason: '管道执行解释器 (| sh/python/node)' },
  // Writing into startup/persistence locations.
  { re: /(\/etc\/(profile|bash\.|zsh|csh)|~\/\.(bash_profile|bashrc|zshrc|profile|config\/(autostart|systemd)))/i, reason: '写入启动/持久化位置' },
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
  opts?: { dangerous?: boolean; allowExternalInFull?: boolean }
): ApprovalDecision {
  if (kind === 'read') return 'allow';

  if (mode === 'full') {
    // External/irreversible ops (GitHub PR/merge/release, remote writes, etc.)
    // still require explicit confirmation in `full` mode unless the user has
    // explicitly opted in via `allowExternalInFull`. This keeps the local
    // automation intent of `full` without making external actions silent.
    if (kind === 'external' && !opts?.allowExternalInFull) return 'manual';
    return 'allow';
  }

  if (mode === 'readonly') return 'manual';

  // auto mode
  if (kind === 'external') {
    // Remote/irreversible writes (GitHub PR/merge/release, etc.) always require
    // explicit confirmation, even in auto mode.
    return 'manual';
  }
  if (kind === 'command') {
    // Safe local shell commands auto-run; dangerous ones are gated.
    return opts?.dangerous ? 'manual' : 'allow';
  }
  // workspace write in auto mode: preview + countdown
  return 'auto';
}
