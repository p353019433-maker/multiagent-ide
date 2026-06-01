import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';

export class GitService {
  /** Run `git` in the given cwd and collect stdout. */
  private async git(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
      execFile('git', args, { cwd, maxBuffer: 1024 * 1024, timeout: 30_000 }, (err, stdout, stderr) => {
        resolve({ stdout: stdout || '', stderr: stderr || '', exitCode: err ? (err as any).code ?? -1 : 0 });
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
    if (remote) args.push(remote);
    if (branch) args.push(branch);
    const { stdout, stderr, exitCode } = await this.git(cwd, args);
    return exitCode === 0 ? stdout || '推送成功' : stderr || stdout;
  }

  async pull(cwd: string, remote?: string, branch?: string): Promise<string> {
    const args = ['pull'];
    if (remote) args.push(remote);
    if (branch) args.push(branch);
    const { stdout, stderr, exitCode } = await this.git(cwd, args);
    return exitCode === 0 ? stdout || '拉取成功' : stderr || stdout;
  }

  async branchList(cwd: string): Promise<string> {
    const { stdout } = await this.git(cwd, ['branch', '-a']);
    return stdout;
  }

  async branchSwitch(cwd: string, name: string): Promise<string> {
    const { stdout, stderr, exitCode } = await this.git(cwd, ['checkout', name]);
    return exitCode === 0 ? `已切换到分支 ${name}` : stderr || stdout;
  }

  async branchCreate(cwd: string, name: string): Promise<string> {
    const { stdout, stderr, exitCode } = await this.git(cwd, ['checkout', '-b', name]);
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
    const args = ['worktree', 'add', '-b', branchName, worktreePath];
    if (baseBranch) args.push(baseBranch);
    const { stdout, stderr, exitCode } = await this.git(cwd, args);
    if (exitCode !== 0) return { success: false, message: stderr };
    // Worktrees don't carry the (gitignored) node_modules, so any compile/test
    // command inside one crashes on missing dependencies. Symlink the parent
    // repo's node_modules so the worktree shares them at near-zero disk cost.
    await this.linkNodeModules(cwd, worktreePath);
    return { success: true, message: stdout || `已创建 worktree ${branchName}`, path: worktreePath };
  }

  /** Best-effort symlink of <mainRepo>/node_modules into a fresh worktree. */
  private async linkNodeModules(mainRepo: string, worktreePath: string): Promise<void> {
    try {
      const src = path.join(mainRepo, 'node_modules');
      const dest = path.join(worktreePath, 'node_modules');
      const srcStat = await fs.stat(src).catch(() => null);
      if (!srcStat?.isDirectory()) return; // nothing to share
      const destExists = await fs.lstat(dest).then(() => true).catch(() => false);
      if (destExists) return; // worktree already has its own (don't clobber)
      // 'junction' on Windows avoids the admin-privilege requirement of dir symlinks.
      const type = process.platform === 'win32' ? 'junction' : 'dir';
      await fs.symlink(src, dest, type);
    } catch (err) {
      console.warn(`无法共享 node_modules 到 worktree ${worktreePath}:`, err);
      // Non-fatal: the worktree is still usable, deps just won't be shared.
    }
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

  /**
   * Remove a worktree and delete its directory. If `deleteBranch` is given, the
   * now-detached branch is force-deleted too and stale metadata pruned, so a
   * finished session leaves nothing behind (no orphan branch, no dangling dir).
   */
  async worktreeRemove(
    cwd: string,
    worktreePath: string,
    deleteBranch?: string
  ): Promise<{ success: boolean; message: string }> {
    const { stdout, stderr, exitCode } = await this.git(cwd, ['worktree', 'remove', worktreePath, '--force']);
    if (exitCode !== 0) return { success: false, message: stderr };
    if (deleteBranch) {
      // Best-effort: the branch may carry unmerged work or already be gone.
      await this.git(cwd, ['branch', '-D', deleteBranch]);
      await this.git(cwd, ['worktree', 'prune']);
    }
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
        const switched = await this.git(cwd, ['switch', targetBranch]);
        if (switched.exitCode !== 0) {
          return { success: false, message: switched.stderr || switched.stdout || `无法切换到 ${targetBranch}` };
        }
      }
    }

    let args: string[];
    switch (method) {
      case 'squash':
        args = ['merge', '--squash', sourceBranch];
        break;
      case 'rebase':
        args = ['rebase', sourceBranch];
        break;
      default:
        args = ['merge', sourceBranch];
    }
    const { stdout, stderr, exitCode } = await this.git(cwd, args);
    if (exitCode !== 0) return { success: false, message: stderr };
    return { success: true, message: stdout || `已${method} ${sourceBranch}` };
  }

  /** Get merge diff between two branches (what B has that A doesn't). */
  async worktreeMergeDiff(cwd: string, baseBranch: string, headBranch: string): Promise<string> {
    const { stdout } = await this.git(cwd, ['diff', `${baseBranch}...${headBranch}`]);
    return stdout || '没有差异';
  }
}
