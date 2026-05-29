import { app, BrowserWindow, ipcMain, dialog, safeStorage } from 'electron';
import path from 'path';
import { FileService } from './services/file-service';
import { TerminalService } from './services/terminal-service';
import { StoreService } from './services/store-service';
import { AIService } from './services/ai-service';

let mainWindow: BrowserWindow | null = null;
let fileService: FileService;
let terminalService: TerminalService;
let storeService: StoreService;
let aiService: AIService;

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
  // File operations
  ipcMain.handle('dialog:openFolder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    });
    if (result.canceled) return null;
    return result.filePaths[0];
  });

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

  // Terminal operations
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

  ipcMain.handle('terminal:runCommand', async (_, cwd: string, command: string) => {
    return terminalService.runCommand(cwd, command);
  });

  // Store operations (settings, API keys)
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

  // AI operations
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
}

app.whenReady().then(() => {
  fileService = new FileService();
  terminalService = new TerminalService();
  storeService = new StoreService();
  aiService = new AIService(storeService);

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
