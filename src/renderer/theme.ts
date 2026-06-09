export type ThemeName = 'dark' | 'light' | 'high-contrast';

export interface ThemeConfig {
  name: ThemeName;
  display: string;
  editorTheme: string; // Monaco theme
  colors: {
    bg: string;
    sidebar: string;
    border: string;
    hover: string;
    active: string;
    accent: string;
    text: string;
    dimText: string;
  };
}

const commonDimText = '#8f96a3';

export const THEMES: Record<ThemeName, ThemeConfig> = {
  dark: {
    name: 'dark',
    display: 'Dark',
    editorTheme: 'vs-dark',
    colors: {
      bg: '#1f2024',
      sidebar: '#242529',
      border: '#34363d',
      hover: '#2f3137',
      active: '#2f3137',
      accent: '#579aff',
      text: '#d7dce2',
      dimText: commonDimText,
    },
  },
  light: {
    name: 'light',
    display: 'Light',
    editorTheme: 'vs',
    colors: {
      bg: '#ffffff',
      sidebar: '#f3f3f3',
      border: '#e0e0e0',
      hover: '#e8e8e8',
      active: '#e4e6f1',
      accent: '#0066b8',
      text: '#333333',
      dimText: '#999999',
    },
  },
  'high-contrast': {
    name: 'high-contrast',
    display: 'High Contrast',
    editorTheme: 'hc-black',
    colors: {
      bg: '#000000',
      sidebar: '#0a0a0a',
      border: '#6fc3df',
      hover: '#1a1a1a',
      active: '#2a2a2a',
      accent: '#fc0',
      text: '#ffffff',
      dimText: '#aaaaaa',
    },
  },
};
