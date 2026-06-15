import fs from 'fs/promises';
import path from 'path';
import { statSync } from 'fs';

export interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileNode[];
}

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.DS_Store',
  'dist',
  'build',
  '.next',
  '.cache',
  'release',
  '__pycache__',
  '.svn',
]);

/** Files starting with . that should still be shown */
const ALLOWED_DOT_FILES = new Set([
  '.env.example',
  '.eslintrc',
  '.eslintrc.js',
  '.eslintrc.json',
  '.prettierrc',
  '.prettierrc.js',
  '.prettierrc.json',
  '.editorconfig',
  '.gitignore',
  '.npmrc',
  '.nvmrc',
  '.babelrc',
  '.dockerignore',
  '.env.local',
  '.env.development',
  '.env.production',
]);

const MAX_READ_BYTES = 2 * 1024 * 1024;
const MAX_SEARCH_FILES = 5000;
const MAX_SEARCH_DIRS = 2000;
const MAX_SEARCH_MS = 8000;

export class FileService {
  async readDirectory(dirPath: string): Promise<FileNode[]> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const nodes: FileNode[] = [];

    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      // Hide dot files/dirs unless explicitly allowed
      if (entry.name.startsWith('.') && !ALLOWED_DOT_FILES.has(entry.name)) continue;
      nodes.push({
        name: entry.name,
        path: path.join(dirPath, entry.name),
        isDirectory: entry.isDirectory(),
      });
    }

    return nodes.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  async readFile(filePath: string): Promise<string> {
    const st = await fs.stat(filePath);
    if (st.size > MAX_READ_BYTES) {
      throw new Error(`文件过大，拒绝一次性读取：${Math.round(st.size / 1024 / 1024)} MB`);
    }
    return fs.readFile(filePath, 'utf-8');
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf-8');
  }

  async createFile(filePath: string): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, '', 'utf-8');
  }

  async createDirectory(dirPath: string): Promise<void> {
    await fs.mkdir(dirPath, { recursive: true });
  }

  async delete(targetPath: string): Promise<void> {
    await fs.rm(targetPath, { recursive: true, force: true });
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    await fs.rename(oldPath, newPath);
  }

  async searchFiles(rootPath: string, query: string): Promise<{ path: string; line: number; preview: string }[]> {
    const results: { path: string; line: number; preview: string }[] = [];
    const lowerQuery = query.toLowerCase();

    const walk = async (dir: string): Promise<void> => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
        // Skip symlinks so a malicious in-workspace link cannot point the
        // search outside the authorized root.
        if (entry.isSymbolicLink()) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else {
          try {
            const stat = await fs.stat(full);
            if (stat.size > 1024 * 1024) continue; // skip files >1MB
            const content = await fs.readFile(full, 'utf-8');
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].toLowerCase().includes(lowerQuery)) {
                results.push({ path: full, line: i + 1, preview: lines[i].trim() });
                if (results.length >= 100) return;
              }
            }
          } catch {
            // skip binary or unreadable files
          }
        }
      }
    };

    await walk(rootPath);
    return results;
  }

  async findFiles(rootPath: string, pattern: string): Promise<string[]> {
    const results: string[] = [];
    const regex = globToRegex(pattern);
    let fileCount = 0;
    let dirCount = 0;
    const started = Date.now();
    const shouldStop = () => results.length >= 200 || fileCount >= MAX_SEARCH_FILES || dirCount >= MAX_SEARCH_DIRS || Date.now() - started > MAX_SEARCH_MS;

    const walk = async (dir: string): Promise<void> => {
      if (shouldStop()) return;
      dirCount++;
      let entries;
      try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (shouldStop()) return;
        if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
        const full = path.join(dir, entry.name);
        const relative = path.relative(rootPath, full);
        if (entry.isDirectory()) {
          await walk(full);
        } else {
          fileCount++;
          if (regex.test(relative) || regex.test(entry.name)) results.push(full);
        }
      }
    };

    await walk(rootPath);
    return results;
  }

  async getFileInfo(filePath: string): Promise<{ size: number; modified: string; isDirectory: boolean }> {
    const st = statSync(filePath);
    return {
      size: st.size,
      modified: st.mtime.toISOString(),
      isDirectory: st.isDirectory(),
    };
  }
}

/** Convert a simple glob pattern (e.g. "*.ts" or "src/**\/*.ts") to a regex. */
function globToRegex(pattern: string): RegExp {
  let rx = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape special regex chars
    .replace(/\*\*/g, '<<<GLOBSTAR>>>')
    .replace(/\*/g, '[^/]*')
    .replace(/<<<GLOBSTAR>>>/g, '.*');
  return new RegExp('^' + rx + '$', 'i');
}
