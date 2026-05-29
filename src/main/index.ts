import { app, BrowserWindow, ipcMain, dialog, safeStorage } from 'electron';
import path from 'path';
import fs from 'fs/promises';
import { FileService } from './services/file-service';
import { TerminalService } from './services/terminal-service';
import { StoreService } from './services/store-service';
import { AIService } from './services/ai-service';
import { GitService } from './services/git-service';
import { WebService } from './services/web-service';
import { IndexService } from './services/index-service';

let mainWindow: BrowserWindow | null = null;
let fileService: FileService;
let terminalService: TerminalService;
let storeService: StoreService;
let aiService: AIService;
let gitService: GitService;
let webService: WebService;
let indexService: IndexService;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function setupIPC() {
  // ==================== Dialog ====================

  ipcMain.handle('dialog:openFolder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    });
    if (result.canceled) return null;
    return result.filePaths[0];
  });

  // ==================== File System ====================

  ipcMain.handle('fs:readDirectory', async (_, dirPath: string) => {
    return fileService.readDirectory(dirPath);
  });

  ipcMain.handle('fs:readFile', async (_, filePath: string) => {
    return fileService.readFile(filePath);
  });

  ipcMain.handle('fs:writeFile', async (_, filePath: string, content: string) => {
    return fileService.writeFile(filePath, content);
  });

  ipcMain.handle('fs:createFile', async (_, filePath: string) => {
    return fileService.createFile(filePath);
  });

  ipcMain.handle('fs:createDirectory', async (_, dirPath: string) => {
    return fileService.createDirectory(dirPath);
  });

  ipcMain.handle('fs:delete', async (_, targetPath: string) => {
    return fileService.delete(targetPath);
  });

  ipcMain.handle('fs:rename', async (_, oldPath: string, newPath: string) => {
    return fileService.rename(oldPath, newPath);
  });

  ipcMain.handle('fs:searchFiles', async (_, rootPath: string, query: string) => {
    return fileService.searchFiles(rootPath, query);
  });

  ipcMain.handle('fs:findFiles', async (_, rootPath: string, pattern: string) => {
    return fileService.findFiles(rootPath, pattern);
  });

  ipcMain.handle('fs:getFileInfo', async (_, filePath: string) => {
    return fileService.getFileInfo(filePath);
  });

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

  // ==================== Terminal ====================

  ipcMain.handle('terminal:create', async (_, cwd: string) => {
    if (!mainWindow) return null;
    return terminalService.create(cwd, mainWindow);
  });

  ipcMain.handle('terminal:write', async (_, id: string, data: string) => {
    terminalService.write(id, data);
  });

  ipcMain.handle('terminal:resize', async (_, id: string, cols: number, rows: number) => {
    terminalService.resize(id, cols, rows);
  });

  ipcMain.handle('terminal:close', async (_, id: string) => {
    terminalService.close(id);
  });

  ipcMain.handle('terminal:runCommand', async (_, cwd: string, command: string, timeoutMs?: number) => {
    return terminalService.runCommand(cwd, command, timeoutMs);
  });

  ipcMain.handle('terminal:runBackgroundCommand', async (_, cwd: string, command: string) => {
    return terminalService.startBackgroundCommand(cwd, command);
  });

  ipcMain.handle('terminal:getBackgroundOutput', async (_, id: string) => {
    return terminalService.getBackgroundOutput(id);
  });

  ipcMain.handle('terminal:killBackgroundCommand', async (_, id: string) => {
    return terminalService.killBackgroundCommand(id);
  });

  // ==================== Store ====================

  ipcMain.handle('store:get', async (_, key: string) => {
    return storeService.get(key);
  });

  ipcMain.handle('store:set', async (_, key: string, value: unknown) => {
    storeService.set(key, value);
  });

  ipcMain.handle('store:encryptAndStore', async (_, key: string, value: string) => {
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(value);
      storeService.set(key, encrypted.toString('base64'));
      return true;
    }
    return false;
  });

  ipcMain.handle('store:decryptAndGet', async (_, key: string) => {
    const encrypted = storeService.get(key) as string | undefined;
    if (!encrypted) return null;
    if (safeStorage.isEncryptionAvailable()) {
      const buffer = Buffer.from(encrypted, 'base64');
      return safeStorage.decryptString(buffer);
    }
    return null;
  });

  // ==================== AI ====================

  ipcMain.handle('ai:chat', async (_, providerId: string, messages: unknown[], options: unknown) => {
    return aiService.chat(providerId, messages as any, options as any);
  });

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
      onToken: (token: string) => {
        safeSend('ai:stream-token', token);
      },
      onToolCall: (toolCall: unknown) => {
        safeSend('ai:stream-tool-call', toolCall);
      },
      onComplete: (result: unknown) => {
        safeSend('ai:stream-complete', result);
      },
      onError: (error: string) => {
        safeSend('ai:stream-error', error);
      },
    });
  });

  ipcMain.handle('ai:abort', async () => {
    aiService.abort();
  });

  ipcMain.handle('ai:testConnection', async (_, providerId: string) => {
    return aiService.testConnection(providerId);
  });

  // ==================== Git ====================

  ipcMain.handle('git:status', async (_, cwd: string) => {
    return gitService.status(cwd);
  });

  ipcMain.handle('git:diff', async (_, cwd: string, staged?: boolean, filePath?: string) => {
    return gitService.diff(cwd, staged, filePath);
  });

  ipcMain.handle('git:log', async (_, cwd: string, count?: number) => {
    return gitService.log(cwd, count);
  });

  ipcMain.handle('git:stage', async (_, cwd: string, files: string[]) => {
    return gitService.stage(cwd, files);
  });

  ipcMain.handle('git:unstage', async (_, cwd: string, files: string[]) => {
    return gitService.unstage(cwd, files);
  });

  ipcMain.handle('git:stageAll', async (_, cwd: string) => {
    return gitService.stageAll(cwd);
  });

  ipcMain.handle('git:commit', async (_, cwd: string, message: string) => {
    return gitService.commit(cwd, message);
  });

  ipcMain.handle('git:push', async (_, cwd: string, remote?: string, branch?: string) => {
    return gitService.push(cwd, remote, branch);
  });

  ipcMain.handle('git:pull', async (_, cwd: string, remote?: string, branch?: string) => {
    return gitService.pull(cwd, remote, branch);
  });

  ipcMain.handle('git:branchList', async (_, cwd: string) => {
    return gitService.branchList(cwd);
  });

  ipcMain.handle('git:branchSwitch', async (_, cwd: string, name: string) => {
    return gitService.branchSwitch(cwd, name);
  });

  ipcMain.handle('git:branchCreate', async (_, cwd: string, name: string) => {
    return gitService.branchCreate(cwd, name);
  });

  ipcMain.handle('git:currentBranch', async (_, cwd: string) => {
    return gitService.currentBranch(cwd);
  });

  // Worktree
  ipcMain.handle('git:worktreeAdd', async (_, cwd: string, path: string, name: string, base?: string) => {
    return gitService.worktreeAdd(cwd, path, name, base);
  });
  ipcMain.handle('git:worktreeList', async (_, cwd: string) => {
    return gitService.worktreeList(cwd);
  });
  ipcMain.handle('git:worktreeRemove', async (_, cwd: string, path: string) => {
    return gitService.worktreeRemove(cwd, path);
  });
  ipcMain.handle('git:worktreePrune', async (_, cwd: string) => {
    return gitService.worktreePrune(cwd);
  });
  ipcMain.handle('git:worktreeMerge', async (_, cwd: string, sourceBranch: string, method: string) => {
    return gitService.worktreeMerge(cwd, sourceBranch, method as any);
  });
  ipcMain.handle('git:worktreeMergeDiff', async (_, cwd: string, baseBranch: string, headBranch: string) => {
    return gitService.worktreeMergeDiff(cwd, baseBranch, headBranch);
  });

  // ==================== Web ====================

  ipcMain.handle('web:search', async (_, query: string, count?: number) => {
    return webService.search(query, count);
  });

  ipcMain.handle('web:fetch', async (_, url: string, extractMode?: 'markdown' | 'text') => {
    return webService.fetchUrl(url, extractMode);
  });

  // ==================== GitHub ====================

  const githubService = new (require('./services/github-service').GitHubService)();

  ipcMain.handle('github:listIssues', async (_, token: string, owner: string, repo: string, state?: string) => {
    return githubService.listIssues(token, owner, repo, state as any);
  });

  ipcMain.handle('github:getIssue', async (_, token: string, owner: string, repo: string, number: number) => {
    return githubService.getIssue(token, owner, repo, number);
  });

  ipcMain.handle('github:createIssue', async (_, token: string, owner: string, repo: string, title: string, body?: string, labels?: string[]) => {
    return githubService.createIssue(token, owner, repo, title, body || '', labels || []);
  });

  ipcMain.handle('github:listIssueComments', async (_, token: string, owner: string, repo: string, number: number) => {
    return githubService.listIssueComments(token, owner, repo, number);
  });

  ipcMain.handle('github:addIssueComment', async (_, token: string, owner: string, repo: string, number: number, body: string) => {
    return githubService.addIssueComment(token, owner, repo, number, body);
  });

  ipcMain.handle('github:listPRs', async (_, token: string, owner: string, repo: string, state?: string) => {
    return githubService.listPRs(token, owner, repo, state as any);
  });

  ipcMain.handle('github:getPR', async (_, token: string, owner: string, repo: string, number: number) => {
    return githubService.getPR(token, owner, repo, number);
  });

  ipcMain.handle('github:getPRDiff', async (_, token: string, owner: string, repo: string, number: number) => {
    return githubService.getPRDiff(token, owner, repo, number);
  });

  ipcMain.handle('github:createPR', async (_, token: string, owner: string, repo: string, title: string, head: string, base: string, body?: string) => {
    return githubService.createPR(token, owner, repo, title, head, base, body || '');
  });

  ipcMain.handle('github:listWorkflowRuns', async (_, token: string, owner: string, repo: string, branch?: string) => {
    return githubService.listWorkflowRuns(token, owner, repo, branch);
  });

  ipcMain.handle('github:searchCode', async (_, token: string, query: string, owner?: string, repo?: string) => {
    return githubService.searchCode(token, query, owner, repo);
  });

  ipcMain.handle('github:getRepo', async (_, token: string, owner: string, repo: string) => {
    return githubService.getRepo(token, owner, repo);
  });

  ipcMain.handle('github:parseRemote', async (_, remoteUrl: string) => {
    return githubService.parseRemoteUrl(remoteUrl);
  });

  ipcMain.handle('github:createReview', async (_, token: string, owner: string, repo: string, number: number, event: string, body?: string, comments?: any[]) => {
    return githubService.createReview(token, owner, repo, number, event, body || '', comments);
  });

  ipcMain.handle('github:mergePR', async (_, token: string, owner: string, repo: string, number: number, method?: string) => {
    return githubService.mergePR(token, owner, repo, number, method);
  });

  ipcMain.handle('github:createRelease', async (_, token: string, owner: string, repo: string, tag: string, name?: string, body?: string, draft?: boolean) => {
    return githubService.createRelease(token, owner, repo, tag, name || tag, body || '', draft || false);
  });

  // ==================== Lint ====================

  ipcMain.handle('lint:run', async (_, cwd: string, filePath?: string) => {
    return runLint(cwd, filePath);
  });

  // ==================== Symbols ====================

  ipcMain.handle('symbols:extract', async (_, filePath: string) => {
    return extractSymbols(filePath);
  });

  // ==================== Context (persisted to store) ====================

  const CONTEXT_KEY = 'agentContextMemory';
  const readContextStore = (): Record<string, string> =>
    (storeService.get(CONTEXT_KEY) as Record<string, string>) || {};

  ipcMain.handle('context:save', async (_, key: string, content: string, merge?: boolean) => {
    const store = readContextStore();
    if (merge && store[key]) {
      store[key] = store[key] + '\n\n' + content;
    } else {
      store[key] = content;
    }
    storeService.set(CONTEXT_KEY, store);
  });

  ipcMain.handle('context:load', async (_, key: string) => {
    return readContextStore()[key] || null;
  });

  ipcMain.handle('context:list', async () => {
    return Object.keys(readContextStore());
  });

  // ==================== Codebase Search ====================

  ipcMain.handle('codebase:search', async (_, root: string, query: string, limit?: number) => {
    await indexService.ensureIndex(root);
    const hits = indexService.search(query, limit || 10);
    if (hits.length > 0) {
      return { hits, fellBack: false as const };
    }
    // Fall back to full-text search when the symbol/path index has nothing.
    const text = await fileService.searchFiles(root, query);
    return {
      hits: text.slice(0, limit || 10).map((r) => ({
        file: path.relative(root, r.path),
        line: r.line,
        kind: 'text',
        name: r.preview.slice(0, 80),
        score: 1,
      })),
      fellBack: true as const,
    };
  });
}

// ── Lint helper ──

async function runLint(cwd: string, filePath?: string) {
  const results: string[] = [];
  try {
    // Try npx eslint
    const cmd = filePath
      ? `npx eslint --format compact "${filePath}" 2>&1 || true`
      : `npx eslint --format compact . --ext .ts,.tsx,.js,.jsx 2>&1 || true`;
    const { TerminalService } = await import('./services/terminal-service');
    const tmpTs = new TerminalService();
    const out = await tmpTs.runCommand(cwd, cmd, 30_000);
    if (out.stdout.trim()) results.push(out.stdout.trim());
  } catch {
    results.push('ESLint 不可用或未配置');
  }

  try {
    // Try npx tsc --noEmit
    const out = await terminalService.runCommand(cwd, 'npx tsc --noEmit --pretty false 2>&1 || true', 30_000);
    if (out.stdout.trim()) results.push(out.stdout.trim());
  } catch {
    // TypeScript not available
  }

  return results.join('\n') || '未发现问题';
}

// ── Symbol extraction ──

async function extractSymbols(filePath: string): Promise<string> {
  try {
    const content = await fileService.readFile(filePath);
    const ext = path.extname(filePath);
    if (!['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
      return '仅支持 TypeScript/JavaScript 文件';
    }
    return parseSymbols(content);
  } catch {
    return '无法读取文件';
  }
}

function parseSymbols(source: string): string {
  const lines = source.split('\n');
  const symbols: string[] = [];

  const patterns: { re: RegExp; label: string }[] = [
    { re: /^(export\s+)?(async\s+)?function\s+(\w+)/, label: 'function' },
    { re: /^(export\s+)?(const|let|var)\s+(\w+)\s*=\s*(async\s*)?\(/, label: 'const-function' },
    { re: /^(export\s+)?class\s+(\w+)/, label: 'class' },
    { re: /^(export\s+)?interface\s+(\w+)/, label: 'interface' },
    { re: /^(export\s+)?type\s+(\w+)/, label: 'type' },
    { re: /^(export\s+)?enum\s+(\w+)/, label: 'enum' },
    { re: /^export\s+default\s+(function|class|async\s+function)\s+(\w+)?/, label: 'export-default' },
  ];

  for (let i = 0; i < lines.length; i++) {
    for (const { re, label } of patterns) {
      const m = lines[i].match(re);
      if (m) {
        const name = m[3] || m[2] || '(default)';
        symbols.push(`L${i + 1} [${label}] ${name}`);
        break;
      }
    }
  }
  return symbols.join('\n') || '未找到符号';
}

app.whenReady().then(() => {
  fileService = new FileService();
  terminalService = new TerminalService();
  storeService = new StoreService();
  aiService = new AIService(storeService);
  gitService = new GitService();
  webService = new WebService();
  indexService = new IndexService();

  setupIPC();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  terminalService.closeAll();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
