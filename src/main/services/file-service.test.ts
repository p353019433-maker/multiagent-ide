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
