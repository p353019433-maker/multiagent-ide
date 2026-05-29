import { execFile } from 'child_process';

export class GitService {
  /** Run `git` in the given cwd and collect stdout. */
  private async git(cwd: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile('git', args, { cwd, maxBuffer: 1024 * 1024, timeout: 15_000 }, (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout);
      });
    });
  }

  async status(cwd: string): Promise<string> {
    try {
      return await this.git(cwd, ['status', '--short', '--branch']);
    } catch {
      return '不是 git 仓库或 git 不可用';
    }
  }

  async diff(cwd: string, staged: boolean = false, filePath?: string): Promise<string> {
    const args = ['diff'];
    if (staged) args.push('--staged');
    if (filePath) args.push('--', filePath);
    try {
      const out = await this.git(cwd, args);
      return out || '没有变化';
    } catch (e: any) {
      return `获取 diff 失败：${e.message}`;
    }
  }

  async log(cwd: string, count: number = 10): Promise<string> {
    try {
      return await this.git(cwd, [
        'log',
        `-${Math.min(count, 50)}`,
        '--oneline',
        '--decorate',
        '--graph',
        '--all',
      ]);
    } catch (e: any) {
      return `获取日志失败：${e.message}`;
    }
  }
}
