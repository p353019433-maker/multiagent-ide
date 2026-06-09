import { describe, it, expect, vi, beforeEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

vi.mock('electron', () => {
  const handlers = new Map<string, Function>();
  return {
    ipcMain: {
      handle: vi.fn((channel: string, fn: Function) => handlers.set(channel, fn)),
    },
    dialog: { showOpenDialog: vi.fn() },
    safeStorage: {
      isEncryptionAvailable: vi.fn(() => false),
      encryptString: vi.fn(),
      decryptString: vi.fn(),
    },
    app: { getPath: vi.fn(() => os.tmpdir()) },
    BrowserWindow: class {},
    __handlers: handlers,
  };
});

import * as electron from 'electron';
import { registerIpc } from './ipc';

const handlers = (electron as unknown as { __handlers: Map<string, Function> }).__handlers;
const appEvent = { senderFrame: { url: 'file:///app/index.html' } };

function deps(overrides: Partial<any> = {}) {
  return {
    getMainWindow: () => null,
    fileService: {},
    terminalService: {},
    storeService: { get: vi.fn(), set: vi.fn() },
    aiService: {},
    gitService: {},
    webService: {},
    githubService: {},
    analysisService: {},
    codebaseSearchService: {},
    ...overrides,
  } as any;
}

async function authorizeRoot(root: string) {
  const openFolder = handlers.get('dialog:openFolder')!;
  vi.mocked(electron.dialog.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: [root] } as any);
  await openFolder(appEvent);
}

describe('IPC worktree path policy', () => {
  let root: string;
  let allowedWorktree: string;
  let outside: string;

  beforeEach(async () => {
    handlers.clear();
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'ide-ipc-'));
    root = path.join(base, 'repo');
    allowedWorktree = path.join(base, 'repo_wt', 'task-1');
    outside = path.join(base, 'elsewhere', 'task-1');
    await fs.mkdir(root, { recursive: true });
  });

  it('allows worktrees inside the sibling <repo>_wt directory even before the parent exists', async () => {
    const gitService = {
      worktreeAdd: vi.fn(async (_cwd: string, p: string) => {
        await fs.mkdir(p, { recursive: true });
        return { success: true, path: p, message: 'ok' };
      }),
    };
    registerIpc(deps({ gitService }));
    await authorizeRoot(root);

    const worktreeAdd = handlers.get('git:worktreeAdd')!;
    const res = await worktreeAdd(appEvent, root, allowedWorktree, 'task-1');

    expect(res.success).toBe(true);
    expect(gitService.worktreeAdd).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('repo_wt'),
      'task-1',
      undefined
    );
  });

  it('rejects worktree paths outside the sibling <repo>_wt directory before authorizing them', async () => {
    const gitService = { worktreeAdd: vi.fn() };
    registerIpc(deps({ gitService }));
    await authorizeRoot(root);

    const worktreeAdd = handlers.get('git:worktreeAdd')!;
    await expect(worktreeAdd(appEvent, root, outside, 'task-1')).rejects.toThrow(/路径必须位于/);
    expect(gitService.worktreeAdd).not.toHaveBeenCalled();
  });
});

describe('IPC store key policy', () => {
  beforeEach(() => {
    handlers.clear();
  });

  it('allows known public settings and conversation keys', async () => {
    const storeService = { get: vi.fn(() => 'value'), set: vi.fn() };
    registerIpc(deps({ storeService }));

    expect(handlers.get('store:get')!(appEvent, 'providers')).toBe('value');
    expect(handlers.get('store:set')!(appEvent, 'conv:abc', { id: 'abc' })).toBeUndefined();
    expect(storeService.get).toHaveBeenCalledWith('providers');
    expect(storeService.set).toHaveBeenCalledWith('conv:abc', { id: 'abc' });
  });

  it('rejects arbitrary public store keys', async () => {
    const storeService = { get: vi.fn(), set: vi.fn() };
    registerIpc(deps({ storeService }));

    expect(() => handlers.get('store:get')!(appEvent, 'github_token')).toThrow(/拒绝访问 store key/);
    expect(() => handlers.get('store:set')!(appEvent, 'randomSecret', 'x')).toThrow(/拒绝访问 store key/);
    expect(storeService.get).not.toHaveBeenCalled();
    expect(storeService.set).not.toHaveBeenCalled();
  });

  it('allows only dedicated secret keys through encrypted secret IPC', async () => {
    const storeService = { get: vi.fn(), set: vi.fn() };
    registerIpc(deps({ storeService }));

    expect(() => handlers.get('store:decryptAndGet')!(appEvent, 'providers')).toThrow(/拒绝访问通用 secret/);
    expect(handlers.get('store:decryptAndGet')!(appEvent, 'github_token')).toBeNull();
    expect(handlers.get('store:decryptAndGet')!(appEvent, 'apiKey:abc')).toBeNull();
    expect(handlers.get('store:decryptAndGet')!(appEvent, 'apikey_legacy')).toBeNull();
  });
});

describe('IPC file path policy', () => {
  let root: string;

  beforeEach(async () => {
    handlers.clear();
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'ide-ipc-file-'));
    root = path.join(base, 'repo');
    await fs.mkdir(root, { recursive: true });
  });

  it('allows writing nested new files inside an authorized workspace', async () => {
    const fileService = { writeFile: vi.fn() };
    const fileWatcherService = { ignoreNext: vi.fn() };
    registerIpc(deps({ fileService, fileWatcherService }));
    await authorizeRoot(root);

    const nestedFile = path.join(root, '.ide', 'history', 'snapshot.snap');
    await handlers.get('fs:writeFile')!(appEvent, nestedFile, 'snapshot');

    const canonicalNestedFile = path.join(await fs.realpath(root), '.ide', 'history', 'snapshot.snap');
    expect(fileWatcherService.ignoreNext).toHaveBeenCalledWith(canonicalNestedFile);
    expect(fileService.writeFile).toHaveBeenCalledWith(canonicalNestedFile, 'snapshot');
  });
});

describe('IPC worktree merge policy', () => {
  let root: string;

  beforeEach(async () => {
    handlers.clear();
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'ide-ipc-merge-'));
    root = path.join(base, 'repo');
    await fs.mkdir(root, { recursive: true });
  });

  it('rejects invalid merge methods and branch refs before calling git', async () => {
    const gitService = { worktreeMerge: vi.fn(), worktreeMergeDiff: vi.fn() };
    registerIpc(deps({ gitService }));
    await authorizeRoot(root);

    await expect(handlers.get('git:worktreeMerge')!(appEvent, root, 'feature', 'octopus')).rejects.toThrow(/非法合并方式/);
    await expect(handlers.get('git:worktreeMerge')!(appEvent, root, 'bad..branch', 'merge')).rejects.toThrow(/非法 sourceBranch/);
    await expect(handlers.get('git:worktreeMergeDiff')!(appEvent, root, 'main', 'bad\nbranch')).rejects.toThrow(/非法 headBranch/);
    expect(gitService.worktreeMerge).not.toHaveBeenCalled();
    expect(gitService.worktreeMergeDiff).not.toHaveBeenCalled();
  });
});
