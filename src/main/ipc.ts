/**
 * IPC registration, split by domain. Extracted from index.ts's monolithic
 * setupIPC(). Each registerXxxIpc function wires one domain's channels to its
 * service; registerIpc() calls them all. Behavior is identical to the original.
 */

import { ipcMain, dialog, safeStorage, BrowserWindow, IpcMainInvokeEvent } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import type { FileService } from './services/file-service';
import type { TerminalService } from './services/terminal-service';
import type { StoreService } from './services/store-service';
import type { AIService } from './services/ai-service';
import type { GitService } from './services/git-service';
import type { WebService } from './services/web-service';
import type { GitHubService } from './services/github-service';
import type { AnalysisService } from './services/analysis-service';
import type { CodebaseSearchService } from './services/codebase-search-service';
import type { FileWatcherService } from './services/file-watcher-service';
import type { CliAgentService, CliAgentResult } from './services/cli-agent-service';
import type { SkillsService } from './services/skills-service';
import { classifyCommand } from '../shared/command-policy';

const allowedRoots = new Set<string>();

async function canonical(p: string): Promise<string> {
  const resolved = path.resolve(p);
  try {
    return await fs.realpath(resolved);
  } catch {
    const pending: string[] = [];
    let cursor = resolved;

    while (cursor && cursor !== path.dirname(cursor)) {
      try {
        const real = await fs.realpath(cursor);
        return path.join(real, ...pending.reverse());
      } catch {
        pending.push(path.basename(cursor));
        cursor = path.dirname(cursor);
      }
    }

    const realRoot = await fs.realpath(cursor || path.sep);
    return path.join(realRoot, ...pending.reverse());
  }
}

async function allowRoot(root: string): Promise<string> {
  const real = await canonical(root);
  allowedRoots.add(real);
  return real;
}

async function assertAllowedPath(p: string, opts: { allowRoot?: boolean } = {}): Promise<string> {
  if (allowedRoots.size === 0) throw new Error('未授权工作区');
  const real = await canonical(p);
  for (const root of allowedRoots) {
    const rel = path.relative(root, real);
    if (rel === '') {
      if (opts.allowRoot) return real;
      throw new Error('拒绝操作工作区根目录');
    }
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return real;
  }
  throw new Error('拒绝访问：路径超出已授权工作区');
}

async function assertAllowedRoot(root: string): Promise<string> {
  return assertAllowedPath(root, { allowRoot: true });
}

async function assertAllowedWorktreePath(repoRoot: string, requestedPath: string): Promise<string> {
  const repoParent = path.dirname(repoRoot);
  const repoBase = path.basename(repoRoot);
  const allowedParent = await canonical(path.join(repoParent, `${repoBase}_wt`));
  const real = await canonical(requestedPath);
  const rel = path.relative(allowedParent, real);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`拒绝创建 worktree：路径必须位于 ${allowedParent} 内`);
  }
  return real;
}

function assertAppOrigin(event: IpcMainInvokeEvent): void {
  const url = event.senderFrame?.url || '';
  if (url.startsWith('http://localhost:5173/') || url === 'http://localhost:5173' || url.startsWith('http://127.0.0.1:5173/') || url === 'http://127.0.0.1:5173') return;
  if (url.startsWith('file://')) {
    try {
      const parsed = new URL(url);
      const normalizedPath = decodeURIComponent(parsed.pathname).replace(/\\/g, '/');
      if (normalizedPath.endsWith('/renderer/index.html') || normalizedPath.endsWith('/dist/renderer/index.html')) return;
    } catch {
      // fall through
    }
  }
  throw new Error(`拒绝来自非应用页面的 IPC: ${url}`);
}

async function confirmDangerousAction(
  event: IpcMainInvokeEvent,
  title: string,
  message: string,
  detail?: string
): Promise<void> {
  const win = BrowserWindow.fromWebContents(event.sender);
  const options = {
    type: 'warning' as const,
    buttons: ['取消', '继续'],
    defaultId: 0,
    cancelId: 0,
    title,
    message,
    detail,
    noLink: true,
  };
  const result = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
  if (result.response !== 1) throw new Error('用户取消了高风险操作');
}


const ALLOWED_STORE_KEYS = new Set([
  'providers',
  'agents',
  'activeProviderId',
  'activeModel',
  'approvalMode',
  'allowExternalInFull',
  'embeddingConfig',
  'rerankConfig',
  'conversationIndex',
  'conversations',
  // Persisted UI preferences (which workbench view, editor font/tab/wrap).
  'workbenchView',
  'editorSettings',
  // conversationStore schema-version stamp for the per-conversation migration pipeline.
  'conversationSchemaVersion',
  // debate-agent role configuration.
  'debateConfig',
]);

function assertAllowedStoreKey(key: string): string {
  if (ALLOWED_STORE_KEYS.has(key) || key.startsWith('conv:')) return key;
  throw new Error(`拒绝访问 store key: ${key}`);
}

function assertAllowedSecretWriteKey(key: string): string {
  if (key === 'github_token' || key.startsWith('apiKey:') || key.startsWith('apikey_')) return key;
  throw new Error('拒绝写入通用 secret');
}

function assertAllowedSecretReadKey(key: string): string {
  // The renderer must never read secret plaintext. hasSecret only checks
  // presence; actual decryption happens inside main-process callers.
  throw new Error(`拒绝读取通用 secret: ${key}`);
}

function assertSafeGitRef(ref: string, label: string): string {
  // Reject values that git would interpret as options (argument injection):
  // a ref/branch/remote must never start with '-'. Also block NUL/newlines,
  // revision-range metacharacters, '..', and '.lock' suffixes.
  if (
    !ref ||
    ref.length > 200 ||
    ref.startsWith('-') ||
    /[\0\n\r~^:?*[\\]/.test(ref) ||
    ref.includes('..') ||
    ref.endsWith('.lock')
  ) {
    throw new Error(`非法 ${label}: ${ref}`);
  }
  return ref;
}

function assertMergeMethod(method: string): 'merge' | 'squash' | 'rebase' {
  if (method === 'merge' || method === 'squash' || method === 'rebase') return method;
  throw new Error(`非法合并方式: ${method}`);
}

export interface IpcDeps {
  getMainWindow: () => BrowserWindow | null;
  fileService: FileService;
  terminalService: TerminalService;
  storeService: StoreService;
  aiService: AIService;
  gitService: GitService;
  webService: WebService;
  githubService: GitHubService;
  analysisService: AnalysisService;
  codebaseSearchService: CodebaseSearchService;
  fileWatcherService: FileWatcherService;
  cliAgentService: CliAgentService;
  skillsService: SkillsService;
}

export function registerIpc(deps: IpcDeps): void {
  registerDialogIpc();
  registerFileSystemIpc(deps);
  registerTerminalIpc(deps);
  registerStoreIpc(deps);
  registerAIIpc(deps);
  registerGitIpc(deps);
  registerWebIpc(deps);
  registerGitHubIpc(deps);
  registerAnalysisIpc(deps);
  registerContextIpc(deps);
  registerRulesIpc();
  registerCodebaseIpc(deps);
  registerCliAgentIpc(deps);
  registerSkillsIpc(deps);
}

function registerDialogIpc(): void {
  ipcMain.handle('dialog:openFolder', async (event) => {
    assertAppOrigin(event);
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (result.canceled) return null;
    return allowRoot(result.filePaths[0]);
  });
}

function registerFileSystemIpc({ fileService, fileWatcherService, getMainWindow }: IpcDeps): void {
  ipcMain.handle('fs:startWatching', async (event, rootPath: string) => {
    assertAppOrigin(event);
    const win = getMainWindow();
    if (win) {
      fileWatcherService.startWatching(await assertAllowedRoot(rootPath), win);
    }
  });
  
  ipcMain.handle('fs:stopWatching', async (event) => {
    assertAppOrigin(event);
    fileWatcherService.stopWatching();
  });

  ipcMain.handle('fs:readDirectory', async (event, dirPath: string) => {
    assertAppOrigin(event);
    return fileService.readDirectory(await assertAllowedRoot(dirPath));
  });
  ipcMain.handle('fs:readFile', async (event, filePath: string) => {
    assertAppOrigin(event);
    return fileService.readFile(await assertAllowedPath(filePath));
  });
  ipcMain.handle('fs:writeFile', async (event, filePath: string, content: string) => {
    assertAppOrigin(event);
    const allowedPath = await assertAllowedPath(filePath);
    fileWatcherService.ignoreNext(allowedPath);
    return fileService.writeFile(allowedPath, content);
  });
  ipcMain.handle('fs:createFile', async (event, filePath: string) => {
    assertAppOrigin(event);
    return fileService.createFile(await assertAllowedPath(filePath));
  });
  ipcMain.handle('fs:createDirectory', async (event, dirPath: string) => {
    assertAppOrigin(event);
    return fileService.createDirectory(await assertAllowedPath(dirPath, { allowRoot: false }));
  });
  ipcMain.handle('fs:delete', async (event, targetPath: string) => {
    assertAppOrigin(event);
    return fileService.delete(await assertAllowedPath(targetPath));
  });
  ipcMain.handle('fs:rename', async (event, oldPath: string, newPath: string) => {
    assertAppOrigin(event);
    return fileService.rename(await assertAllowedPath(oldPath), await assertAllowedPath(newPath));
  });
  ipcMain.handle('fs:searchFiles', async (event, rootPath: string, query: string) => {
    assertAppOrigin(event);
    return fileService.searchFiles(await assertAllowedRoot(rootPath), query);
  });
  ipcMain.handle('fs:findFiles', async (event, rootPath: string, pattern: string) => {
    assertAppOrigin(event);
    return fileService.findFiles(await assertAllowedRoot(rootPath), pattern);
  });
  ipcMain.handle('fs:listFiles', async (event, rootPath: string) => {
    assertAppOrigin(event);
    return fileService.listFiles(await assertAllowedRoot(rootPath));
  });
  ipcMain.handle('fs:getFileInfo', async (event, filePath: string) => {
    assertAppOrigin(event);
    return fileService.getFileInfo(await assertAllowedPath(filePath));
  });
  ipcMain.handle('fs:readMultipleFiles', async (event, paths: string[]) => {
    assertAppOrigin(event);
    const results: Record<string, string> = {};
    for (const p of paths.slice(0, 20)) {
      try {
        const safe = await assertAllowedPath(p);
        results[p] = await fileService.readFile(safe);
      } catch {
        results[p] = `[读取失败：${p}]`;
      }
    }
    return results;
  });
}

function registerTerminalIpc({ terminalService, getMainWindow }: IpcDeps): void {
  ipcMain.handle('terminal:create', async (event, cwd: string) => {
    assertAppOrigin(event);
    const win = getMainWindow();
    if (!win) return null;
    return terminalService.create(await assertAllowedRoot(cwd), win);
  });
  ipcMain.handle('terminal:write', (event, id: string, data: string) => {
    assertAppOrigin(event);
    return terminalService.write(id, data);
  });
  ipcMain.handle('terminal:resize', (event, id: string, cols: number, rows: number) => {
    assertAppOrigin(event);
    return terminalService.resize(id, cols, rows);
  });
  ipcMain.handle('terminal:close', (event, id: string) => {
    assertAppOrigin(event);
    return terminalService.close(id);
  });
  ipcMain.handle('terminal:runCommand', async (event, cwd: string, command: string, timeoutMs?: number) => {
    assertAppOrigin(event);
    const risk = classifyCommand(String(command ?? ''));
    if (risk.dangerous) {
      await confirmDangerousAction(event, '确认执行高风险命令？', risk.reason || '该命令可能造成不可逆影响', String(command ?? '').slice(0, 1200));
    }
    return terminalService.runCommand(await assertAllowedRoot(cwd), command, timeoutMs);
  });
  ipcMain.handle('terminal:runBackgroundCommand', async (event, cwd: string, command: string) => {
    assertAppOrigin(event);
    const risk = classifyCommand(String(command ?? ''));
    if (risk.dangerous) {
      await confirmDangerousAction(event, '确认后台执行高风险命令？', risk.reason || '该命令可能造成不可逆影响', String(command ?? '').slice(0, 1200));
    }
    return terminalService.startBackgroundCommand(await assertAllowedRoot(cwd), command);
  });
  ipcMain.handle('terminal:getBackgroundOutput', (event, id: string) => {
    assertAppOrigin(event);
    return terminalService.getBackgroundOutput(id);
  });
  ipcMain.handle('terminal:killBackgroundCommand', (event, id: string) => {
    assertAppOrigin(event);
    return terminalService.killBackgroundCommand(id);
  });
}

function registerStoreIpc({ storeService }: IpcDeps): void {
  ipcMain.handle('store:get', (event, key: string) => {
    assertAppOrigin(event);
    return storeService.get(assertAllowedStoreKey(key));
  });
  ipcMain.handle('store:set', (event, key: string, value: unknown) => {
    assertAppOrigin(event);
    return storeService.set(assertAllowedStoreKey(key), value);
  });
  ipcMain.handle('store:encryptAndStore', (event, key: string, value: string) => {
    assertAppOrigin(event);
    const safeKey = assertAllowedSecretWriteKey(key);
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(value);
      storeService.set(safeKey, encrypted.toString('base64'));
      return true;
    }
    return false;
  });
  ipcMain.handle('store:decryptAndGet', (event, key: string) => {
    assertAppOrigin(event);
    const safeKey = assertAllowedSecretReadKey(key);
    const encrypted = storeService.get(safeKey) as string | undefined;
    if (!encrypted) return null;
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
    }
    return null;
  });
  ipcMain.handle('store:hasSecret', (event, key: string) => {
    assertAppOrigin(event);
    // Only the GitHub token needs a presence check from the renderer; provider
    // keys are managed via settings and never need a renderer presence probe.
    if (key !== 'github_token') throw new Error(`拒绝访问通用 secret: ${key}`);
    const encrypted = storeService.get(key) as string | undefined;
    return Boolean(encrypted);
  });
}

function registerAIIpc({ aiService }: IpcDeps): void {
  ipcMain.handle('ai:chat', (event, providerId: string, messages: unknown[], options: unknown) => {
    assertAppOrigin(event);
    return aiService.chat(providerId, messages as any, options as any);
  });
  ipcMain.handle('ai:chatStream', async (event, callId: string | undefined, providerId: string, messages: unknown[], options: unknown) => {
    assertAppOrigin(event);
    const sender = event.sender;
    const senderId = sender.id;
    // Each stream is keyed by a caller-provided callId so concurrent streams on
    // the same window can be aborted independently. Fall back to a generated id
    // for callers that don't supply one (then abort must use the sender-level path).
    const reqId = callId || `gen_${senderId}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const safeSend = (channel: string, ...args: unknown[]) => {
      try {
        if (!sender.isDestroyed()) sender.send(channel, ...args);
      } catch {
        // Window was closed during streaming, ignore
      }
    };
    await aiService.chatStream(reqId, senderId, providerId, messages as any, options as any, {
      onToken: (token: string) => safeSend('ai:stream-token', reqId, token),
      onToolCall: (toolCall: unknown) => safeSend('ai:stream-tool-call', reqId, toolCall),
      onComplete: (result: unknown) => safeSend('ai:stream-complete', reqId, result),
      onError: (error: string) => safeSend('ai:stream-error', reqId, error),
    });
  });
  ipcMain.handle('ai:abort', (event, callId?: string) => {
    assertAppOrigin(event);
    if (callId) {
      // Abort a single request.
      aiService.abort(callId);
    } else {
      // No id given: abort every in-flight stream from this sender (legacy stop-all).
      aiService.abortSender(event.sender.id);
    }
  });
  ipcMain.handle('ai:testConnection', (event, providerId: string) => {
    assertAppOrigin(event);
    return aiService.testConnection(providerId);
  });
  ipcMain.handle('ai:fimComplete', (event, req: unknown) => {
    assertAppOrigin(event);
    return aiService.fimComplete(req as any);
  });
  ipcMain.handle('ai:supportsFim', (event, providerId: string, model: string) => {
    assertAppOrigin(event);
    return aiService.supportsFim(providerId, model);
  });
}

function registerGitIpc({ gitService }: IpcDeps): void {
  ipcMain.handle('git:status', async (event, cwd: string) => { assertAppOrigin(event); return gitService.status(await assertAllowedRoot(cwd)); });
  ipcMain.handle('git:diff', async (event, cwd: string, staged?: boolean, filePath?: string) => {
    assertAppOrigin(event);
    const safeCwd = await assertAllowedRoot(cwd);
    const safeFile = filePath ? await assertAllowedPath(filePath) : undefined;
    return gitService.diff(safeCwd, staged, safeFile);
  });
  ipcMain.handle('git:log', async (event, cwd: string, count?: number) => { assertAppOrigin(event); return gitService.log(await assertAllowedRoot(cwd), count); });
  ipcMain.handle('git:stage', async (event, cwd: string, files: string[]) => { assertAppOrigin(event); return gitService.stage(await assertAllowedRoot(cwd), files); });
  ipcMain.handle('git:unstage', async (event, cwd: string, files: string[]) => { assertAppOrigin(event); return gitService.unstage(await assertAllowedRoot(cwd), files); });
  ipcMain.handle('git:stageAll', async (event, cwd: string) => { assertAppOrigin(event); return gitService.stageAll(await assertAllowedRoot(cwd)); });
  ipcMain.handle('git:commit', async (event, cwd: string, message: string) => {
    assertAppOrigin(event);
    return gitService.commit(await assertAllowedRoot(cwd), message);
  });
  ipcMain.handle('git:push', async (event, cwd: string, remote?: string, branch?: string) => {
    assertAppOrigin(event);
    const safeRemote = remote ? assertSafeGitRef(remote, 'remote') : undefined;
    const safeBranch = branch ? assertSafeGitRef(branch, 'branch') : undefined;
    return gitService.push(await assertAllowedRoot(cwd), safeRemote, safeBranch);
  });
  ipcMain.handle('git:pull', async (event, cwd: string, remote?: string, branch?: string) => {
    assertAppOrigin(event);
    const safeRemote = remote ? assertSafeGitRef(remote, 'remote') : undefined;
    const safeBranch = branch ? assertSafeGitRef(branch, 'branch') : undefined;
    return gitService.pull(await assertAllowedRoot(cwd), safeRemote, safeBranch);
  });
  ipcMain.handle('git:branchList', async (event, cwd: string) => { assertAppOrigin(event); return gitService.branchList(await assertAllowedRoot(cwd)); });
  ipcMain.handle('git:branchSwitch', async (event, cwd: string, name: string) => {
    assertAppOrigin(event);
    return gitService.branchSwitch(await assertAllowedRoot(cwd), assertSafeGitRef(name, 'branch'));
  });
  ipcMain.handle('git:branchCreate', async (event, cwd: string, name: string) => {
    assertAppOrigin(event);
    return gitService.branchCreate(await assertAllowedRoot(cwd), assertSafeGitRef(name, 'branch'));
  });
  ipcMain.handle('git:currentBranch', async (event, cwd: string) => { assertAppOrigin(event); return gitService.currentBranch(await assertAllowedRoot(cwd)); });
  ipcMain.handle('git:worktreeAdd', async (event, cwd: string, p: string, name: string, base?: string) => {
    assertAppOrigin(event);
    const safeCwd = await assertAllowedRoot(cwd);
    const safePath = await assertAllowedWorktreePath(safeCwd, p);
    const res = await gitService.worktreeAdd(safeCwd, safePath, name, base);
    if (res.success && res.path) await allowRoot(res.path);
    return res;
  });
  ipcMain.handle('git:authorizeWorktrees', async (event, cwd: string) => {
    assertAppOrigin(event);
    const safeCwd = await assertAllowedRoot(cwd);
    const trees = await gitService.worktreeList(safeCwd);
    const authorized: string[] = [];
    for (const tree of trees) {
      if (!tree.path) continue;
      try {
        authorized.push(await allowRoot(tree.path));
      } catch {
        // stale/missing worktree path; ignore and keep authorizing the rest
      }
    }
    return authorized;
  });
  ipcMain.handle('git:worktreeList', async (event, cwd: string) => { assertAppOrigin(event); return gitService.worktreeList(await assertAllowedRoot(cwd)); });
  ipcMain.handle('git:worktreeRemove', async (event, cwd: string, p: string, deleteBranch?: string) => {
    assertAppOrigin(event);
    const safeBranch = deleteBranch ? assertSafeGitRef(deleteBranch, 'deleteBranch') : undefined;
    await confirmDangerousAction(
      event,
      '确认删除隔离工作树？',
      safeBranch ? `将强制删除 worktree，并删除分支 ${safeBranch}` : '将强制删除 worktree',
      String(p)
    );
    return gitService.worktreeRemove(await assertAllowedRoot(cwd), await assertAllowedRoot(p), safeBranch);
  });
  ipcMain.handle('git:worktreePrune', async (event, cwd: string) => { assertAppOrigin(event); return gitService.worktreePrune(await assertAllowedRoot(cwd)); });
  ipcMain.handle('git:worktreeMerge', async (event, cwd: string, sourceBranch: string, method: string, targetBranch?: string) => {
    assertAppOrigin(event);
    const safeMethod = assertMergeMethod(method);
    const safeSource = assertSafeGitRef(sourceBranch, 'sourceBranch');
    const safeTarget = targetBranch ? assertSafeGitRef(targetBranch, 'targetBranch') : undefined;
    return gitService.worktreeMerge(await assertAllowedRoot(cwd), safeSource, safeMethod, safeTarget);
  });
  ipcMain.handle('git:worktreeMergeDiff', async (event, cwd: string, baseBranch: string, headBranch: string) => {
    assertAppOrigin(event);
    return gitService.worktreeMergeDiff(
      await assertAllowedRoot(cwd),
      assertSafeGitRef(baseBranch, 'baseBranch'),
      assertSafeGitRef(headBranch, 'headBranch')
    );
  });
}

function registerWebIpc({ webService }: IpcDeps): void {
  ipcMain.handle('web:search', (event, query: string, count?: number) => {
    assertAppOrigin(event);
    return webService.search(query, count);
  });
  ipcMain.handle('web:fetch', (event, url: string, extractMode?: 'markdown' | 'text') => {
    assertAppOrigin(event);
    return webService.fetchUrl(url, extractMode);
  });
}

function registerGitHubIpc({ githubService, storeService }: IpcDeps): void {
  // The renderer never holds the GitHub token. Every github:* handler resolves
  // the stored token inside the main process; no token crosses the IPC boundary.
  async function resolveToken(): Promise<string> {
    const encrypted = storeService.get('github_token') as string | undefined;
    if (!encrypted) throw new Error('未配置 GitHub token');
    if (!safeStorage.isEncryptionAvailable()) throw new Error('无法解密 GitHub token');
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
  }
  ipcMain.handle('github:listIssues', async (event, owner: string, repo: string, state?: string) => {
    assertAppOrigin(event);
    const token = await resolveToken();
    return githubService.listIssues(token, owner, repo, state as any);
  });
  ipcMain.handle('github:getIssue', async (event, owner: string, repo: string, number: number) => {
    assertAppOrigin(event);
    const token = await resolveToken();
    return githubService.getIssue(token, owner, repo, number);
  });
  ipcMain.handle(
    'github:createIssue',
    async (event, owner: string, repo: string, title: string, body?: string, labels?: string[]) => {
      assertAppOrigin(event);
      const token = await resolveToken();
      return githubService.createIssue(token, owner, repo, title, body || '', labels || []);
    }
  );
  ipcMain.handle('github:listIssueComments', async (event, owner: string, repo: string, number: number) => {
    assertAppOrigin(event);
    const token = await resolveToken();
    return githubService.listIssueComments(token, owner, repo, number);
  });
  ipcMain.handle(
    'github:addIssueComment',
    async (event, owner: string, repo: string, number: number, body: string) => {
      assertAppOrigin(event);
      const token = await resolveToken();
      return githubService.addIssueComment(token, owner, repo, number, body);
    }
  );
  ipcMain.handle('github:listPRs', async (event, owner: string, repo: string, state?: string) => {
    assertAppOrigin(event);
    const token = await resolveToken();
    return githubService.listPRs(token, owner, repo, state as any);
  });
  ipcMain.handle('github:getPR', async (event, owner: string, repo: string, number: number) => {
    assertAppOrigin(event);
    const token = await resolveToken();
    return githubService.getPR(token, owner, repo, number);
  });
  ipcMain.handle('github:getPRDiff', async (event, owner: string, repo: string, number: number) => {
    assertAppOrigin(event);
    const token = await resolveToken();
    return githubService.getPRDiff(token, owner, repo, number);
  });
  ipcMain.handle(
    'github:createPR',
    async (event, owner: string, repo: string, title: string, head: string, base: string, body?: string) => {
      assertAppOrigin(event);
      const token = await resolveToken();
      return githubService.createPR(token, owner, repo, title, head, base, body || '');
    }
  );
  ipcMain.handle('github:listWorkflowRuns', async (event, owner: string, repo: string, branch?: string) => {
    assertAppOrigin(event);
    const token = await resolveToken();
    return githubService.listWorkflowRuns(token, owner, repo, branch);
  });
  ipcMain.handle('github:searchCode', async (event, query: string, owner?: string, repo?: string) => {
    assertAppOrigin(event);
    const token = await resolveToken();
    return githubService.searchCode(token, query, owner, repo);
  });
  ipcMain.handle('github:getRepo', async (event, owner: string, repo: string) => {
    assertAppOrigin(event);
    const token = await resolveToken();
    return githubService.getRepo(token, owner, repo);
  });
  ipcMain.handle('github:parseRemote', (event, remoteUrl: string) => {
    assertAppOrigin(event);
    return githubService.parseRemoteUrl(remoteUrl);
  });
  ipcMain.handle(
    'github:createReview',
    async (event, owner: string, repo: string, number: number, eventName: string, body?: string, comments?: any[]) => {
      assertAppOrigin(event);
      const token = await resolveToken();
      return githubService.createReview(token, owner, repo, number, eventName, body || '', comments);
    }
  );
  ipcMain.handle('github:mergePR', async (event, owner: string, repo: string, number: number, method?: string) => {
    assertAppOrigin(event);
    const token = await resolveToken();
    return githubService.mergePR(token, owner, repo, number, method);
  });
  ipcMain.handle(
    'github:createRelease',
    async (event, owner: string, repo: string, tag: string, name?: string, body?: string, draft?: boolean) => {
      assertAppOrigin(event);
      const token = await resolveToken();
      return githubService.createRelease(token, owner, repo, tag, name || tag, body || '', draft || false);
    }
  );
}

function registerAnalysisIpc({ analysisService }: IpcDeps): void {
  ipcMain.handle('lint:run', async (event, cwd: string, filePath?: string) => { assertAppOrigin(event); return analysisService.runLint(await assertAllowedRoot(cwd), filePath ? await assertAllowedPath(filePath) : undefined); });
  ipcMain.handle('lint:check', async (event, cwd: string, files?: string[]) => { assertAppOrigin(event); return analysisService.checkLint(await assertAllowedRoot(cwd), files ? await Promise.all(files.map((f) => assertAllowedPath(f))) : undefined); });
  ipcMain.handle('symbols:extract', async (event, filePath: string) => { assertAppOrigin(event); return analysisService.extractSymbols(await assertAllowedPath(filePath)); });
}

function registerContextIpc({ storeService }: IpcDeps): void {
  const CONTEXT_KEY = 'agentContextMemory'; // Legacy storage key; keep for compatibility.
  const readContextStore = (): Record<string, string> =>
    (storeService.get(CONTEXT_KEY) as Record<string, string>) || {};

  ipcMain.handle('context:save', async (event, key: string, content: string, merge?: boolean) => {
    assertAppOrigin(event);
    // Atomic read-modify-write: concurrent saves (e.g. parallel agents) must
    // not lose updates. storeService.transaction serializes the RMW.
    await storeService.transaction(CONTEXT_KEY, (current) => {
      const store = (current as Record<string, string>) || {};
      if (merge && store[key]) {
        store[key] = store[key] + '\n\n' + content;
      } else {
        store[key] = content;
      }
      return store;
    });
  });
  ipcMain.handle('context:load', (event, key: string) => {
    assertAppOrigin(event);
    return readContextStore()[key] || null;
  });
  ipcMain.handle('context:list', (event) => {
    assertAppOrigin(event);
    return Object.keys(readContextStore());
  });
}

function registerRulesIpc(): void {
  // Load project-level task rules (like Cursor's .cursorrules / AGENTS.md).
  // The first existing file wins; content is appended to the task system prompt.
  ipcMain.handle('rules:load', async (event, root: string) => {
    assertAppOrigin(event);
    const safeRoot = await assertAllowedRoot(root);
    const candidates = [
      'AGENTS.md',
      '.cursorrules',
      '.cursor/rules',
      '.github/copilot-instructions.md',
      'CLAUDE.md',
    ];
    for (const rel of candidates) {
      try {
        const content = await fs.readFile(path.join(safeRoot, rel), 'utf-8');
        if (content.trim()) return { file: rel, content: content.slice(0, 8000) };
      } catch {
        // not present, try next
      }
    }
    return null;
  });
}

function registerCodebaseIpc({ codebaseSearchService }: IpcDeps): void {
  ipcMain.handle('codebase:search', async (event, root: string, query: string, limit?: number) => {
    assertAppOrigin(event);
    return codebaseSearchService.search(await assertAllowedRoot(root), query, limit);
  });
  ipcMain.handle('codebase:reindex', async (event, root: string) => { assertAppOrigin(event); return codebaseSearchService.reindex(await assertAllowedRoot(root)); });
  ipcMain.handle('codeintel:definition', async (event, root: string, name: string) => {
    assertAppOrigin(event);
    return codebaseSearchService.findDefinition(await assertAllowedRoot(root), name);
  });
  ipcMain.handle('codeintel:references', async (event, root: string, name: string) => {
    assertAppOrigin(event);
    return codebaseSearchService.findReferences(await assertAllowedRoot(root), name);
  });
}

function registerCliAgentIpc({ cliAgentService }: IpcDeps): void {
  // Per-callId AbortControllers so a `cliagent:cancel` from the renderer can
  // SIGTERM a specific in-flight CLI run. Without this, a cancelled agent run
  // keeps its claude/codex subprocess alive until the 5-minute hard timeout.
  const cliAbortControllers = new Map<string, AbortController>();

  ipcMain.handle('cliagent:cancel', (event, callId: string) => {
    assertAppOrigin(event);
    const controller = cliAbortControllers.get(callId);
    if (controller) {
      try {
        controller.abort();
      } catch {
        /* already aborted */
      }
      cliAbortControllers.delete(callId);
    }
  });

  ipcMain.handle('cliagent:run', async (event, cwd: string, params: unknown) => {
    assertAppOrigin(event);
    const safeCwd = await assertAllowedRoot(cwd);
    const p = (params || {}) as {
      tool?: unknown;
      prompt?: unknown;
      model?: unknown;
      baseURL?: unknown;
      apiKey?: unknown;
      allowDangerousBypass?: unknown;
    };
    if (p.tool !== 'claude-code' && p.tool !== 'codex' && p.tool !== 'antigravity' && p.tool !== 'opencode') {
      return { ok: false, output: '', error: `未知 CLI agent: ${String(p.tool)}` };
    }
    await confirmDangerousAction(
      event,
      '确认启动外部 CLI Agent？',
      p.allowDangerousBypass ? `${p.tool} 将使用权限绕过参数运行，可能读写工作区并执行命令。` : `${p.tool} 将不使用权限绕过参数运行；如 CLI 要求确认，可能会中止或等待。`,
      String(p.prompt ?? '').slice(0, 1200)
    );
    return cliAgentService.run({
      tool: p.tool,
      cwd: safeCwd,
      prompt: String(p.prompt ?? ''),
      model: p.model ? String(p.model) : undefined,
      baseURL: p.baseURL ? String(p.baseURL) : undefined,
      apiKey: p.apiKey ? String(p.apiKey) : undefined,
      allowDangerousBypass: p.allowDangerousBypass === true,
    });
  });

  // Streaming variant. The caller passes a callId (renderer-side uuid). Events
  // arrive on per-call channels `cliagent:stream-<callId>` so multiple parallel
  // CLI runs don't interleave. Final {ok, output, error, errorKind} is sent on
  // the 'complete' event AND returned from the invoke (for the caller's await).
  ipcMain.handle('cliagent:runStream', async (event, callId: string, cwd: string, params: unknown) => {
    assertAppOrigin(event);
    const safeCwd = await assertAllowedRoot(cwd);
    const sender = event.sender;
    const safeSend = (channel: string, payload: unknown) => {
      try {
        if (!sender.isDestroyed()) sender.send(channel, payload);
      } catch {
        // window closed mid-stream
      }
    };
    const p = (params || {}) as {
      tool?: unknown;
      prompt?: unknown;
      model?: unknown;
      baseURL?: unknown;
      apiKey?: unknown;
      allowDangerousBypass?: unknown;
    };
    const channel = `cliagent:stream-${callId}`;
    if (p.tool !== 'claude-code' && p.tool !== 'codex' && p.tool !== 'antigravity' && p.tool !== 'opencode') {
      const err: CliAgentResult = { ok: false, output: '', error: `未知 CLI agent: ${String(p.tool)}` };
      safeSend(channel, { type: 'complete', result: err });
      return err;
    }
    await confirmDangerousAction(
      event,
      '确认启动外部 CLI Agent？',
      p.allowDangerousBypass ? `${p.tool} 将使用权限绕过参数运行，可能读写工作区并执行命令。` : `${p.tool} 将不使用权限绕过参数运行；如 CLI 要求确认，可能会中止或等待。`,
      String(p.prompt ?? '').slice(0, 1200)
    );
    const controller = new AbortController();
    cliAbortControllers.set(callId, controller);
    return cliAgentService
      .runStream(
        {
          tool: p.tool,
          cwd: safeCwd,
          prompt: String(p.prompt ?? ''),
          model: p.model ? String(p.model) : undefined,
          baseURL: p.baseURL ? String(p.baseURL) : undefined,
          apiKey: p.apiKey ? String(p.apiKey) : undefined,
          allowDangerousBypass: p.allowDangerousBypass === true,
        },
        {
          onStart: () => safeSend(channel, { type: 'start' }),
          onStdout: (chunk: string) => safeSend(channel, { type: 'stdout', chunk }),
          onStderr: (chunk: string) => safeSend(channel, { type: 'stderr', chunk }),
          onExit: (code: number | null, signal: NodeJS.Signals | null) =>
            safeSend(channel, { type: 'exit', code, signal }),
          onError: (kind: unknown, message: string) =>
            safeSend(channel, { type: 'error', kind, message }),
        },
        { signal: controller.signal }
      )
      .then((result: CliAgentResult) => {
        cliAbortControllers.delete(callId);
        safeSend(channel, { type: 'complete', result });
        return result;
      })
      .catch((err) => {
        cliAbortControllers.delete(callId);
        throw err;
      });
  });
}

function registerSkillsIpc({ skillsService }: IpcDeps): void {
  ipcMain.handle('skills:list', async (event, root: string) => {
    assertAppOrigin(event);
    return skillsService.list(await assertAllowedRoot(root));
  });
  ipcMain.handle('skills:read', async (event, root: string, name: string) => {
    assertAppOrigin(event);
    return skillsService.read(await assertAllowedRoot(root), String(name));
  });
}
