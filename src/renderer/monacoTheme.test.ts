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

  it('dark 主题与旧 workbench-dark 硬编码完全一致（防视觉回归）', () => {
    const data = buildMonacoTheme(THEMES.dark);
    expect(data.base).toBe('vs-dark');
    const byToken = Object.fromEntries(data.rules.map((r) => [r.token, r.foreground]));
    expect(byToken).toEqual({
      comment: '9aa0a6',
      keyword: '8ab4f8',
      string: 'fde293',
      function: '81c995',
      variable: 'e8eaed',
      number: 'f28b82',
      type: '8ab4f8',
    });
    expect(data.colors).toEqual({
      'editor.background': '#1f2024',
      'editor.foreground': '#e8eaed',
      'editor.lineHighlightBackground': '#ffffff08',
      'editorLineNumber.foreground': '#5f6368',
      'editor.selectionBackground': '#4285f444',
      'editorIndentGuide.background': '#ffffff10',
      'editorIndentGuide.activeBackground': '#ffffff30',
    });
  });

  it('light 主题 base 为 vs，high-contrast 为 hc-black', () => {
    expect(buildMonacoTheme(THEMES.light).base).toBe('vs');
    expect(buildMonacoTheme(THEMES['high-contrast']).base).toBe('hc-black');
  });
});
