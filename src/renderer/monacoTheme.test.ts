import { describe, expect, it } from 'vitest';
import { buildMonacoTheme, monacoThemeName } from './monacoTheme';
import { THEMES, type ThemeName } from './theme';

describe('monacoThemeName', () => {
  it('为每套主题生成稳定的 Monaco 主题名', () => {
    expect(monacoThemeName('dark')).toBe('workbench-dark');
    expect(monacoThemeName('light')).toBe('workbench-light');
    expect(monacoThemeName('high-contrast')).toBe('workbench-high-contrast');
  });
});

describe('buildMonacoTheme', () => {
  const names = Object.keys(THEMES) as ThemeName[];

  it.each(names)('%s：base 取自 editorTheme，背景取自主题 bg', (name) => {
    const theme = THEMES[name];
    const data = buildMonacoTheme(theme);
    expect(data.base).toBe(theme.editorTheme);
    expect(data.inherit).toBe(true);
    expect(data.colors['editor.background']).toBe(theme.colors.bg);
    expect(data.colors['editor.foreground']).toBe(theme.editor.foreground);
  });

  it.each(names)('%s：token rule 的 foreground 不带 # 前缀', (name) => {
    const data = buildMonacoTheme(THEMES[name]);
    expect(data.rules.length).toBeGreaterThanOrEqual(7);
    for (const rule of data.rules) {
      expect(rule.foreground).toMatch(/^[0-9a-fA-F]{6,8}$/);
    }
  });

  it('dark 主题与 VS Code Dark+ 标准配色一致', () => {
    const data = buildMonacoTheme(THEMES.dark);
    expect(data.base).toBe('vs-dark');
    const byToken = Object.fromEntries(data.rules.map((r) => [r.token, r.foreground]));
    expect(byToken).toEqual({
      comment: '6a9955',
      keyword: '569cd6',
      string: 'ce9178',
      function: 'dcdcaa',
      variable: '9cdcfe',
      number: 'b5cea8',
      type: '4ec9b0',
    });
    expect(data.colors).toEqual({
      'editor.background': '#1e1e1e',
      'editor.foreground': '#d4d4d4',
      'editor.lineHighlightBackground': '#2a2d2e',
      'editorLineNumber.foreground': '#858585',
      'editor.selectionBackground': '#264f78',
      'editorIndentGuide.background': '#404040',
      'editorIndentGuide.activeBackground': '#707070',
    });
  });

  it('light 主题 base 为 vs，high-contrast 为 hc-black', () => {
    expect(buildMonacoTheme(THEMES.light).base).toBe('vs');
    expect(buildMonacoTheme(THEMES['high-contrast']).base).toBe('hc-black');
  });
});
