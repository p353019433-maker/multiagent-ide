import { contextBridge, ipcRenderer } from 'electron';
import type { GitHubReviewComment } from '../shared/types';

/**
 * Streaming events from a CLI agent run. Mirrors the main-process
 * `CliAgentStreamCallbacks` shape, plus a `complete` terminator carrying the
 * final result.
 */
export type CliStreamEvent =
  | { type: 'start' }
  | { type: 'stdout'; chunk: string }
  | { type: 'stderr'; chunk: string }
  | { type: 'exit'; code: number | null; signal: NodeJS.Signals | null }
  | { type: 'error'; kind: string; message: string }
  | { type: 'complete'; result: { ok: boolean; output: string; error?: string; errorKind?: string } };

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
    listFiles: (rootPath: string) => ipcRenderer.invoke('fs:listFiles', rootPath),
    getFileInfo: (path: string) => ipcRenderer.invoke('fs:getFileInfo', path),
    readMultipleFiles: (paths: string[]) =>
      ipcRenderer.invoke('fs:readMultipleFiles', paths),
    startWatching: (rootPath: string) => ipcRenderer.invoke('fs:startWatching', rootPath),
    stopWatching: () => ipcRenderer.invoke('fs:stopWatching'),
    onFileChanged: (callback: (events: { type: 'add' | 'change' | 'unlink', path: string }[]) => void) => {
      const handler = (_: unknown, events: { type: 'add' | 'change' | 'unlink', path: string }[]) => callback(events);
      ipcRenderer.on('fs:fileChanged', handler);
      return () => ipcRenderer.removeListener('fs:fileChanged', handler);
    },
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
    // Renderer can only check whether a secret exists, never read its plaintext.
    hasSecret: (key: string) => ipcRenderer.invoke('store:hasSecret', key),
  },

  // AI
  ai: {
    chat: (providerId: string, messages: unknown[], options: unknown) =>
      ipcRenderer.invoke('ai:chat', providerId, messages, options),
    chatStream: (callId: string, providerId: string, messages: unknown[], options: unknown) =>
      ipcRenderer.invoke('ai:chatStream', callId, providerId, messages, options),
    abort: (callId?: string) => ipcRenderer.invoke('ai:abort', callId),
    testConnection: (providerId: string) =>
      ipcRenderer.invoke('ai:testConnection', providerId),
    fimComplete: (req: unknown) => ipcRenderer.invoke('ai:fimComplete', req),
    supportsFim: (providerId: string, model: string) =>
      ipcRenderer.invoke('ai:supportsFim', providerId, model),
    onStreamToken: (callback: (callId: string, token: string) => void) => {
      const handler = (_: unknown, callId: string, token: string) => callback(callId, token);
      ipcRenderer.on('ai:stream-token', handler);
      return () => ipcRenderer.removeListener('ai:stream-token', handler);
    },
    onStreamToolCall: (callback: (callId: string, toolCall: unknown) => void) => {
      const handler = (_: unknown, callId: string, toolCall: unknown) => callback(callId, toolCall);
      ipcRenderer.on('ai:stream-tool-call', handler);
      return () => ipcRenderer.removeListener('ai:stream-tool-call', handler);
    },
    onStreamComplete: (callback: (callId: string, result: unknown) => void) => {
      const handler = (_: unknown, callId: string, result: unknown) => callback(callId, result);
      ipcRenderer.on('ai:stream-complete', handler);
      return () => ipcRenderer.removeListener('ai:stream-complete', handler);
    },
    onStreamError: (callback: (callId: string, error: string) => void) => {
      const handler = (_: unknown, callId: string, error: string) => callback(callId, error);
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
    authorizeWorktrees: (cwd: string) => ipcRenderer.invoke('git:authorizeWorktrees', cwd),
    worktreeList: (cwd: string) => ipcRenderer.invoke('git:worktreeList', cwd),
    worktreeRemove: (cwd: string, path: string, deleteBranch?: string) =>
      ipcRenderer.invoke('git:worktreeRemove', cwd, path, deleteBranch),
    worktreePrune: (cwd: string) => ipcRenderer.invoke('git:worktreePrune', cwd),
    worktreeMerge: (cwd: string, sourceBranch: string, method: string, targetBranch?: string) =>
      ipcRenderer.invoke('git:worktreeMerge', cwd, sourceBranch, method, targetBranch),
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
    check: (cwd: string, files?: string[]) => ipcRenderer.invoke('lint:check', cwd, files),
  },

  // Project rules (.cursorrules / AGENTS.md)
  rules: {
    load: (root: string) => ipcRenderer.invoke('rules:load', root),
  },

  // Code intelligence (navigation)
  codeintel: {
    definition: (root: string, name: string) =>
      ipcRenderer.invoke('codeintel:definition', root, name),
    references: (root: string, name: string) =>
      ipcRenderer.invoke('codeintel:references', root, name),
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
    reindex: (root: string) => ipcRenderer.invoke('codebase:reindex', root),
  },

  // CLI agents (Claude Code / Codex / Antigravity, headless)
  cliAgent: {
    /** Synchronous (fire-and-forget) run — resolves with the full output. */
    run: (cwd: string, params: unknown) => ipcRenderer.invoke('cliagent:run', cwd, params),
    /**
     * Cancel an in-flight streaming run by the callId returned from
     * `runStream`. SIGTERMs the subprocess (no orphan process). No-op for an
     * unknown or already-finished id.
     */
    cancel: (callId: string) => ipcRenderer.invoke('cliagent:cancel', callId),
    /**
     * Streaming run. Returns an object holding the `callId` (use it to call
     * `cancel`) and a `result` promise that resolves with the final result.
     * Events arrive via `onEvent` as the CLI runs (start / stdout / stderr /
     * exit / error / complete). Multiple parallel runs are multiplexed by
     * `callId` (renderer-side uuid) onto per-call channels.
     */
    runStream: (
      cwd: string,
      params: unknown,
      onEvent: (event: CliStreamEvent) => void
    ): { callId: string; result: Promise<{ ok: boolean; output: string; error?: string; errorKind?: string }> } => {
      const callId = Math.random().toString(36).slice(2) + Date.now().toString(36);
      const channel = `cliagent:stream-${callId}`;
      const handler = (_: unknown, event: CliStreamEvent) => onEvent(event);
      ipcRenderer.on(channel, handler);
      const result = (ipcRenderer.invoke('cliagent:runStream', callId, cwd, params) as Promise<{
        ok: boolean;
        output: string;
        error?: string;
        errorKind?: string;
      }>).finally(() => ipcRenderer.removeListener(channel, handler));
      return { callId, result };
    },
  },

  // Skills (.claude/skills) for the IDE's own agents
  skills: {
    list: (root: string) => ipcRenderer.invoke('skills:list', root),
    read: (root: string, name: string) => ipcRenderer.invoke('skills:read', root, name),
  },

  // GitHub — token stays in the main process; these never carry it.
  github: {
    listIssues: (owner: string, repo: string, state?: string) =>
      ipcRenderer.invoke('github:listIssues', owner, repo, state),
    getIssue: (owner: string, repo: string, number: number) =>
      ipcRenderer.invoke('github:getIssue', owner, repo, number),
    createIssue: (owner: string, repo: string, title: string, body?: string, labels?: string[]) =>
      ipcRenderer.invoke('github:createIssue', owner, repo, title, body, labels),
    listIssueComments: (owner: string, repo: string, number: number) =>
      ipcRenderer.invoke('github:listIssueComments', owner, repo, number),
    addIssueComment: (owner: string, repo: string, number: number, body: string) =>
      ipcRenderer.invoke('github:addIssueComment', owner, repo, number, body),
    listPRs: (owner: string, repo: string, state?: string) =>
      ipcRenderer.invoke('github:listPRs', owner, repo, state),
    getPR: (owner: string, repo: string, number: number) =>
      ipcRenderer.invoke('github:getPR', owner, repo, number),
    getPRDiff: (owner: string, repo: string, number: number) =>
      ipcRenderer.invoke('github:getPRDiff', owner, repo, number),
    createPR: (owner: string, repo: string, title: string, head: string, base: string, body?: string) =>
      ipcRenderer.invoke('github:createPR', owner, repo, title, head, base, body),
    listWorkflowRuns: (owner: string, repo: string, branch?: string) =>
      ipcRenderer.invoke('github:listWorkflowRuns', owner, repo, branch),
    searchCode: (query: string, owner?: string, repo?: string) =>
      ipcRenderer.invoke('github:searchCode', query, owner, repo),
    getRepo: (owner: string, repo: string) =>
      ipcRenderer.invoke('github:getRepo', owner, repo),
    parseRemote: (remoteUrl: string) =>
      ipcRenderer.invoke('github:parseRemote', remoteUrl),
    createReview: (owner: string, repo: string, number: number, event: string, body?: string, comments?: GitHubReviewComment[]) =>
      ipcRenderer.invoke('github:createReview', owner, repo, number, event, body, comments),
    mergePR: (owner: string, repo: string, number: number, method?: string) =>
      ipcRenderer.invoke('github:mergePR', owner, repo, number, method),
    createRelease: (owner: string, repo: string, tag: string, name?: string, body?: string, draft?: boolean) =>
      ipcRenderer.invoke('github:createRelease', owner, repo, tag, name, body, draft),
  },
};

contextBridge.exposeInMainWorld('api', api);

export type API = typeof api;
