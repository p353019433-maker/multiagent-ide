import { describe, expect, it, vi } from 'vitest';
import { removeWorktreeOrThrow } from './TaskRunsPanel';

function installGitApi(result: { success: boolean; message: string }) {
  const worktreeRemove = vi.fn(async () => result);
  (globalThis as any).window = {
    api: {
      git: {
        worktreeRemove,
      },
    },
  };
  return { worktreeRemove };
}

describe('removeWorktreeOrThrow', () => {
  it('rejects when git reports worktree removal failure', async () => {
    installGitApi({ success: false, message: 'busy worktree' });

    await expect(removeWorktreeOrThrow('/repo', '/repo_wt/task-1', 'task-1')).rejects.toThrow(
      'busy worktree'
    );
  });

  it('resolves when git removes the worktree', async () => {
    const { worktreeRemove } = installGitApi({ success: true, message: 'removed' });

    await expect(removeWorktreeOrThrow('/repo', '/repo_wt/task-1', 'task-1')).resolves.toBeUndefined();
    expect(worktreeRemove).toHaveBeenCalledWith('/repo', '/repo_wt/task-1', 'task-1');
  });
});
