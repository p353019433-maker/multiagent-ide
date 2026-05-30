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

  ipcMain.handle('ai:fimComplete', async (_, req: unknown) => {
    return aiService.fimComplete(req as any);
  });

  ipcMain.handle('ai:supportsFim', async (_, providerId: string, model: string) => {
    return aiService.supportsFim(providerId, model);
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

  // ==================== Project Rules ====================

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
        const full = path.join(root, rel);
        const content = await fs.readFile(full, 'utf-8');
        if (content.trim()) {
          return { file: rel, content: content.slice(0, 8000) };
        }
      } catch {
        // not present, try next
      }
    }
    return null;
  });

  // ==================== Codebase Search ====================

  // Resolve a per-workspace cache file for the embedding index.
  const embedCacheFile = (root: string) => {
    const key = Buffer.from(root).toString('base64').replace(/[/+=]/g, '').slice(0, 40);
    return path.join(app.getPath('userData'), 'codebase-index', `${key}.json`);
  };

  // Read embedding config: { providerId, model } | null. When set, codebase
  // search uses real vector similarity; otherwise it falls back to the symbol
  // index + full-text search.
  const getEmbeddingConfig = (): { providerId: string; model: string } | null => {
    const cfg = storeService.get('embeddingConfig') as { providerId?: string; model?: string } | undefined;
    if (cfg?.providerId && cfg?.model) return { providerId: cfg.providerId, model: cfg.model };
    return null;
  };

  ipcMain.handle('codebase:search', async (_, root: string, query: string, limit?: number) => {
    const max = limit || 10;
    const embedCfg = getEmbeddingConfig();

    // 1. Real semantic search when an embedding provider is configured.
    if (embedCfg) {
      try {
        await indexService.ensureEmbeddingIndex(
          root,
          (texts) => aiService.embed(embedCfg.providerId, embedCfg.model, texts),
          embedCacheFile(root)
        );
        if (indexService.hasEmbeddings()) {
          const [qVec] = await aiService.embed(embedCfg.providerId, embedCfg.model, [query]);
          if (qVec) {
            const hits = indexService.semanticSearch(qVec, max);
            if (hits.length) return { hits, fellBack: false as const, mode: 'embedding' as const };
          }
        }
      } catch {
        // fall through to symbol/text search
      }
    }

    // 2. Symbol/path index.
    await indexService.ensureIndex(root);
    const hits = indexService.search(query, max);
    if (hits.length > 0) {
      return { hits, fellBack: false as const, mode: 'symbol' as const };
    }

    // 3. Full-text search.
    const text = await fileService.searchFiles(root, query);
    return {
      hits: text.slice(0, max).map((r) => ({
        file: path.relative(root, r.path),
        line: r.line,
        kind: 'text',
        name: r.preview.slice(0, 80),
        score: 1,
      })),
      fellBack: true as const,
      mode: 'text' as const,
    };
  });

  // ==================== Code intelligence (navigation) ====================

  // Go-to-definition (approximated via the symbol table).
  ipcMain.handle('codeintel:definition', async (_, root: string, name: string) => {
    await indexService.ensureIndex(root);
    return indexService.findDefinition(name);
  });

  // Find references: word-boundary matches of the identifier across the workspace.
  ipcMain.handle('codeintel:references', async (_, root: string, name: string) => {
    const raw = await fileService.searchFiles(root, name);
    const wordRe = new RegExp(`(^|[^A-Za-z0-9_$])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9_$]|$)`);
    return raw
      .filter((r) => wordRe.test(r.preview))
      .slice(0, 50)
      .map((r) => ({ file: path.relative(root, r.path), line: r.line, preview: r.preview.slice(0, 120) }));
  });

  // Pre-build / refresh the embedding index on demand (Settings "重建索引").
  ipcMain.handle('codebase:reindex', async (_, root: string) => {
    const embedCfg = getEmbeddingConfig();
    if (!embedCfg) return { ok: false, error: '未配置 embedding 模型' };
    try {
      await indexService.ensureEmbeddingIndex(
        root,
        (texts) => aiService.embed(embedCfg.providerId, embedCfg.model, texts),
        embedCacheFile(root)
      );
      return { ok: true, chunks: indexService.hasEmbeddings() };
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  // ==================== Lint check (structured, for self-heal loop) ====================

  // A faster, scoped diagnostic check that returns a structured result the agent
  // loop can act on. Used to auto-feed errors back after the agent edits files.
  ipcMain.handle('lint:check', async (_, cwd: string, files?: string[]) => {
    // Filenames originate from the agent — execute via arg arrays (no shell)
    // and additionally drop any path containing shell metacharacters as
    // defense-in-depth. NEVER interpolate these into a shell string.
    const safe = (f: string) => !/[;&|`$<>(){}\[\]!*?"'\\\n\r]/.test(f);
    const targetFiles = (files || []).filter(safe);
    const ext = ['--ext', '.ts,.tsx,.js,.jsx'];
    let output = '';
    let hasErrors = false;

    try {
      const eslintArgs = targetFiles.length
        ? ['eslint', '--format', 'compact', ...targetFiles]
        : ['eslint', '--format', 'compact', '.', ...ext];
      const out = await terminalService.runFile(cwd, 'npx', eslintArgs, 30_000);
      const text = (out.stdout + out.stderr).trim();
      if (text && /error/i.test(text)) {
        hasErrors = true;
        output += text + '\n';
      }
    } catch {
      // eslint unavailable — ignore
    }

    try {
      const out = await terminalService.runFile(
        cwd,
        'npx',
        ['tsc', '--noEmit', '--pretty', 'false'],
        45_000
      );
      const text = (out.stdout + out.stderr).trim();
      if (text && /error TS\d+/i.test(text)) {
        hasErrors = true;
        // If specific files were edited, only surface diagnostics for them to
        // keep the feedback focused.
        if (files && files.length) {
          const wanted = files.map((f) => path.basename(f));
          const lines = text
            .split('\n')
            .filter((l) => wanted.some((w) => l.includes(w)));
          output += (lines.length ? lines.join('\n') : text).slice(0, 4000) + '\n';
        } else {
          output += text.slice(0, 4000) + '\n';
        }
      }
    } catch {
      // tsc unavailable — ignore
    }

    return { hasErrors, output: output.trim() };
  });
}

// ── Lint helper ──

async function runLint(cwd: string, filePath?: string) {
  const results: string[] = [];
  // Filenames may originate from the agent — run via arg arrays (no shell) and
  // reject any path with shell metacharacters as defense-in-depth.
  const safe = (f: string) => !/[;&|`$<>(){}\[\]!*?"'\\\n\r]/.test(f);
  try {
    const eslintArgs =
      filePath && safe(filePath)
        ? ['eslint', '--format', 'compact', filePath]
        : ['eslint', '--format', 'compact', '.', '--ext', '.ts,.tsx,.js,.jsx'];
    const out = await terminalService.runFile(cwd, 'npx', eslintArgs, 30_000);
    const text = (out.stdout + out.stderr).trim();
    if (text) results.push(text);
  } catch {
    results.push('ESLint 不可用或未配置');
  }

  try {
    const out = await terminalService.runFile(cwd, 'npx', ['tsc', '--noEmit', '--pretty', 'false'], 30_000);
    const text = (out.stdout + out.stderr).trim();
    if (text) results.push(text);
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
