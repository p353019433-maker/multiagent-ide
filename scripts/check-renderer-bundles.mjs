import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const ASSETS_DIR = join(process.cwd(), 'dist', 'renderer', 'assets');
const ONE_KIB = 1024;

const budgets = [
  {
    name: 'lazy Monaco editor',
    match: /^editor\.main-.*\.js$/,
    maxKiB: 3400,
  },
  {
    name: 'syntax highlighter runtime',
    match: /^vendor-syntax-.*\.js$/,
    maxKiB: 160,
  },
  {
    name: 'markdown renderer',
    match: /^vendor-markdown-.*\.js$/,
    maxKiB: 220,
  },
  {
    name: 'terminal runtime',
    match: /^vendor-terminal-.*\.js$/,
    maxKiB: 340,
  },
  {
    name: 'React runtime',
    match: /^vendor-react-.*\.js$/,
    maxKiB: 180,
  },
  {
    name: 'renderer entry',
    match: /^index-.*\.js$/,
    maxKiB: 220,
  },
];

const defaultMaxKiB = 600;
const files = await readdir(ASSETS_DIR);
const failures = [];

for (const file of files) {
  if (!file.endsWith('.js')) continue;
  const { size } = await stat(join(ASSETS_DIR, file));
  const sizeKiB = size / ONE_KIB;
  const budget = budgets.find((entry) => entry.match.test(file));
  const maxKiB = budget?.maxKiB ?? defaultMaxKiB;

  if (sizeKiB > maxKiB) {
    failures.push(`${file}: ${sizeKiB.toFixed(1)} KiB exceeds ${budget?.name ?? 'default'} budget ${maxKiB} KiB`);
  }
}

if (failures.length) {
  console.error('Renderer bundle budget exceeded:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Renderer bundle budgets OK');
