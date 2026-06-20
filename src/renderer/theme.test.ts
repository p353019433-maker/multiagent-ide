import { describe, expect, it } from 'vitest';
import { THEMES } from './theme';

describe('THEMES', () => {
  it('keeps the dark theme aligned with VS Code Dark+ standard colors', () => {
    expect(THEMES.dark.colors.bg).toBe('#1e1e1e');
    expect(THEMES.dark.colors.sidebar).toBe('#252526');
    expect(THEMES.dark.colors.border).toBe('#3e3e42');
    expect(THEMES.dark.colors.active).toBe('#094771');
    expect(THEMES.dark.colors.accent).toBe('#007acc');
    expect(THEMES.dark.colors.text).toBe('#cccccc');
  });

  it('每套主题都配齐 syntax / editor 调色板且为合法 hex', () => {
    const hex = /^#[0-9a-fA-F]{3,8}$/;
    for (const theme of Object.values(THEMES)) {
      for (const value of Object.values(theme.syntax)) {
        expect(value).toMatch(hex);
      }
      for (const value of Object.values(theme.editor)) {
        expect(value).toMatch(hex);
      }
      expect(['vs', 'vs-dark', 'hc-black']).toContain(theme.editorTheme);
    }
  });
});
