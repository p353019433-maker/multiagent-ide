export type ThemeName = 'dark' | 'light' | 'high-contrast';

/** xterm ITheme 的结构子集（不直接依赖 @xterm/xterm，便于在测试/主进程侧复用） */
export interface TerminalPalette {
  background: string;
  foreground: string;
  cursor: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

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
  terminal: TerminalPalette;
}

const commonDimText = '#8f96a3';

const DARK_ANSI = {
  black: '#000000',
  red: '#cd3131',
  green: '#0dbc79',
  yellow: '#e5e510',
  blue: '#2472c8',
  magenta: '#bc3fbc',
  cyan: '#11a8cd',
  white: '#e5e5e5',
  brightBlack: '#666666',
  brightRed: '#f14c4c',
  brightGreen: '#23d18b',
  brightYellow: '#f5f543',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29b8db',
  brightWhite: '#e5e5e5',
};

/** VS Code Light 的 ANSI 标准色 */
const LIGHT_ANSI = {
  black: '#000000',
  red: '#cd3131',
  green: '#00bc00',
  yellow: '#949800',
  blue: '#0451a5',
  magenta: '#bc05bc',
  cyan: '#0598bc',
  white: '#555555',
  brightBlack: '#666666',
  brightRed: '#cd3131',
  brightGreen: '#14ce14',
  brightYellow: '#b5ba00',
  brightBlue: '#0451a5',
  brightMagenta: '#bc05bc',
  brightCyan: '#0598bc',
  brightWhite: '#a5a5a5',
};

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
    terminal: {
      background: '#1f2024',
      foreground: '#e8eaed',
      cursor: '#ffffff',
      selectionBackground: '#264f78',
      ...DARK_ANSI,
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
    terminal: {
      background: '#ffffff',
      foreground: '#333333',
      cursor: '#333333',
      selectionBackground: '#add6ff',
      ...LIGHT_ANSI,
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
    terminal: {
      background: '#000000',
      foreground: '#ffffff',
      cursor: '#ffcc00',
      selectionBackground: '#264f78',
      ...DARK_ANSI,
    },
  },
};
