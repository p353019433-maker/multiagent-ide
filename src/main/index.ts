import { app, BrowserWindow, session } from 'electron';
import path from 'path';
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
  terminalService?.closeAll();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
