import fs from 'fs/promises';
import path from 'path';

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
}
