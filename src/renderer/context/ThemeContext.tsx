import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import type { ThemeName, ThemeConfig } from '../theme';
import { THEMES } from '../theme';

interface ThemeContextValue {
  theme: ThemeConfig;
  themeName: ThemeName;
  setThemeName: (name: ThemeName) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeName, setThemeNameState] = useState<ThemeName>(() => {
    const stored = localStorage.getItem('ide-theme') as ThemeName | null;
    return stored && THEMES[stored] ? stored : 'dark';
  });

  const theme = useMemo(() => THEMES[themeName], [themeName]);

  const setThemeName = useCallback((name: ThemeName) => {
    setThemeNameState(name);
    localStorage.setItem('ide-theme', name);
  }, []);

  // Inject CSS variables into document
  useEffect(() => {
    const root = document.documentElement;
    const c = theme.colors;
    root.style.setProperty('--c-bg', c.bg);
    root.style.setProperty('--c-sidebar', c.sidebar);
    root.style.setProperty('--c-border', c.border);
    root.style.setProperty('--c-hover', c.hover);
    root.style.setProperty('--c-active', c.active);
    root.style.setProperty('--c-accent', c.accent);
    root.style.setProperty('--c-text', c.text);
    root.style.setProperty('--c-dim', c.dimText);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, themeName, setThemeName }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}