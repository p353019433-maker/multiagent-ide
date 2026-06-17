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
});
