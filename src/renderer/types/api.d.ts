import type { FileNode } from '@shared/types';

interface CodebaseSearchResult {
  hits: { file: string; line: number; kind: string; name: string; score: number }[];
  fellBack: boolean;
  mode?: 'hybrid' | 'embedding' | 'symbol' | 'text';
}

type FileChangeEvent = { type: 'add' | 'change' | 'unlink'; path: string };

declare global {
  interface Window {
    api: {
      openFolder: () => Promise<string | null>;
      fs: {
        readDirectory: (path: string) => Promise<FileNode[]>;
        readFile: (path: string) => Promise<string>;
        writeFile: (path: string, content: string) => Promise<void>;
        createFile: (path: string) => Promise<void>;
        createDirectory: (path: string) => Promise<void>;
        delete: (path: string) => Promise<void>;
        rename: (oldPath: string, newPath: string) => Promise<void>;
        searchFiles: (
          rootPath: string,
          query: string
        ) => Promise<{ path: string; line: number; preview: string }[]>;
        findFiles: (rootPath: string, pattern: string) => Promise<string[]>;
        listFiles: (rootPath: string) => Promise<string[]>;
        getFileInfo: (
          path: string
        ) => Promise<{ size: number; modified: string; isDirectory: boolean }>;
        readMultipleFiles: (paths: string[]) => Promise<Record<string, string>>;
        startWatching: (rootPath: string) => Promise<void>;
        stopWatching: () => Promise<void>;
        onFileChanged: (callback: (events: FileChangeEvent[]) => void) => () => void;
      };
      terminal: {
        create: (cwd: string) => Promise<string | null>;
        write: (id: string, data: string) => Promise<void>;
        resize: (id: string, cols: number, rows: number) => Promise<void>;
        close: (id: string) => Promise<void>;
        runCommand: (
          cwd: string,
          command: string,
          timeoutMs?: number
        ) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
        runBackgroundCommand: (cwd: string, command: string) => Promise<string>;
        getBackgroundOutput: (
          id: string
        ) => Promise<{ output: string; running: boolean; exitCode: number | null } | null>;
        killBackgroundCommand: (id: string) => Promise<boolean>;
        onData: (callback: (id: string, data: string) => void) => () => void;
        onExit: (callback: (id: string, code: number) => void) => () => void;
      };
      store: {
        get: (key: string) => Promise<unknown>;
        set: (key: string, value: unknown) => Promise<void>;
        encryptAndStore: (key: string, value: string) => Promise<boolean>;
        decryptAndGet: (key: string) => Promise<string | null>;
      };
      ai: {
        chat: (providerId: string, messages: unknown[], options: unknown) => Promise<any>;
        chatStream: (
          providerId: string,
          messages: unknown[],
          options: unknown
        ) => Promise<void>;
        abort: () => Promise<void>;
        testConnection: (
          providerId: string
        ) => Promise<{ ok: boolean; error?: string }>;
        fimComplete: (req: {
          providerId: string;
          model: string;
          prefix: string;
          suffix: string;
          maxTokens?: number;
        }) => Promise<string | null>;
        supportsFim: (providerId: string, model: string) => Promise<boolean>;
        onStreamToken: (callback: (token: string) => void) => () => void;
        onStreamToolCall: (callback: (toolCall: any) => void) => () => void;
        onStreamComplete: (callback: (result: any) => void) => () => void;
        onStreamError: (callback: (error: string) => void) => () => void;
      };
      git: {
        status: (cwd: string) => Promise<string>;
        diff: (cwd: string, staged?: boolean, filePath?: string) => Promise<string>;
        log: (cwd: string, count?: number) => Promise<string>;
        stage: (cwd: string, files: string[]) => Promise<string>;
        unstage: (cwd: string, files: string[]) => Promise<string>;
        stageAll: (cwd: string) => Promise<string>;
        commit: (cwd: string, message: string) => Promise<string>;
        push: (cwd: string, remote?: string, branch?: string) => Promise<string>;
        pull: (cwd: string, remote?: string, branch?: string) => Promise<string>;
        branchList: (cwd: string) => Promise<string>;
        branchSwitch: (cwd: string, name: string) => Promise<string>;
        branchCreate: (cwd: string, name: string) => Promise<string>;
        currentBranch: (cwd: string) => Promise<string>;
        worktreeAdd: (
          cwd: string,
          path: string,
          name: string,
          base?: string
        ) => Promise<{ success: boolean; path: string; message: string }>;
        authorizeWorktrees: (cwd: string) => Promise<string[]>;
        worktreeList: (cwd: string) => Promise<any[]>;
        worktreeRemove: (cwd: string, path: string, deleteBranch?: string) => Promise<{ success: boolean; message: string }>;
        worktreePrune: (cwd: string) => Promise<void>;
        worktreeMerge: (
          cwd: string,
          sourceBranch: string,
          method: string,
          targetBranch?: string
        ) => Promise<{ success: boolean; message: string }>;
        worktreeMergeDiff: (cwd: string, baseBranch: string, headBranch: string) => Promise<string>;
      };
      web: {
        search: (
          query: string,
          count?: number
        ) => Promise<{ title: string; url: string; snippet: string }[]>;
        fetch: (url: string, extractMode?: 'markdown' | 'text') => Promise<string>;
      };
      lint: {
        run: (cwd: string, filePath?: string) => Promise<string>;
        check: (
          cwd: string,
          files?: string[]
        ) => Promise<{ hasErrors: boolean; output: string }>;
      };
      rules: {
        load: (root: string) => Promise<{ file: string; content: string } | null>;
      };
      codeintel: {
        definition: (
          root: string,
          name: string
        ) => Promise<{ file: string; line: number; kind: string; name: string; score: number }[]>;
        references: (
          root: string,
          name: string
        ) => Promise<{ file: string; line: number; preview: string }[]>;
      };
      symbols: {
        extract: (filePath: string) => Promise<string>;
      };
      context: {
        save: (key: string, content: string, merge?: boolean) => Promise<void>;
        load: (key: string) => Promise<string | null>;
        list: () => Promise<string[]>;
      };
      codebase: {
        search: (root: string, query: string, limit?: number) => Promise<CodebaseSearchResult>;
        reindex: (root: string) => Promise<{ ok: boolean; error?: string; chunks?: boolean }>;
      };
      cliAgent: {
        run: (
          cwd: string,
          params: {
            tool: 'claude-code' | 'codex' | 'antigravity';
            prompt: string;
            model?: string;
            baseURL?: string;
            apiKey?: string;
          }
        ) => Promise<{ ok: boolean; output: string; error?: string }>;
      };
      github: {
        listIssues: (token: string, owner: string, repo: string, state?: string) => Promise<any>;
        getIssue: (token: string, owner: string, repo: string, number: number) => Promise<any>;
        createIssue: (
          token: string,
          owner: string,
          repo: string,
          title: string,
          body?: string,
          labels?: string[]
        ) => Promise<any>;
        listIssueComments: (token: string, owner: string, repo: string, number: number) => Promise<any>;
        addIssueComment: (
          token: string,
          owner: string,
          repo: string,
          number: number,
          body: string
        ) => Promise<any>;
        listPRs: (token: string, owner: string, repo: string, state?: string) => Promise<any>;
        getPR: (token: string, owner: string, repo: string, number: number) => Promise<any>;
        getPRDiff: (token: string, owner: string, repo: string, number: number) => Promise<string>;
        createPR: (
          token: string,
          owner: string,
          repo: string,
          title: string,
          head: string,
          base: string,
          body?: string
        ) => Promise<any>;
        listWorkflowRuns: (token: string, owner: string, repo: string, branch?: string) => Promise<any>;
        searchCode: (token: string, query: string, owner?: string, repo?: string) => Promise<any>;
        getRepo: (token: string, owner: string, repo: string) => Promise<any>;
        parseRemote: (remoteUrl: string) => Promise<{ owner: string; repo: string } | null>;
        createReview: (
          token: string,
          owner: string,
          repo: string,
          number: number,
          event: string,
          body?: string,
          comments?: any[]
        ) => Promise<any>;
        mergePR: (
          token: string,
          owner: string,
          repo: string,
          number: number,
          method?: string
        ) => Promise<any>;
        createRelease: (
          token: string,
          owner: string,
          repo: string,
          tag: string,
          name?: string,
          body?: string,
          draft?: boolean
        ) => Promise<any>;
      };
    };
  }
}

export type RendererApi = Window['api'];
export {};
