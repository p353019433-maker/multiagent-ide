/**
 * Map a file path to a Monaco/Prism language id by extension. Single source of
 * truth shared by the editor (EditorContext) and the diff viewer (DiffPreview),
 * which previously each carried an identical copy of this table.
 */

const EXT_TO_LANGUAGE: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript',
  js: 'javascript', jsx: 'javascript',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust',
  java: 'java', c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
  cs: 'csharp', php: 'php', swift: 'swift', kt: 'kotlin',
  json: 'json', yaml: 'yaml', yml: 'yaml',
  md: 'markdown', html: 'html', css: 'css', scss: 'scss',
  sh: 'shell', sql: 'sql', xml: 'xml', toml: 'toml',
};

/** Return the language id for a file path, or 'plaintext' when unknown. */
export function languageFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  return EXT_TO_LANGUAGE[ext] || 'plaintext';
}
