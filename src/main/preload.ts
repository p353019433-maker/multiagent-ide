import { contextBridge, ipcRenderer } from 'electron';

const api = {
  // Dialog
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),

  // File system
  fs: {
    readDirectory: (path: string) => ipcRenderer.invoke('fs:readDirectory', path),
    readFile: (path: string) => ipcRenderer.invoke('fs:readFile', path),
    writeFile: (path: string, content: string) =>
      ipcRenderer.invoke('fs:writeFile', path, content),
    createFile: (path: string) => ipcRenderer.invoke('fs:createFile', path),
    createDirectory: (path: string) => ipcRenderer.invoke('fs:createDirectory', path),
    delete: (path: string) => ipcRenderer.invoke('fs:delete', path),
    rename: (oldPath: string, newPath: string) =>
      ipcRenderer.invoke('fs:rename', oldPath, newPath),
    searchFiles: (rootPath: string, query: string) =>
      ipcRenderer.invoke('fs:searchFiles', rootPath, query),
  },

  // Terminal
  terminal: {
    create: (cwd: string) => ipcRenderer.invoke('terminal:create', cwd),
    write: (id: string, data: string) => ipcRenderer.invoke('terminal:write', id, data),
    resize: (id: string, cols: number, rows: number) =>
      ipcRenderer.invoke('terminal:resize', id, cols, rows),
    close: (id: string) => ipcRenderer.invoke('terminal:close', id),
    runCommand: (cwd: string, command: string) =>
      ipcRenderer.invoke('terminal:runCommand', cwd, command),
    onData: (callback: (id: string, data: string) => void) => {
      const handler = (_: unknown, id: string, data: string) => callback(id, data);
      ipcRenderer.on('terminal:data', handler);
      return () => ipcRenderer.removeListener('terminal:data', handler);
    },
    onExit: (callback: (id: string, code: number) => void) => {
      const handler = (_: unknown, id: string, code: number) => callback(id, code);
      ipcRenderer.on('terminal:exit', handler);
      return () => ipcRenderer.removeListener('terminal:exit', handler);
    },
  },

  // Store (settings + secrets)
  store: {
    get: (key: string) => ipcRenderer.invoke('store:get', key),
    set: (key: string, value: unknown) => ipcRenderer.invoke('store:set', key, value),
    encryptAndStore: (key: string, value: string) =>
      ipcRenderer.invoke('store:encryptAndStore', key, value),
    decryptAndGet: (key: string) => ipcRenderer.invoke('store:decryptAndGet', key),
  },

  // AI
  ai: {
    chat: (providerId: string, messages: unknown[], options: unknown) =>
      ipcRenderer.invoke('ai:chat', providerId, messages, options),
    chatStream: (providerId: string, messages: unknown[], options: unknown) =>
      ipcRenderer.invoke('ai:chatStream', providerId, messages, options),
    abort: () => ipcRenderer.invoke('ai:abort'),
    testConnection: (providerId: string) =>
      ipcRenderer.invoke('ai:testConnection', providerId),
    onStreamToken: (callback: (token: string) => void) => {
      const handler = (_: unknown, token: string) => callback(token);
      ipcRenderer.on('ai:stream-token', handler);
      return () => ipcRenderer.removeListener('ai:stream-token', handler);
    },
    onStreamToolCall: (callback: (toolCall: unknown) => void) => {
      const handler = (_: unknown, toolCall: unknown) => callback(toolCall);
      ipcRenderer.on('ai:stream-tool-call', handler);
      return () => ipcRenderer.removeListener('ai:stream-tool-call', handler);
    },
    onStreamComplete: (callback: (result: unknown) => void) => {
      const handler = (_: unknown, result: unknown) => callback(result);
      ipcRenderer.on('ai:stream-complete', handler);
      return () => ipcRenderer.removeListener('ai:stream-complete', handler);
    },
    onStreamError: (callback: (error: string) => void) => {
      const handler = (_: unknown, error: string) => callback(error);
      ipcRenderer.on('ai:stream-error', handler);
      return () => ipcRenderer.removeListener('ai:stream-error', handler);
    },
  },
};

contextBridge.exposeInMainWorld('api', api);

export type API = typeof api;
