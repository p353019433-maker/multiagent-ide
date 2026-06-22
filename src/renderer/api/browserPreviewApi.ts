import type { FileNode } from '@shared/types';
import type { RendererApi } from '../types/api';

const previewRoot = '/preview/workspace';

const previewFiles: FileNode[] = [
  {
    name: 'src',
    path: `${previewRoot}/src`,
    isDirectory: true,
    children: [
      { name: 'main.tsx', path: `${previewRoot}/src/main.tsx`, isDirectory: false },
      { name: 'App.tsx', path: `${previewRoot}/src/App.tsx`, isDirectory: false },
      {
        name: 'components',
        path: `${previewRoot}/src/components`,
        isDirectory: true,
        children: [
          {
            name: 'Workbench.tsx',
            path: `${previewRoot}/src/components/Workbench.tsx`,
            isDirectory: false,
          },
        ],
      },
    ],
  },
  { name: 'package.json', path: `${previewRoot}/package.json`, isDirectory: false },
  { name: 'README.md', path: `${previewRoot}/README.md`, isDirectory: false },
];

const previewFileContents = new Map<string, string>([
  [
    `${previewRoot}/src/main.tsx`,
    `import React from 'react';\nimport ReactDOM from 'react-dom/client';\nimport App from './App';\n\nReactDOM.createRoot(document.getElementById('root')!).render(<App />);\n`,
  ],
  [
    `${previewRoot}/src/App.tsx`,
    `export default function App() {\n  return <main className="workbench">就绪。</main>;\n}\n`,
  ],
  [
    `${previewRoot}/src/components/Workbench.tsx`,
    `export function Workbench() {\n  return <section>Editor surface</section>;\n}\n`,
  ],
  [
    `${previewRoot}/package.json`,
    `{\n  "scripts": {\n    "dev": "vite",\n    "build": "vite build"\n  }\n}\n`,
  ],
  [
    `${previewRoot}/README.md`,
    `# Preview Workspace\n\nThis browser-only workspace is used for renderer visual checks.\n`,
  ],
]);

function cloneFileNodes(nodes: FileNode[]): FileNode[] {
  return nodes.map((node) => ({
    ...node,
    children: node.children ? cloneFileNodes(node.children) : undefined,
  }));
}

function findChildren(path: string): FileNode[] {
  if (path === previewRoot) return cloneFileNodes(previewFiles);

  const stack = [...previewFiles];
  while (stack.length) {
    const node = stack.shift()!;
    if (node.path === path && node.isDirectory) {
      return cloneFileNodes(node.children || []);
    }
    if (node.children) stack.push(...node.children);
  }
  return [];
}

function readonlyPreviewError(action: string): Error {
  return new Error(`${action} is unavailable in browser preview`);
}

export function installBrowserPreviewApi() {
  if (window.api || navigator.userAgent.includes('Electron')) return;

  const store = new Map<string, unknown>();
  const unsubscribe = () => undefined;

  const api: RendererApi = {
    openFolder: async () => previewRoot,
    fs: {
      readDirectory: async (path) => findChildren(path),
      readFile: async (path) => previewFileContents.get(path) ?? '',
      writeFile: async (path, content) => {
        previewFileContents.set(path, content);
      },
      createFile: async () => {
        throw readonlyPreviewError('createFile');
      },
      createDirectory: async () => {
        throw readonlyPreviewError('createDirectory');
      },
      delete: async () => {
        throw readonlyPreviewError('delete');
      },
      rename: async () => {
        throw readonlyPreviewError('rename');
      },
      searchFiles: async () => [],
      findFiles: async () => [],
      listFiles: async () => Array.from(previewFileContents.keys()),
      getFileInfo: async (path) => ({
        size: previewFileContents.get(path)?.length ?? 0,
        modified: new Date(0).toISOString(),
        isDirectory: findChildren(path).length > 0,
      }),
      readMultipleFiles: async (paths) =>
        Object.fromEntries(paths.map((path) => [path, previewFileContents.get(path) ?? ''])),
      startWatching: async () => undefined,
      stopWatching: async () => undefined,
      onFileChanged: () => unsubscribe,
    },
    terminal: {
      create: async () => null,
      write: async () => undefined,
      resize: async () => undefined,
      close: async () => undefined,
      runCommand: async () => ({ stdout: '', stderr: 'Terminal is unavailable in browser preview', exitCode: 1 }),
      runBackgroundCommand: async () => 'preview-session',
      getBackgroundOutput: async () => ({ output: '', running: false, exitCode: 0 }),
      killBackgroundCommand: async () => false,
      onData: () => unsubscribe,
      onExit: () => unsubscribe,
    },
    store: {
      get: async (key) => store.get(key),
      set: async (key, value) => {
        store.set(key, value);
      },
      encryptAndStore: async (key, value) => {
        store.set(key, value);
        return true;
      },
      decryptAndGet: async (key) => {
        const value = store.get(key);
        return typeof value === 'string' ? value : null;
      },
    },
    ai: {
      chat: async () => ({
        content: 'Browser preview does not connect to model providers.',
        finishReason: 'stop',
      }),
      chatStream: async () => undefined,
      abort: async () => undefined,
      testConnection: async () => ({ ok: false, error: 'Browser preview has no provider bridge' }),
      fimComplete: async () => null,
      supportsFim: async () => false,
      onStreamToken: () => unsubscribe,
      onStreamToolCall: () => unsubscribe,
      onStreamComplete: () => unsubscribe,
      onStreamError: () => unsubscribe,
    },
    git: {
      status: async () => '',
      diff: async () => '',
      log: async () => '',
      stage: async () => '',
      unstage: async () => '',
      stageAll: async () => '',
      commit: async () => '',
      push: async () => '',
      pull: async () => '',
      branchList: async () => '* main',
      branchSwitch: async () => '',
      branchCreate: async () => '',
      currentBranch: async () => 'main',
      worktreeAdd: async () => ({ success: false, path: '', message: 'Browser preview has no git bridge' }),
      authorizeWorktrees: async () => [],
      worktreeList: async () => [],
      worktreeRemove: async () => ({ success: false, message: 'Browser preview has no git bridge' }),
      worktreePrune: async () => undefined,
      worktreeMerge: async () => ({ success: false, message: 'Browser preview has no git bridge' }),
      worktreeMergeDiff: async () => '',
    },
    web: {
      search: async () => [],
      fetch: async () => '',
    },
    lint: {
      run: async () => '',
      check: async () => ({ hasErrors: false, output: '' }),
    },
    rules: {
      load: async () => null,
    },
    codeintel: {
      definition: async () => [],
      references: async () => [],
    },
    symbols: {
      extract: async () => '',
    },
    context: {
      save: async (key, content) => {
        store.set(`context:${key}`, content);
      },
      load: async (key) => {
        const value = store.get(`context:${key}`);
        return typeof value === 'string' ? value : null;
      },
      list: async () =>
        Array.from(store.keys())
          .filter((key) => key.startsWith('context:'))
          .map((key) => key.slice('context:'.length)),
    },
    codebase: {
      search: async () => ({ hits: [], fellBack: false, mode: 'text' }),
      reindex: async () => ({ ok: false, error: 'Browser preview has no codebase index' }),
    },
    cliAgent: {
      run: async () => ({ ok: false, output: '', error: 'CLI agents unavailable in browser preview' }),
    },
    skills: {
      list: async () => [],
      read: async () => '',
    },
    agentLog: {
      append: async () => undefined,
      readTail: async () => [],
      writeRound: async () => null,
    },
    github: {
      listIssues: async () => [],
      getIssue: async () => null,
      createIssue: async () => null,
      listIssueComments: async () => [],
      addIssueComment: async () => null,
      listPRs: async () => [],
      getPR: async () => null,
      getPRDiff: async () => '',
      createPR: async () => null,
      listWorkflowRuns: async () => [],
      searchCode: async () => [],
      getRepo: async () => null,
      parseRemote: async () => null,
      createReview: async () => null,
      mergePR: async () => null,
      createRelease: async () => null,
    },
  };

  window.api = api;
}
