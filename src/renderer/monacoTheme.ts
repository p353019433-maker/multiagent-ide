import type { editor } from 'monaco-editor';
import { THEMES, type ThemeConfig, type ThemeName } from './theme';

/**
 * 把 ThemeConfig 转成 Monaco 主题，三套主题统一在这里生成。
 * EditorArea / DiffPreview 不再各自硬编码颜色。
 */

export function monacoThemeName(name: ThemeName): string {
  return `workbench-${name}`;
}

/** Monaco 的 token rule 要求 hex 不带 # 前缀 */
function stripHash(hex: string): string {
  return hex.startsWith('#') ? hex.slice(1) : hex;
}

export function buildMonacoTheme(theme: ThemeConfig): editor.IStandaloneThemeData {
  const s = theme.syntax;
  const e = theme.editor;
  return {
    base: theme.editorTheme,
    inherit: true,
    rules: [
      { token: 'comment', foreground: stripHash(s.comment) },
      { token: 'keyword', foreground: stripHash(s.keyword) },
      { token: 'string', foreground: stripHash(s.string) },
      { token: 'function', foreground: stripHash(s.func) },
      { token: 'variable', foreground: stripHash(s.variable) },
      { token: 'number', foreground: stripHash(s.number) },
      { token: 'type', foreground: stripHash(s.type) },
    ],
    colors: {
      'editor.background': theme.colors.bg,
      'editor.foreground': e.foreground,
      'editor.lineHighlightBackground': e.lineHighlight,
      'editorLineNumber.foreground': e.lineNumber,
      'editor.selectionBackground': e.selection,
      'editorIndentGuide.background': e.indentGuide,
      'editorIndentGuide.activeBackground': e.indentGuideActive,
    },
  };
}

interface MonacoEditorNamespace {
  defineTheme(themeName: string, themeData: editor.IStandaloneThemeData): void;
  setTheme(themeName: string): void;
}

/** 注册全部三套主题（重复调用安全，defineTheme 会覆盖同名主题） */
export function defineMonacoThemes(monaco: { editor: MonacoEditorNamespace }): void {
  for (const theme of Object.values(THEMES)) {
    monaco.editor.defineTheme(monacoThemeName(theme.name), buildMonacoTheme(theme));
  }
}

/** setTheme 对所有 standalone editor（含 diff editor）全局生效 */
export function applyMonacoTheme(monaco: { editor: MonacoEditorNamespace }, name: ThemeName): void {
  monaco.editor.setTheme(monacoThemeName(name));
}
