import { describe, it, expect } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { FileService } from './file-service';

let dir: string;

async function write(rel: string, content: string) {
  const full = path.join(dir, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, 'utf-8');
}

describe('FileService search bounds', () => {
  it('searchFiles skips ignored/dot directories and returns matching lines', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fs-search-'));
    try {
      await write('src/a.ts', 'hello needle');
      await write('node_modules/pkg/a.ts', 'needle hidden');
      await write('.secret/a.ts', 'needle hidden');

      const hits = await new FileService().searchFiles(dir, 'needle');

      expect(hits.map((h) => path.relative(dir, h.path))).toEqual(['src/a.ts']);
      expect(hits[0].line).toBe(1);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('FileService.listFiles', () => {
  it('递归列出文件，跳过忽略目录/点目录，保留白名单点文件', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fs-list-'));
    try {
      await write('src/a.ts', 'a');
      await write('src/nested/b.ts', 'b');
      await write('.gitignore', 'node_modules');
      await write('.secret/hidden.ts', 'x');
      await write('node_modules/pkg/c.ts', 'c');
      await write('dist/bundle.js', 'd');

      const files = await new FileService().listFiles(dir);
      const rels = files.map((f) => path.relative(dir, f)).sort();

      expect(rels).toEqual(['.gitignore', 'src/a.ts', 'src/nested/b.ts']);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('limit 生效', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fs-list-limit-'));
    try {
      await write('a.ts', 'a');
      await write('b.ts', 'b');
      await write('c.ts', 'c');

      const files = await new FileService().listFiles(dir, 2);
      expect(files.length).toBe(2);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
