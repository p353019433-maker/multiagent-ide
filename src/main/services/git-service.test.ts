import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, it } from 'vitest';
import { GitService } from './git-service';

const tempDirs: string[] = [];

async function makeTempDir() {
  const dir = await mkdtemp(join(tmpdir(), 'code-ide-git-service-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('GitService mutation failures', () => {
  it('rejects stageAll when git exits non-zero', async () => {
    const dir = await makeTempDir();
    const service = new GitService();

    await expect(service.stageAll(dir)).rejects.toThrow(/git add -A/);
  });
});
