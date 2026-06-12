import { describe, expect, it } from 'vitest';
import { THEMES } from './theme';

describe('THEMES', () => {
  it('keeps the dark theme aligned with the default workbench CSS tokens', () => {
    expect(THEMES.dark.colors.bg).toBe('#1f2024');
    expect(THEMES.dark.colors.sidebar).toBe('#242529');
    expect(THEMES.dark.colors.border).toBe('#34363d');
    expect(THEMES.dark.colors.active).toBe('#2f3137');
    expect(THEMES.dark.colors.accent).toBe('#579aff');
    expect(THEMES.dark.colors.text).toBe('#d7dce2');
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
