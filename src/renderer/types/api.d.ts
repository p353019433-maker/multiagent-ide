import type { FileNode } from '@shared/types';

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
      };
      terminal: {
        create: (cwd: string) => Promise<string | null>;
        write: (id: string, data: string) => Promise<void>;
        resize: (id: string, cols: number, rows: number) => Promise<void>;
        close: (id: string) => Promise<void>;
        runCommand: (
          cwd: string,
          command: string
        ) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
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
        onStreamToken: (callback: (token: string) => void) => () => void;
        onStreamToolCall: (callback: (toolCall: any) => void) => () => void;
        onStreamComplete: (callback: (result: any) => void) => () => void;
        onStreamError: (callback: (error: string) => void) => () => void;
      };
    };
  }
}

export {};
