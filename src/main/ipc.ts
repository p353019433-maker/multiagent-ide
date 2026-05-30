/**
 * IPC registration, split by domain. Extracted from index.ts's monolithic
 * setupIPC(). Each registerXxxIpc function wires one domain's channels to its
 * service; registerIpc() calls them all. Behavior is identical to the original.
 */

import { ipcMain, dialog, safeStorage, BrowserWindow } from 'electron';
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
  ipcMain.handle('dialog:openFolder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (result.canceled) return null;
    return result.filePaths[0];
  });
}

function registerFileSystemIpc({ fileService }: IpcDeps): void {
  ipcMain.handle('fs:readDirectory', (_, dirPath: string) => fileService.readDirectory(dirPath));
  ipcMain.handle('fs:readFile', (_, filePath: string) => fileService.readFile(filePath));
  ipcMain.handle('fs:writeFile', (_, filePath: string, content: string) =>
    fileService.writeFile(filePath, content)
  );
  ipcMain.handle('fs:createFile', (_, filePath: string) => fileService.createFile(filePath));
  ipcMain.handle('fs:createDirectory', (_, dirPath: string) => fileService.createDirectory(dirPath));
  ipcMain.handle('fs:delete', (_, targetPath: string) => fileService.delete(targetPath));
  ipcMain.handle('fs:rename', (_, oldPath: string, newPath: string) =>
    fileService.rename(oldPath, newPath)
  );
  ipcMain.handle('fs:searchFiles', (_, rootPath: string, query: string) =>
    fileService.searchFiles(rootPath, query)
  );
  ipcMain.handle('fs:findFiles', (_, rootPath: string, pattern: string) =>
    fileService.findFiles(rootPath, pattern)
  );
  ipcMain.handle('fs:getFileInfo', (_, filePath: string) => fileService.getFileInfo(filePath));
  ipcMain.handle('fs:readMultipleFiles', async (_, paths: string[]) => {
    const results: Record<string, string> = {};
    for (const p of paths) {
      try {
        results[p] = await fileService.readFile(p);
      } catch {
        results[p] = `[读取失败：${p}]`;
      }
    }
    return results;
  });
}

function registerTerminalIpc({ terminalService, getMainWindow }: IpcDeps): void {
  ipcMain.handle('terminal:create', (_, cwd: string) => {
    const win = getMainWindow();
    if (!win) return null;
    return terminalService.create(cwd, win);
  });
  ipcMain.handle('terminal:write', (_, id: string, data: string) => terminalService.write(id, data));
  ipcMain.handle('terminal:resize', (_, id: string, cols: number, rows: number) =>
    terminalService.resize(id, cols, rows)
  );
  ipcMain.handle('terminal:close', (_, id: string) => terminalService.close(id));
  ipcMain.handle('terminal:runCommand', (_, cwd: string, command: string, timeoutMs?: number) =>
    terminalService.runCommand(cwd, command, timeoutMs)
  );
  ipcMain.handle('terminal:runBackgroundCommand', (_, cwd: string, command: string) =>
    terminalService.startBackgroundCommand(cwd, command)
  );
  ipcMain.handle('terminal:getBackgroundOutput', (_, id: string) =>
    terminalService.getBackgroundOutput(id)
  );
  ipcMain.handle('terminal:killBackgroundCommand', (_, id: string) =>
    terminalService.killBackgroundCommand(id)
  );
}

function registerStoreIpc({ storeService }: IpcDeps): void {
  ipcMain.handle('store:get', (_, key: string) => storeService.get(key));
  ipcMain.handle('store:set', (_, key: string, value: unknown) => storeService.set(key, value));
  ipcMain.handle('store:encryptAndStore', (_, key: string, value: string) => {
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(value);
      storeService.set(key, encrypted.toString('base64'));
      return true;
    }
    return false;
  });
  ipcMain.handle('store:decryptAndGet', (_, key: string) => {
    const encrypted = storeService.get(key) as string | undefined;
    if (!encrypted) return null;
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
    }
    return null;
  });
}

function registerAIIpc({ aiService }: IpcDeps): void {
  ipcMain.handle('ai:chat', (_, providerId: string, messages: unknown[], options: unknown) =>
    aiService.chat(providerId, messages as any, options as any)
  );
  ipcMain.handle('ai:chatStream', async (event, providerId: string, messages: unknown[], options: unknown) => {
    const sender = event.sender;
    const safeSend = (channel: string, ...args: unknown[]) => {
      try {
        if (!sender.isDestroyed()) sender.send(channel, ...args);
      } catch {
        // Window was closed during streaming, ignore
      }
    };
    await aiService.chatStream(providerId, messages as any, options as any, {
      onToken: (token: string) => safeSend('ai:stream-token', token),
      onToolCall: (toolCall: unknown) => safeSend('ai:stream-tool-call', toolCall),
      onComplete: (result: unknown) => safeSend('ai:stream-complete', result),
      onError: (error: string) => safeSend('ai:stream-error', error),
    });
  });
  ipcMain.handle('ai:abort', () => aiService.abort());
  ipcMain.handle('ai:testConnection', (_, providerId: string) => aiService.testConnection(providerId));
  ipcMain.handle('ai:fimComplete', (_, req: unknown) => aiService.fimComplete(req as any));
  ipcMain.handle('ai:supportsFim', (_, providerId: string, model: string) =>
    aiService.supportsFim(providerId, model)
  );
}

function registerGitIpc({ gitService }: IpcDeps): void {
  ipcMain.handle('git:status', (_, cwd: string) => gitService.status(cwd));
  ipcMain.handle('git:diff', (_, cwd: string, staged?: boolean, filePath?: string) =>
    gitService.diff(cwd, staged, filePath)
  );
  ipcMain.handle('git:log', (_, cwd: string, count?: number) => gitService.log(cwd, count));
  ipcMain.handle('git:stage', (_, cwd: string, files: string[]) => gitService.stage(cwd, files));
  ipcMain.handle('git:unstage', (_, cwd: string, files: string[]) => gitService.unstage(cwd, files));
  ipcMain.handle('git:stageAll', (_, cwd: string) => gitService.stageAll(cwd));
  ipcMain.handle('git:commit', (_, cwd: string, message: string) => gitService.commit(cwd, message));
  ipcMain.handle('git:push', (_, cwd: string, remote?: string, branch?: string) =>
    gitService.push(cwd, remote, branch)
  );
  ipcMain.handle('git:pull', (_, cwd: string, remote?: string, branch?: string) =>
    gitService.pull(cwd, remote, branch)
  );
  ipcMain.handle('git:branchList', (_, cwd: string) => gitService.branchList(cwd));
  ipcMain.handle('git:branchSwitch', (_, cwd: string, name: string) => gitService.branchSwitch(cwd, name));
  ipcMain.handle('git:branchCreate', (_, cwd: string, name: string) => gitService.branchCreate(cwd, name));
  ipcMain.handle('git:currentBranch', (_, cwd: string) => gitService.currentBranch(cwd));
  ipcMain.handle('git:worktreeAdd', (_, cwd: string, p: string, name: string, base?: string) =>
    gitService.worktreeAdd(cwd, p, name, base)
  );
  ipcMain.handle('git:worktreeList', (_, cwd: string) => gitService.worktreeList(cwd));
  ipcMain.handle('git:worktreeRemove', (_, cwd: string, p: string) => gitService.worktreeRemove(cwd, p));
  ipcMain.handle('git:worktreePrune', (_, cwd: string) => gitService.worktreePrune(cwd));
  ipcMain.handle('git:worktreeMerge', (_, cwd: string, sourceBranch: string, method: string) =>
    gitService.worktreeMerge(cwd, sourceBranch, method as any)
  );
  ipcMain.handle('git:worktreeMergeDiff', (_, cwd: string, baseBranch: string, headBranch: string) =>
    gitService.worktreeMergeDiff(cwd, baseBranch, headBranch)
  );
}

function registerWebIpc({ webService }: IpcDeps): void {
  ipcMain.handle('web:search', (_, query: string, count?: number) => webService.search(query, count));
  ipcMain.handle('web:fetch', (_, url: string, extractMode?: 'markdown' | 'text') =>
    webService.fetchUrl(url, extractMode)
  );
}

function registerGitHubIpc({ githubService }: IpcDeps): void {
  ipcMain.handle('github:listIssues', (_, token: string, owner: string, repo: string, state?: string) =>
    githubService.listIssues(token, owner, repo, state as any)
  );
  ipcMain.handle('github:getIssue', (_, token: string, owner: string, repo: string, number: number) =>
    githubService.getIssue(token, owner, repo, number)
  );
  ipcMain.handle(
    'github:createIssue',
    (_, token: string, owner: string, repo: string, title: string, body?: string, labels?: string[]) =>
      githubService.createIssue(token, owner, repo, title, body || '', labels || [])
  );
  ipcMain.handle('github:listIssueComments', (_, token: string, owner: string, repo: string, number: number) =>
    githubService.listIssueComments(token, owner, repo, number)
  );
  ipcMain.handle(
    'github:addIssueComment',
    (_, token: string, owner: string, repo: string, number: number, body: string) =>
      githubService.addIssueComment(token, owner, repo, number, body)
  );
  ipcMain.handle('github:listPRs', (_, token: string, owner: string, repo: string, state?: string) =>
    githubService.listPRs(token, owner, repo, state as any)
  );
  ipcMain.handle('github:getPR', (_, token: string, owner: string, repo: string, number: number) =>
    githubService.getPR(token, owner, repo, number)
  );
  ipcMain.handle('github:getPRDiff', (_, token: string, owner: string, repo: string, number: number) =>
    githubService.getPRDiff(token, owner, repo, number)
  );
  ipcMain.handle(
    'github:createPR',
    (_, token: string, owner: string, repo: string, title: string, head: string, base: string, body?: string) =>
      githubService.createPR(token, owner, repo, title, head, base, body || '')
  );
  ipcMain.handle('github:listWorkflowRuns', (_, token: string, owner: string, repo: string, branch?: string) =>
    githubService.listWorkflowRuns(token, owner, repo, branch)
  );
  ipcMain.handle('github:searchCode', (_, token: string, query: string, owner?: string, repo?: string) =>
    githubService.searchCode(token, query, owner, repo)
  );
  ipcMain.handle('github:getRepo', (_, token: string, owner: string, repo: string) =>
    githubService.getRepo(token, owner, repo)
  );
  ipcMain.handle('github:parseRemote', (_, remoteUrl: string) => githubService.parseRemoteUrl(remoteUrl));
  ipcMain.handle(
    'github:createReview',
    (_, token: string, owner: string, repo: string, number: number, event: string, body?: string, comments?: any[]) =>
      githubService.createReview(token, owner, repo, number, event, body || '', comments)
  );
  ipcMain.handle('github:mergePR', (_, token: string, owner: string, repo: string, number: number, method?: string) =>
    githubService.mergePR(token, owner, repo, number, method)
  );
  ipcMain.handle(
    'github:createRelease',
    (_, token: string, owner: string, repo: string, tag: string, name?: string, body?: string, draft?: boolean) =>
      githubService.createRelease(token, owner, repo, tag, name || tag, body || '', draft || false)
  );
}

function registerAnalysisIpc({ analysisService }: IpcDeps): void {
  ipcMain.handle('lint:run', (_, cwd: string, filePath?: string) => analysisService.runLint(cwd, filePath));
  ipcMain.handle('lint:check', (_, cwd: string, files?: string[]) => analysisService.checkLint(cwd, files));
  ipcMain.handle('symbols:extract', (_, filePath: string) => analysisService.extractSymbols(filePath));
}

function registerContextIpc({ storeService }: IpcDeps): void {
  const CONTEXT_KEY = 'agentContextMemory';
  const readContextStore = (): Record<string, string> =>
    (storeService.get(CONTEXT_KEY) as Record<string, string>) || {};

  ipcMain.handle('context:save', (_, key: string, content: string, merge?: boolean) => {
    const store = readContextStore();
    if (merge && store[key]) {
      store[key] = store[key] + '\n\n' + content;
    } else {
      store[key] = content;
    }
    storeService.set(CONTEXT_KEY, store);
  });
  ipcMain.handle('context:load', (_, key: string) => readContextStore()[key] || null);
  ipcMain.handle('context:list', () => Object.keys(readContextStore()));
}

function registerRulesIpc(): void {
  // Load project-level agent rules (like Cursor's .cursorrules / AGENTS.md).
  // The first existing file wins; content is appended to the agent system prompt.
  ipcMain.handle('rules:load', async (_, root: string) => {
    const candidates = [
      'AGENTS.md',
      '.cursorrules',
      '.cursor/rules',
      '.github/copilot-instructions.md',
      'CLAUDE.md',
    ];
    for (const rel of candidates) {
      try {
        const content = await fs.readFile(path.join(root, rel), 'utf-8');
        if (content.trim()) return { file: rel, content: content.slice(0, 8000) };
      } catch {
        // not present, try next
      }
    }
    return null;
  });
}

function registerCodebaseIpc({ codebaseSearchService }: IpcDeps): void {
  ipcMain.handle('codebase:search', (_, root: string, query: string, limit?: number) =>
    codebaseSearchService.search(root, query, limit)
  );
  ipcMain.handle('codebase:reindex', (_, root: string) => codebaseSearchService.reindex(root));
  ipcMain.handle('codeintel:definition', (_, root: string, name: string) =>
    codebaseSearchService.findDefinition(root, name)
  );
  ipcMain.handle('codeintel:references', (_, root: string, name: string) =>
    codebaseSearchService.findReferences(root, name)
  );
}
