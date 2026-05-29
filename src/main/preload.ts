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
    findFiles: (rootPath: string, pattern: string) =>
      ipcRenderer.invoke('fs:findFiles', rootPath, pattern),
    getFileInfo: (path: string) => ipcRenderer.invoke('fs:getFileInfo', path),
    readMultipleFiles: (paths: string[]) =>
      ipcRenderer.invoke('fs:readMultipleFiles', paths),
  },

  // Terminal
  terminal: {
    create: (cwd: string) => ipcRenderer.invoke('terminal:create', cwd),
    write: (id: string, data: string) => ipcRenderer.invoke('terminal:write', id, data),
    resize: (id: string, cols: number, rows: number) =>
      ipcRenderer.invoke('terminal:resize', id, cols, rows),
    close: (id: string) => ipcRenderer.invoke('terminal:close', id),
    runCommand: (cwd: string, command: string, timeoutMs?: number) =>
      ipcRenderer.invoke('terminal:runCommand', cwd, command, timeoutMs),
    runBackgroundCommand: (cwd: string, command: string) =>
      ipcRenderer.invoke('terminal:runBackgroundCommand', cwd, command),
    getBackgroundOutput: (id: string) => ipcRenderer.invoke('terminal:getBackgroundOutput', id),
    killBackgroundCommand: (id: string) => ipcRenderer.invoke('terminal:killBackgroundCommand', id),
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
    fimComplete: (req: unknown) => ipcRenderer.invoke('ai:fimComplete', req),
    supportsFim: (providerId: string, model: string) =>
      ipcRenderer.invoke('ai:supportsFim', providerId, model),
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

  // Git
  git: {
    status: (cwd: string) => ipcRenderer.invoke('git:status', cwd),
    diff: (cwd: string, staged?: boolean, filePath?: string) =>
      ipcRenderer.invoke('git:diff', cwd, staged, filePath),
    log: (cwd: string, count?: number) => ipcRenderer.invoke('git:log', cwd, count),
    stage: (cwd: string, files: string[]) => ipcRenderer.invoke('git:stage', cwd, files),
    unstage: (cwd: string, files: string[]) => ipcRenderer.invoke('git:unstage', cwd, files),
    stageAll: (cwd: string) => ipcRenderer.invoke('git:stageAll', cwd),
    commit: (cwd: string, message: string) => ipcRenderer.invoke('git:commit', cwd, message),
    push: (cwd: string, remote?: string, branch?: string) =>
      ipcRenderer.invoke('git:push', cwd, remote, branch),
    pull: (cwd: string, remote?: string, branch?: string) =>
      ipcRenderer.invoke('git:pull', cwd, remote, branch),
    branchList: (cwd: string) => ipcRenderer.invoke('git:branchList', cwd),
    branchSwitch: (cwd: string, name: string) => ipcRenderer.invoke('git:branchSwitch', cwd, name),
    branchCreate: (cwd: string, name: string) => ipcRenderer.invoke('git:branchCreate', cwd, name),
    currentBranch: (cwd: string) => ipcRenderer.invoke('git:currentBranch', cwd),
    worktreeAdd: (cwd: string, path: string, name: string, base?: string) =>
      ipcRenderer.invoke('git:worktreeAdd', cwd, path, name, base),
    worktreeList: (cwd: string) => ipcRenderer.invoke('git:worktreeList', cwd),
    worktreeRemove: (cwd: string, path: string) => ipcRenderer.invoke('git:worktreeRemove', cwd, path),
    worktreePrune: (cwd: string) => ipcRenderer.invoke('git:worktreePrune', cwd),
    worktreeMerge: (cwd: string, sourceBranch: string, method: string) =>
      ipcRenderer.invoke('git:worktreeMerge', cwd, sourceBranch, method),
    worktreeMergeDiff: (cwd: string, baseBranch: string, headBranch: string) =>
      ipcRenderer.invoke('git:worktreeMergeDiff', cwd, baseBranch, headBranch),
  },

  // Web
  web: {
    search: (query: string, count?: number) => ipcRenderer.invoke('web:search', query, count),
    fetch: (url: string, extractMode?: 'markdown' | 'text') =>
      ipcRenderer.invoke('web:fetch', url, extractMode),
  },

  // Lint
  lint: {
    run: (cwd: string, filePath?: string) => ipcRenderer.invoke('lint:run', cwd, filePath),
  },

  // Symbols
  symbols: {
    extract: (filePath: string) => ipcRenderer.invoke('symbols:extract', filePath),
  },

  // Context
  context: {
    save: (key: string, content: string, merge?: boolean) =>
      ipcRenderer.invoke('context:save', key, content, merge),
    load: (key: string) => ipcRenderer.invoke('context:load', key),
    list: () => ipcRenderer.invoke('context:list'),
  },

  // Codebase semantic search
  codebase: {
    search: (root: string, query: string, limit?: number) =>
      ipcRenderer.invoke('codebase:search', root, query, limit),
  },

  // GitHub
  github: {
    listIssues: (token: string, owner: string, repo: string, state?: string) =>
      ipcRenderer.invoke('github:listIssues', token, owner, repo, state),
    getIssue: (token: string, owner: string, repo: string, number: number) =>
      ipcRenderer.invoke('github:getIssue', token, owner, repo, number),
    createIssue: (token: string, owner: string, repo: string, title: string, body?: string, labels?: string[]) =>
      ipcRenderer.invoke('github:createIssue', token, owner, repo, title, body, labels),
    listIssueComments: (token: string, owner: string, repo: string, number: number) =>
      ipcRenderer.invoke('github:listIssueComments', token, owner, repo, number),
    addIssueComment: (token: string, owner: string, repo: string, number: number, body: string) =>
      ipcRenderer.invoke('github:addIssueComment', token, owner, repo, number, body),
    listPRs: (token: string, owner: string, repo: string, state?: string) =>
      ipcRenderer.invoke('github:listPRs', token, owner, repo, state),
    getPR: (token: string, owner: string, repo: string, number: number) =>
      ipcRenderer.invoke('github:getPR', token, owner, repo, number),
    getPRDiff: (token: string, owner: string, repo: string, number: number) =>
      ipcRenderer.invoke('github:getPRDiff', token, owner, repo, number),
    createPR: (token: string, owner: string, repo: string, title: string, head: string, base: string, body?: string) =>
      ipcRenderer.invoke('github:createPR', token, owner, repo, title, head, base, body),
    listWorkflowRuns: (token: string, owner: string, repo: string, branch?: string) =>
      ipcRenderer.invoke('github:listWorkflowRuns', token, owner, repo, branch),
    searchCode: (token: string, query: string, owner?: string, repo?: string) =>
      ipcRenderer.invoke('github:searchCode', token, query, owner, repo),
    getRepo: (token: string, owner: string, repo: string) =>
      ipcRenderer.invoke('github:getRepo', token, owner, repo),
    parseRemote: (remoteUrl: string) =>
      ipcRenderer.invoke('github:parseRemote', remoteUrl),
    createReview: (token: string, owner: string, repo: string, number: number, event: string, body?: string, comments?: any[]) =>
      ipcRenderer.invoke('github:createReview', token, owner, repo, number, event, body, comments),
    mergePR: (token: string, owner: string, repo: string, number: number, method?: string) =>
      ipcRenderer.invoke('github:mergePR', token, owner, repo, number, method),
    createRelease: (token: string, owner: string, repo: string, tag: string, name?: string, body?: string, draft?: boolean) =>
      ipcRenderer.invoke('github:createRelease', token, owner, repo, tag, name, body, draft),
  },
};

contextBridge.exposeInMainWorld('api', api);

export type API = typeof api;
