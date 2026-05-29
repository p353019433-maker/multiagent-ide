import { execFile } from 'child_process';

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
}
