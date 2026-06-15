import { execFile } from 'child_process';

/**
 * A git ref/identifier passed straight into argv. Reject anything that could be
 * parsed as an option (leading "-"), contains shell/control characters, or
 * whitespace — git refs don't legitimately contain those. This is defense
 * against argument injection (e.g. a malicious branch name "--upload-pack=...").
 */
function assertRef(value: string, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`无效的 git ${label}：空值`);
  }
  if (value.startsWith('-')) {
    throw new Error(`无效的 git ${label}：不能以 "-" 开头（会被当作选项）`);
  }
  if (/[\s`$\\<>|;&*?!"'\n\r]/.test(value)) {
    throw new Error(`无效的 git ${label}：包含非法字符`);
  }
  return value;
}

export class GitService {
  /** Run `git` in the given cwd and collect stdout. */
  private async git(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
      execFile('git', args, { cwd, maxBuffer: 1024 * 1024, timeout: 30_000 }, (err, stdout, stderr) => {
        // execFile's err.code is a string like 'ENOENT' (the spawn error code),
        // not a numeric exit code. Map it to -1 so callers comparing with
        // `=== 0` (or `< 0`) keep working.
        const exitCode = err
          ? (typeof (err as any).code === 'number' ? (err as any).code : -1)
          : 0;
        resolve({ stdout: stdout || '', stderr: stderr || '', exitCode });
      });
    });
  }

  async status(cwd: string): Promise<string> {
    try {
      const { stdout } = await this.git(cwd, ['status', '--short', '--branch']);
      return stdout || '工作区干净';
    } catch {
      return '不是 git 仓库或 git 不可用';
    }
  }

  async diff(cwd: string, staged: boolean = false, filePath?: string): Promise<string> {
    const args = ['diff'];
    if (staged) args.push('--staged');
    if (filePath) args.push('--', filePath);
    const { stdout } = await this.git(cwd, args);
    return stdout || '没有差异';
  }

  async diffStaged(cwd: string): Promise<string> {
    return this.diff(cwd, true);
  }

  async log(cwd: string, count: number = 10): Promise<string> {
    const { stdout } = await this.git(cwd, [
      'log',
      `-${Math.min(count, 50)}`,
      '--oneline',
      '--decorate',
      '--graph',
      '--all',
    ]);
    return stdout;
  }

  // ── Mutation operations ──

  async stage(cwd: string, files: string[]): Promise<string> {
    const { stdout, stderr, exitCode } = await this.git(cwd, ['add', '--', ...files]);
    return exitCode === 0 ? `已暂存 ${files.length} 个文件` : stderr || stdout;
  }

  async unstage(cwd: string, files: string[]): Promise<string> {
    const { stdout, stderr, exitCode } = await this.git(cwd, ['reset', 'HEAD', '--', ...files]);
    return exitCode === 0 ? `已取消暂存 ${files.length} 个文件` : stderr || stdout;
  }

  async stageAll(cwd: string): Promise<string> {
    const { stdout, stderr, exitCode } = await this.git(cwd, ['add', '-A']);
    return exitCode === 0 ? '已暂存所有变更' : stderr || stdout;
  }

  async commit(cwd: string, message: string): Promise<string> {
    const { stdout, stderr, exitCode } = await this.git(cwd, ['commit', '-m', message]);
    return exitCode === 0 ? stdout || '提交成功' : stderr || stdout;
  }

  async push(cwd: string, remote?: string, branch?: string): Promise<string> {
    const args = ['push'];
    if (remote) args.push(assertRef(remote, 'remote'));
    if (branch) args.push(assertRef(branch, 'branch'));
    args.push('--'); // terminal options so a later value can't be a flag
    const { stdout, stderr, exitCode } = await this.git(cwd, args);
    return exitCode === 0 ? stdout || '推送成功' : stderr || stdout;
  }

  async pull(cwd: string, remote?: string, branch?: string): Promise<string> {
    const args = ['pull'];
    if (remote) args.push(assertRef(remote, 'remote'));
    if (branch) args.push(assertRef(branch, 'branch'));
    args.push('--');
    const { stdout, stderr, exitCode } = await this.git(cwd, args);
    return exitCode === 0 ? stdout || '拉取成功' : stderr || stdout;
  }

  async branchList(cwd: string): Promise<string> {
    const { stdout } = await this.git(cwd, ['branch', '-a']);
    return stdout;
  }

  async branchSwitch(cwd: string, name: string): Promise<string> {
    const { stdout, stderr, exitCode } = await this.git(cwd, ['checkout', assertRef(name, 'branch'), '--']);
    return exitCode === 0 ? `已切换到分支 ${name}` : stderr || stdout;
  }

  async branchCreate(cwd: string, name: string): Promise<string> {
    const { stdout, stderr, exitCode } = await this.git(cwd, ['checkout', '-b', assertRef(name, 'branch'), '--']);
    return exitCode === 0 ? `已创建并切换到分支 ${name}` : stderr || stdout;
  }

  /** Get current branch name */
  async currentBranch(cwd: string): Promise<string> {
    const { stdout } = await this.git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
    return stdout.trim();
  }

  // ── Worktree operations ──

  /** Create a new linked worktree at the given path, on a new branch or detached HEAD. */
  async worktreeAdd(
    cwd: string,
    worktreePath: string,
    branchName: string,
    baseBranch?: string
  ): Promise<{ success: boolean; message: string; path?: string }> {
    // git worktree add -b <branch> <path> [<base-commit>]
    // branchName is validated (no leading "-"); worktreePath is sanitized so it
    // can't masquerade as a flag — actual filesystem containment is enforced by
    // the IPC layer's assertAllowedPath before this is ever called.
    const args = ['worktree', 'add', '-b', assertRef(branchName, 'branch'), '--', worktreePath];
    if (baseBranch) args.push(assertRef(baseBranch, 'base branch'));
    const { stdout, stderr, exitCode } = await this.git(cwd, args);
    if (exitCode !== 0) return { success: false, message: stderr };
    return { success: true, message: stdout || `已创建 worktree ${branchName}`, path: worktreePath };
  }

  /** List all worktrees for the repo. */
  async worktreeList(cwd: string): Promise<
    { path: string; branch: string; bare: boolean; detached: boolean; locked: boolean }[]
  > {
    const { stdout } = await this.git(cwd, ['worktree', 'list', '--porcelain']);
    // Parse porcelain output
    const entries: ReturnType<GitService['worktreeList']> extends Promise<(infer T)[]> ? any[] : never = [];
    let current: any = {};
    for (const line of stdout.split('\n')) {
      if (line === '') {
        if (current.path) entries.push(current);
        current = {};
        continue;
      }
      const space = line.indexOf(' ');
      const key = line.slice(0, space);
      const val = line.slice(space + 1);
      if (key === 'worktree') current.path = val;
      else if (key === 'bare') current.bare = val === 'true';
      else if (key === 'detached') current.detached = val === 'true';
      else if (key === 'branch') current.branch = val.replace('refs/heads/', '');
      else if (key === 'locked') current.locked = val === 'true';
    }
    if (current.path) entries.push(current);
    return entries;
  }

  /** Remove a worktree and delete its directory. */
  async worktreeRemove(cwd: string, worktreePath: string): Promise<{ success: boolean; message: string }> {
    const { stdout, stderr, exitCode } = await this.git(cwd, ['worktree', 'remove', '--force', '--', worktreePath]);
    if (exitCode !== 0) return { success: false, message: stderr };
    return { success: true, message: stdout || `已删除 worktree ${worktreePath}` };
  }

  /** Prune stale worktree entries from repo metadata. */
  async worktreePrune(cwd: string): Promise<string> {
    const { stdout } = await this.git(cwd, ['worktree', 'prune']);
    return stdout || '已清理过期 worktree 记录';
  }

  /** Merge a branch into the current branch. Supports merge/squash/rebase. */
  async worktreeMerge(
    cwd: string,
    sourceBranch: string,
    method: 'merge' | 'squash' | 'rebase' = 'merge',
    targetBranch?: string
  ): Promise<{ success: boolean; message: string }> {
    if (targetBranch) {
      const current = await this.git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
      if (current.exitCode !== 0) {
        return { success: false, message: current.stderr || current.stdout || '无法读取当前分支' };
      }
      if (current.stdout.trim() !== targetBranch) {
        const switched = await this.git(cwd, ['switch', assertRef(targetBranch, 'target branch'), '--']);
        if (switched.exitCode !== 0) {
          return { success: false, message: switched.stderr || switched.stdout || `无法切换到 ${targetBranch}` };
        }
      }
    }

    const source = assertRef(sourceBranch, 'source branch');
    let args: string[];
    switch (method) {
      case 'squash':
        args = ['merge', '--squash', source];
        break;
      case 'rebase':
        args = ['rebase', source];
        break;
      default:
        args = ['merge', source];
    }
    const { stdout, stderr, exitCode } = await this.git(cwd, args);
    if (exitCode !== 0) return { success: false, message: stderr };
    return { success: true, message: stdout || `已${method} ${sourceBranch}` };
  }

  /** Get merge diff between two branches (what B has that A doesn't). */
  async worktreeMergeDiff(cwd: string, baseBranch: string, headBranch: string): Promise<string> {
    const base = assertRef(baseBranch, 'base branch');
    const head = assertRef(headBranch, 'head branch');
    const { stdout } = await this.git(cwd, ['diff', `${base}...${head}`]);
    return stdout || '没有差异';
  }
}
