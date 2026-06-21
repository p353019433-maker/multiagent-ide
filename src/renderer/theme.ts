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

/** Monaco 语法高亮 token 配色（hex，带 #） */
export interface SyntaxPalette {
  comment: string;
  keyword: string;
  string: string;
  func: string;
  variable: string;
  number: string;
  type: string;
}

/** Monaco 编辑器 chrome 配色（hex，可带透明度） */
export interface EditorPalette {
  foreground: string;
  lineHighlight: string;
  lineNumber: string;
  selection: string;
  indentGuide: string;
  indentGuideActive: string;
}

export interface ThemeConfig {
  name: ThemeName;
  display: string;
  editorTheme: 'vs' | 'vs-dark' | 'hc-black'; // Monaco base theme
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
  syntax: SyntaxPalette;
  editor: EditorPalette;
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
      bg: '#1e1e1e',
      sidebar: '#252526',
      border: '#3e3e42',
      hover: '#2a2d2e',
      active: '#094771',
      accent: '#007acc',
      text: '#cccccc',
      dimText: '#858585',
    },
    // VS Code Dark+ 标准配色
    syntax: {
      comment: '#6a9955',
      keyword: '#569cd6',
      string: '#ce9178',
      func: '#dcdcaa',
      variable: '#9cdcfe',
      number: '#b5cea8',
      type: '#4ec9b0',
    },
    editor: {
      foreground: '#d4d4d4',
      lineHighlight: '#2a2d2e',
      lineNumber: '#858585',
      selection: '#264f78',
      indentGuide: '#404040',
      indentGuideActive: '#707070',
    },
    terminal: {
      background: '#1e1e1e',
      foreground: '#cccccc',
      cursor: '#ffffff',
      selectionBackground: '#264f78',
      ...DARK_ANSI,
    },
  },
  light: {
    name: 'light',
    display: 'Light',
    editorTheme: 'vs',
    // Codex workbench · 灰白体系：中央纯白、侧栏 #ececea、主色黑（按钮）、
    // 绿色只做状态点（见 globals.css --status-green，不走主题注入）。
    colors: {
      bg: '#ffffff',
      sidebar: '#ececea',
      border: '#e7e7e5',
      hover: '#f0f0ee',
      active: '#ededeb',
      accent: '#0d0d0d',
      text: '#0d0d0d',
      dimText: '#7e7e7c',
    },
    // 取 VS Code Light+ 的经典配色
    syntax: {
      comment: '#008000',
      keyword: '#0000ff',
      string: '#a31515',
      func: '#795e26',
      variable: '#001080',
      number: '#098658',
      type: '#267f99',
    },
    editor: {
      foreground: '#333333',
      lineHighlight: '#00000008',
      lineNumber: '#237893',
      selection: '#add6ff',
      indentGuide: '#00000012',
      indentGuideActive: '#00000033',
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
    // 取 VS Code High Contrast 的经典配色
    syntax: {
      comment: '#7ca668',
      keyword: '#569cd6',
      string: '#ce9178',
      func: '#dcdcaa',
      variable: '#ffffff',
      number: '#b5cea8',
      type: '#4ec9b0',
    },
    editor: {
      foreground: '#ffffff',
      lineHighlight: '#ffffff0f',
      lineNumber: '#ffffff',
      selection: '#264f78',
      indentGuide: '#ffffff20',
      indentGuideActive: '#ffffff50',
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
