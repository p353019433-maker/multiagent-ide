import { describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@shared/types';
import { cleanupWorktreeConversation } from './TaskSessionTabs';

const conversation: Conversation = {
  id: 'conv-1',
  title: 'Feature task',
  messages: [],
  providerId: 'provider',
  model: 'model',
  createdAt: 1,
  updatedAt: 1,
  worktree: {
    path: '/repo_wt/feature-task',
    branch: 'feature-task',
    baseBranch: 'main',
  },
};

function installGitApi(removeResult: { success: boolean; message: string }) {
  const worktreeList = vi.fn(async () => [
    { path: '/repo_wt/feature-task/', branch: 'feature-task' },
  ]);
  const worktreeRemove = vi.fn(async () => removeResult);

  (globalThis as any).window = {
    api: {
      git: {
        worktreeList,
        worktreeRemove,
      },
    },
  };

  return { worktreeList, worktreeRemove };
}

describe('cleanupWorktreeConversation', () => {
  it('rejects when git refuses to remove the worktree', async () => {
    const { worktreeRemove } = installGitApi({ success: false, message: 'worktree is busy' });

    await expect(
      cleanupWorktreeConversation(conversation, '/repo')
    ).rejects.toThrow('worktree is busy');

    expect(worktreeRemove).toHaveBeenCalledWith(
      '/repo',
      '/repo_wt/feature-task',
      'feature-task'
    );
  });

  it('returns the cleaned branch when git removes the worktree', async () => {
    installGitApi({ success: true, message: 'removed' });

    await expect(cleanupWorktreeConversation(conversation, '/repo')).resolves.toEqual({
      branch: 'feature-task',
    });
  });
});
