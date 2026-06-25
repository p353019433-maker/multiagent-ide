import { app, BrowserWindow, session } from 'electron';
import path from 'path';
// PATH-repair must run BEFORE any service that spawns child processes
// (TerminalService, AnalysisService, GitService all do).
// macOS GUI launches inherit a minimal PATH that's missing /opt/homebrew/bin
// and ~/.local/bin — without this fix, `claude` / `codex` / `agy` ENOENT
// even though they're on the user's interactive PATH. See path-fix.ts.
import { repairPath } from './services/path-fix';
repairPath();

import { FileService } from './services/file-service';
import { TerminalService } from './services/terminal-service';
import { StoreService } from './services/store-service';
import { AIService } from './services/ai-service';
import { GitService } from './services/git-service';
import { WebService } from './services/web-service';
import { IndexService } from './services/index-service';
import { GitHubService } from './services/github-service';
import { AnalysisService } from './services/analysis-service';
import { CodebaseSearchService } from './services/codebase-search-service';
import { registerIpc } from './ipc';
import { FileWatcherService } from './services/file-watcher-service';
import { SkillsService } from './services/skills-service';

// Single-instance lock: this app persists all state through a single config
// file (electron-store) and per-workspace JSONL logs. Running two instances
// against the same files causes last-writer-wins data loss (electron-store
// does not re-read on disk change). Refuse the second launch and focus the
// existing window instead.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // Another launch was attempted: focus (or recreate) our window.
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });
}

let mainWindow: BrowserWindow | null = null;

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
      sandbox: true,
      webviewTag: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('file://') || url.startsWith('http://localhost:5173/') || url.startsWith('http://127.0.0.1:5173/')) return;
    event.preventDefault();
  });

  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Services are created on app-ready; one terminal service is also referenced by
// the shutdown hook below.
let terminalService: TerminalService;
// Hoisted so the `web-contents-created` handler below can reach it. The
// service is constructed in app.whenReady; before then the handler is
// a no-op (aiService is undefined).
let aiService: AIService | undefined;

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));

  // Content-Security-Policy for the packaged app. The renderer shows
  // model/AI output and fetched web content, so lock down script/style/font
  // sources as defense-in-depth. Dev (vite HMR) is exempt — it needs eval and
  // websocket/inline scripts, and only runs locally.
  if (app.isPackaged) {
    const csp = [
      "default-src 'self'",
      "script-src 'self'",
      // Tailwind injects styles at runtime; allow inline styles + style attrs.
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "img-src 'self' data: blob: https:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
    ].join('; ');
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [csp],
        },
      });
    });
  }

  const fileService = new FileService();
  terminalService = new TerminalService();
  const storeService = new StoreService();
  aiService = new AIService(storeService);
  const gitService = new GitService();
  const webService = new WebService();
  const indexService = new IndexService();
  const githubService = new GitHubService();
  const analysisService = new AnalysisService(terminalService, fileService);
  const codebaseSearchService = new CodebaseSearchService(indexService, aiService, fileService, storeService);
  const fileWatcherService = new FileWatcherService();
  const skillsService = new SkillsService();

  // Invalidate the code index whenever watched files change so codebase_search
  // reflects edits immediately instead of waiting out the 60s freshness TTL.
  // The content-hash vector cache keeps the resulting rebuild incremental.
  fileWatcherService.onChange = () => indexService.invalidate();

  registerIpc({
    getMainWindow: () => mainWindow,
    fileService,
    terminalService,
    storeService,
    aiService,
    gitService,
    webService,
    githubService,
    analysisService,
    codebaseSearchService,
    fileWatcherService,
    skillsService,
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Drop any in-flight AI streams for windows that close without an explicit
// `ai:abort` invocation (e.g. user kills the renderer). Without this hook
// the AbortController map grows unbounded across long sessions.
app.on('web-contents-created', (_event, contents) => {
  contents.on('destroyed', () => {
    if (aiService) aiService.forgetSender(contents.id);
  });
});

app.on('window-all-closed', () => {
  // On macOS the app stays alive with no window; don't tear down services here
  // (the cleanup timer and background sessions keep running for reuse). Real
  // teardown happens on before-quit.
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Final teardown on real quit: kill any lingering terminal/pty/cli subprocess
// trees and release the AI stream map. Without this, background shells and
// orphaned CLI agent runs rely on the OS to reap them.
let isQuitting = false;
app.on('before-quit', () => {
  if (isQuitting) return;
  isQuitting = true;
  try {
    terminalService?.dispose();
    aiService?.dispose();
  } catch {
    // Best-effort cleanup during quit; never block exit.
  }
});
