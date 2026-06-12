import { describe, expect, it } from 'vitest';
import { fuzzyFilter, fuzzyMatch, fuzzyMatchPath } from './fuzzy';

describe('fuzzyMatch', () => {
  it('空查询匹配一切，得分为 0', () => {
    expect(fuzzyMatch('', 'anything')).toEqual({ score: 0, positions: [] });
  });

  it('非子序列返回 null', () => {
    expect(fuzzyMatch('xyz', 'abc')).toBeNull();
    expect(fuzzyMatch('aab', 'ab')).toBeNull();
  });

  it('忽略大小写匹配并返回命中位置', () => {
    const m = fuzzyMatch('edit', 'EditorArea.tsx');
    expect(m).not.toBeNull();
    expect(m!.positions).toEqual([0, 1, 2, 3]);
  });

  it('连续子串得分高于离散匹配', () => {
    const consecutive = fuzzyMatch('task', 'TaskPanel.tsx')!;
    const scattered = fuzzyMatch('task', 'ToolAndSidebarKit.tsx')!;
    expect(consecutive.score).toBeGreaterThan(scattered.score);
  });

  it('词边界（camelCase / 分隔符）有加成', () => {
    // "ea" 命中 EditorArea 的 E+A（两个边界）应胜过 search 中间的 ea（连续但非边界）
    const boundary = fuzzyMatch('ea', 'EditorArea.tsx')!;
    const middle = fuzzyMatch('ea', 'search.ts')!;
    expect(boundary.score).toBeGreaterThan(middle.score);
  });

  it('更早命中的目标得分更高', () => {
    const early = fuzzyMatch('abc', 'abc-file.ts')!;
    const late = fuzzyMatch('abc', 'zzzzzzzz-abc.ts')!;
    expect(early.score).toBeGreaterThan(late.score);
  });
});

describe('fuzzyMatchPath', () => {
  it('命中文件名优先于命中目录名', () => {
    const inBasename = fuzzyMatchPath('panel', 'src/components/TaskPanel.tsx')!;
    const inDir = fuzzyMatchPath('panel', 'src/panel/helpers.ts')!;
    expect(inBasename.score).toBeGreaterThan(inDir.score);
  });

  it('文件名匹配时位置映射回完整路径', () => {
    const m = fuzzyMatchPath('fuzzy', 'src/palette/fuzzy.ts')!;
    const prefix = 'src/palette/'.length;
    expect(m.positions).toEqual([prefix, prefix + 1, prefix + 2, prefix + 3, prefix + 4]);
  });

  it('只匹配目录段时仍可命中', () => {
    expect(fuzzyMatchPath('palette', 'src/palette/index.ts')).not.toBeNull();
  });

  it('无分隔符路径退化为普通匹配', () => {
    expect(fuzzyMatchPath('abc', 'abc.ts')).toEqual(fuzzyMatch('abc', 'abc.ts'));
  });
});

describe('fuzzyFilter', () => {
  const files = [
    'src/components/editor/EditorArea.tsx',
    'src/components/task/TaskPanel.tsx',
    'src/components/sidebar/FileTree.tsx',
    'src/theme.ts',
    'README.md',
  ];

  it('过滤不匹配项并按得分降序排序', () => {
    const results = fuzzyFilter('tsx', files, (f) => f, { matcher: fuzzyMatchPath });
    expect(results.length).toBe(3);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it('limit 截断结果', () => {
    const results = fuzzyFilter('t', files, (f) => f, { limit: 2 });
    expect(results.length).toBe(2);
  });

  it('文件名精确词应排第一', () => {
    const results = fuzzyFilter('filetree', files, (f) => f, { matcher: fuzzyMatchPath });
    expect(results[0].item).toBe('src/components/sidebar/FileTree.tsx');
  });

  it('同分时按文本字典序稳定排序', () => {
    const results = fuzzyFilter('', ['b.ts', 'a.ts'], (f) => f);
    expect(results.map((r) => r.item)).toEqual(['a.ts', 'b.ts']);
  });
});
