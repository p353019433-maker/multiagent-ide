import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import type { ThemeName, ThemeConfig } from '../theme';
import { THEMES } from '../theme';

interface ThemeContextValue {
  theme: ThemeConfig;
  themeName: ThemeName;
  setThemeName: (name: ThemeName) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function hexToHslTriplet(hex: string): string {
  const clean = hex.replace('#', '');
  const value = clean.length === 3
    ? clean.split('').map((char) => char + char).join('')
    : clean;
  const r = parseInt(value.slice(0, 2), 16) / 255;
  const g = parseInt(value.slice(2, 4), 16) / 255;
  const b = parseInt(value.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }

  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeName, setThemeNameState] = useState<ThemeName>(() => {
    // One-time migration to the new gray-white workbench: the redesign is a
    // light design, so move existing installs (whose stored default was 'dark')
    // onto 'light' once. Explicit theme choices made afterwards are respected.
    if (!localStorage.getItem('ide-theme-graywhite')) {
      localStorage.setItem('ide-theme-graywhite', '1');
      localStorage.setItem('ide-theme', 'light');
      return 'light';
    }
    const stored = localStorage.getItem('ide-theme') as ThemeName | null;
    return stored && THEMES[stored] ? stored : 'light';
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
    root.dataset.theme = themeName;

    root.style.setProperty('--background', hexToHslTriplet(c.bg));
    root.style.setProperty('--foreground', hexToHslTriplet(c.text));
    root.style.setProperty('--surface', hexToHslTriplet(c.sidebar));
    root.style.setProperty('--surface-foreground', hexToHslTriplet(c.text));
    root.style.setProperty('--popover', hexToHslTriplet(c.sidebar));
    root.style.setProperty('--popover-foreground', hexToHslTriplet(c.text));
    root.style.setProperty('--primary', hexToHslTriplet(c.accent));
    root.style.setProperty('--primary-foreground', hexToHslTriplet(c.bg));
    root.style.setProperty('--secondary', hexToHslTriplet(c.hover));
    root.style.setProperty('--secondary-foreground', hexToHslTriplet(c.text));
    root.style.setProperty('--muted', hexToHslTriplet(c.hover));
    root.style.setProperty('--muted-foreground', hexToHslTriplet(c.dimText));
    root.style.setProperty('--accent', hexToHslTriplet(c.active));
    root.style.setProperty('--accent-foreground', hexToHslTriplet(c.text));
    root.style.setProperty('--border', hexToHslTriplet(c.border));
    root.style.setProperty('--input', hexToHslTriplet(c.border));
    root.style.setProperty('--ring', hexToHslTriplet(c.accent));

    root.style.setProperty('--c-bg', c.bg);
    root.style.setProperty('--c-sidebar', c.sidebar);
    root.style.setProperty('--c-border', c.border);
    root.style.setProperty('--c-hover', c.hover);
    root.style.setProperty('--c-active', c.active);
    root.style.setProperty('--c-accent', c.accent);
    root.style.setProperty('--c-text', c.text);
    root.style.setProperty('--c-dim', c.dimText);
  }, [theme, themeName]);

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
