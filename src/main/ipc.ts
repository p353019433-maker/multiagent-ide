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

const allowedRoots = new Set<string>();

async function canonical(p: string): Promise<string> {
  const resolved = path.resolve(p);
  try {
    return await fs.realpath(resolved);
  } catch {
    const parent = await fs.realpath(path.dirname(resolved));
    return path.join(parent, path.basename(resolved));
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
  if (url.startsWith('file://')) return;
  if (url.startsWith('http://localhost:5173/') || url.startsWith('http://127.0.0.1:5173/')) return;
  throw new Error(`拒绝来自非应用页面的 IPC: ${url}`);
}


const ALLOWED_STORE_KEYS = new Set([
  'providers',
  'activeProviderId',
  'activeModel',
  'approvalMode',
  'embeddingConfig',
  'rerankConfig',
  'conversationIndex',
]);

function assertAllowedStoreKey(key: string): string {
  if (ALLOWED_STORE_KEYS.has(key) || key.startsWith('conv:')) return key;
  throw new Error(`拒绝访问 store key: ${key}`);
}

function assertAllowedSecretKey(key: string): string {
  if (key === 'github_token' || key.startsWith('apiKey:')) return key;
  throw new Error('拒绝访问通用 secret');
}

function assertSafeGitRef(ref: string, label: string): string {
  if (!ref || ref.length > 200 || /[\0\n\r~^:?*[\\]/.test(ref) || ref.includes('..') || ref.endsWith('.lock')) {
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
    return terminalService.runCommand(await assertAllowedRoot(cwd), command, timeoutMs);
  });
  ipcMain.handle('terminal:runBackgroundCommand', async (event, cwd: string, command: string) => {
    assertAppOrigin(event);
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
    const safeKey = assertAllowedSecretKey(key);
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(value);
      storeService.set(safeKey, encrypted.toString('base64'));
      return true;
    }
    return false;
  });
  ipcMain.handle('store:decryptAndGet', (event, key: string) => {
    assertAppOrigin(event);
    const safeKey = assertAllowedSecretKey(key);
    const encrypted = storeService.get(safeKey) as string | undefined;
    if (!encrypted) return null;
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
    }
    return null;
  });
}

function registerAIIpc({ aiService }: IpcDeps): void {
  ipcMain.handle('ai:chat', (event, providerId: string, messages: unknown[], options: unknown) => {
    assertAppOrigin(event);
    return aiService.chat(providerId, messages as any, options as any);
  });
  ipcMain.handle('ai:chatStream', async (event, providerId: string, messages: unknown[], options: unknown) => {
    assertAppOrigin(event);
    const sender = event.sender;
    const senderId = sender.id;
    const safeSend = (channel: string, ...args: unknown[]) => {
      try {
        if (!sender.isDestroyed()) sender.send(channel, ...args);
      } catch {
        // Window was closed during streaming, ignore
      }
    };
    await aiService.chatStream(senderId, providerId, messages as any, options as any, {
      onToken: (token: string) => safeSend('ai:stream-token', token),
      onToolCall: (toolCall: unknown) => safeSend('ai:stream-tool-call', toolCall),
      onComplete: (result: unknown) => safeSend('ai:stream-complete', result),
      onError: (error: string) => safeSend('ai:stream-error', error),
    });
  });
  ipcMain.handle('ai:abort', (event) => {
    assertAppOrigin(event);
    aiService.abort(event.sender.id);
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
  ipcMain.handle('git:commit', async (event, cwd: string, message: string) => { assertAppOrigin(event); return gitService.commit(await assertAllowedRoot(cwd), message); });
  ipcMain.handle('git:push', async (event, cwd: string, remote?: string, branch?: string) => {
    assertAppOrigin(event);
    return gitService.push(await assertAllowedRoot(cwd), remote, branch);
  });
  ipcMain.handle('git:pull', async (event, cwd: string, remote?: string, branch?: string) => {
    assertAppOrigin(event);
    return gitService.pull(await assertAllowedRoot(cwd), remote, branch);
  });
  ipcMain.handle('git:branchList', async (event, cwd: string) => { assertAppOrigin(event); return gitService.branchList(await assertAllowedRoot(cwd)); });
  ipcMain.handle('git:branchSwitch', async (event, cwd: string, name: string) => { assertAppOrigin(event); return gitService.branchSwitch(await assertAllowedRoot(cwd), name); });
  ipcMain.handle('git:branchCreate', async (event, cwd: string, name: string) => { assertAppOrigin(event); return gitService.branchCreate(await assertAllowedRoot(cwd), name); });
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
  ipcMain.handle('git:worktreeRemove', async (event, cwd: string, p: string, deleteBranch?: string) => { assertAppOrigin(event); return gitService.worktreeRemove(await assertAllowedRoot(cwd), await assertAllowedRoot(p), deleteBranch); });
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

function registerGitHubIpc({ githubService }: IpcDeps): void {
  ipcMain.handle('github:listIssues', (event, token: string, owner: string, repo: string, state?: string) => {
    assertAppOrigin(event);
    return githubService.listIssues(token, owner, repo, state as any);
  });
  ipcMain.handle('github:getIssue', (event, token: string, owner: string, repo: string, number: number) => {
    assertAppOrigin(event);
    return githubService.getIssue(token, owner, repo, number);
  });
  ipcMain.handle(
    'github:createIssue',
    (event, token: string, owner: string, repo: string, title: string, body?: string, labels?: string[]) => {
      assertAppOrigin(event);
      return githubService.createIssue(token, owner, repo, title, body || '', labels || []);
    }
  );
  ipcMain.handle('github:listIssueComments', (event, token: string, owner: string, repo: string, number: number) => {
    assertAppOrigin(event);
    return githubService.listIssueComments(token, owner, repo, number);
  });
  ipcMain.handle(
    'github:addIssueComment',
    (event, token: string, owner: string, repo: string, number: number, body: string) => {
      assertAppOrigin(event);
      return githubService.addIssueComment(token, owner, repo, number, body);
    }
  );
  ipcMain.handle('github:listPRs', (event, token: string, owner: string, repo: string, state?: string) => {
    assertAppOrigin(event);
    return githubService.listPRs(token, owner, repo, state as any);
  });
  ipcMain.handle('github:getPR', (event, token: string, owner: string, repo: string, number: number) => {
    assertAppOrigin(event);
    return githubService.getPR(token, owner, repo, number);
  });
  ipcMain.handle('github:getPRDiff', (event, token: string, owner: string, repo: string, number: number) => {
    assertAppOrigin(event);
    return githubService.getPRDiff(token, owner, repo, number);
  });
  ipcMain.handle(
    'github:createPR',
    (event, token: string, owner: string, repo: string, title: string, head: string, base: string, body?: string) => {
      assertAppOrigin(event);
      return githubService.createPR(token, owner, repo, title, head, base, body || '');
    }
  );
  ipcMain.handle('github:listWorkflowRuns', (event, token: string, owner: string, repo: string, branch?: string) => {
    assertAppOrigin(event);
    return githubService.listWorkflowRuns(token, owner, repo, branch);
  });
  ipcMain.handle('github:searchCode', (event, token: string, query: string, owner?: string, repo?: string) => {
    assertAppOrigin(event);
    return githubService.searchCode(token, query, owner, repo);
  });
  ipcMain.handle('github:getRepo', (event, token: string, owner: string, repo: string) => {
    assertAppOrigin(event);
    return githubService.getRepo(token, owner, repo);
  });
  ipcMain.handle('github:parseRemote', (event, remoteUrl: string) => {
    assertAppOrigin(event);
    return githubService.parseRemoteUrl(remoteUrl);
  });
  ipcMain.handle(
    'github:createReview',
    (event, token: string, owner: string, repo: string, number: number, eventName: string, body?: string, comments?: any[]) => {
      assertAppOrigin(event);
      return githubService.createReview(token, owner, repo, number, eventName, body || '', comments);
    }
  );
  ipcMain.handle('github:mergePR', (event, token: string, owner: string, repo: string, number: number, method?: string) => {
    assertAppOrigin(event);
    return githubService.mergePR(token, owner, repo, number, method);
  });
  ipcMain.handle(
    'github:createRelease',
    (event, token: string, owner: string, repo: string, tag: string, name?: string, body?: string, draft?: boolean) => {
      assertAppOrigin(event);
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
  const CONTEXT_KEY = 'agentContextMemory';
  const readContextStore = (): Record<string, string> =>
    (storeService.get(CONTEXT_KEY) as Record<string, string>) || {};

  ipcMain.handle('context:save', (event, key: string, content: string, merge?: boolean) => {
    assertAppOrigin(event);
    const store = readContextStore();
    if (merge && store[key]) {
      store[key] = store[key] + '\n\n' + content;
    } else {
      store[key] = content;
    }
    storeService.set(CONTEXT_KEY, store);
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
  // Load project-level agent rules (like Cursor's .cursorrules / AGENTS.md).
  // The first existing file wins; content is appended to the agent system prompt.
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
