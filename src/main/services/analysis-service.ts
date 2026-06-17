/**
 * Analysis service — lint diagnostics and symbol extraction.
 *
<<<<<<< HEAD
 * Extracted from index.ts. On macOS and Linux, all shell execution goes
 * through TerminalService.runFile with argument arrays (no shell), so
 * agent-supplied file names can't inject commands.
 *
 * On Windows, runFile sets `shell: true` because npx/npm are .cmd shims
 * that require shell resolution. The isSafePath() guard below is the only
 * thing standing between a crafted file name and arbitrary cmd.exe
 * execution, so it must be comprehensive.
=======
 * Extracted from index.ts. All shell execution goes through TerminalService.runFile
 * (argument arrays, no shell) so tool-supplied file names can't inject commands.
>>>>>>> claude/review-repo-contents-tkoLx
 */

import path from 'path';
import type { TerminalService } from './terminal-service';
import type { FileService } from './file-service';

/**
 * Reject paths containing shell metacharacters (defense-in-depth). This is
 * the only filter between an attacker-controlled file name and a real shell
 * on Windows, so it's intentionally strict.
 */
function isSafePath(f: string): boolean {
  return !/[;&|`$<>(){}\[\]!*?"'\\\n\r\t%^=+]/.test(f);
}

/**
 * Parse a tsc diagnostic line of the form
 *   `path/to/file.ts(line,col): error TS1234: message`.
 * Returns null if the line isn't a diagnostic. We use this for both severity
 * detection and per-file filtering so we don't fall back to fuzzy
 * substring matching on the path.
 */
function parseTscDiagnostic(line: string): { file: string; severity: string; code: string; message: string } | null {
  const m = line.match(/^(.+?)\((\d+),(\d+)\):\s+(error|warning|info)\s+(TS\d+):\s*(.*)$/);
  if (!m) return null;
  return { file: m[1], severity: m[4], code: m[5], message: m[6] };
}

/**
 * Parse an ESLint compact-format line of the form
 *   `path:line:col: error/warning - message [rule]`.
 * Returns null if the line isn't a diagnostic.
 */
function parseEslintDiagnostic(line: string): { file: string; severity: string; message: string } | null {
  const m = line.match(/^(.+?):(\d+):(\d+):\s+(error|warning)\s+-\s+(.*)$/);
  if (!m) return null;
  return { file: m[1], severity: m[4], message: m[5] };
}

export class AnalysisService {
  constructor(
    private terminal: TerminalService,
    private files: FileService
  ) {}

  private async eslint(cwd: string, targetFiles: string[]): Promise<string> {
    const args = targetFiles.length
      ? ['eslint', '--format', 'compact', ...targetFiles]
      : ['eslint', '--format', 'compact', '.', '--ext', '.ts,.tsx,.js,.jsx'];
    const out = await this.terminal.runFile(cwd, 'npx', args, 30_000);
    return (out.stdout + out.stderr).trim();
  }

  private async tsc(cwd: string): Promise<string> {
    const out = await this.terminal.runFile(cwd, 'npx', ['tsc', '--noEmit', '--pretty', 'false'], 45_000);
    return (out.stdout + out.stderr).trim();
  }

  /** Human-readable lint report for the `read_lints` tool (whole project or one file). */
  async runLint(cwd: string, filePath?: string): Promise<string> {
    const results: string[] = [];
    try {
      const text = await this.eslint(cwd, filePath && isSafePath(filePath) ? [filePath] : []);
      if (text) results.push(text);
    } catch {
      results.push('ESLint 不可用或未配置');
    }
    try {
      const text = await this.tsc(cwd);
      if (text) results.push(text);
    } catch {
      // TypeScript not available
    }
    return results.join('\n') || '未发现问题';
  }

  /** Structured diagnostic check for the task self-heal loop (scoped to edited files). */
  async checkLint(cwd: string, files?: string[]): Promise<{ hasErrors: boolean; output: string }> {
    const targetFiles = (files || []).filter(isSafePath);
    // Normalize "wanted" paths so a relative filePath like 'src/a.ts' matches
    // the absolute path tsc prints. We compare on the full path and on the
    // basename so a quoted-but-not-included basename also matches.
    const wantedAbs = new Set(targetFiles.map((f) => path.resolve(cwd, f)));
    const wantedBase = new Set(targetFiles.map((f) => path.basename(f)));
    let output = '';
    let hasErrors = false;

    try {
      const text = await this.eslint(cwd, targetFiles);
      if (text) {
        // Parse the compact format and keep only `error` severity diagnostics
        // scoped to the wanted files (when given). The previous /error/i
        // check fired on the word "error" appearing anywhere — including in
        // a file name or rule id.
        const errLines: string[] = [];
        for (const line of text.split('\n')) {
          const d = parseEslintDiagnostic(line);
          if (!d) continue;
          if (d.severity !== 'error') continue;
          if (targetFiles.length > 0) {
            const abs = path.resolve(cwd, d.file);
            if (!wantedAbs.has(abs) && !wantedBase.has(path.basename(d.file))) continue;
          }
          errLines.push(line);
        }
        if (errLines.length) {
          hasErrors = true;
          output += errLines.join('\n') + '\n';
        }
      }
    } catch {
      // eslint unavailable — ignore
    }

    try {
      const text = await this.tsc(cwd);
      if (text) {
        // Match on the structured `file.ts(line,col): error TS…: …` format
        // rather than a substring-includes on the basename, which produced
        // false matches across two files that share a basename and missed
        // any diagnostic whose basename was absent.
        const errLines: string[] = [];
        for (const line of text.split('\n')) {
          const d = parseTscDiagnostic(line);
          if (!d) continue;
          if (d.severity !== 'error') continue;
          if (targetFiles.length > 0) {
            const abs = path.resolve(cwd, d.file);
            if (!wantedAbs.has(abs) && !wantedBase.has(path.basename(d.file))) continue;
          }
          errLines.push(line);
        }
        if (errLines.length) {
          hasErrors = true;
          output += (errLines.length ? errLines.join('\n') : text).slice(0, 4000) + '\n';
        }
      }
    } catch {
      // tsc unavailable — ignore
    }

    return { hasErrors, output: output.trim() };
  }

  /** Extract top-level symbols (regex-based) from a TS/JS file. */
  async extractSymbols(filePath: string): Promise<string> {
    try {
      const content = await this.files.readFile(filePath);
      const ext = path.extname(filePath);
      if (!['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
        return '仅支持 TypeScript/JavaScript 文件';
      }
      return parseSymbols(content);
    } catch {
      return '无法读取文件';
    }
  }
}

function parseSymbols(source: string): string {
  const lines = source.split('\n');
  const symbols: string[] = [];

  const patterns: { re: RegExp; label: string }[] = [
    { re: /^(export\s+)?(async\s+)?function\s+(\w+)/, label: 'function' },
    { re: /^(export\s+)?(const|let|var)\s+(\w+)\s*=\s*(async\s*)?\(/, label: 'const-function' },
    { re: /^(export\s+)?class\s+(\w+)/, label: 'class' },
    { re: /^(export\s+)?interface\s+(\w+)/, label: 'interface' },
    { re: /^(export\s+)?type\s+(\w+)/, label: 'type' },
    { re: /^(export\s+)?enum\s+(\w+)/, label: 'enum' },
    { re: /^export\s+default\s+(function|class|async\s+function)\s+(\w+)?/, label: 'export-default' },
  ];

  for (let i = 0; i < lines.length; i++) {
    for (const { re, label } of patterns) {
      const m = lines[i].match(re);
      if (m) {
        const name = m[3] || m[2] || '(default)';
        symbols.push(`L${i + 1} [${label}] ${name}`);
        break;
      }
    }
  }
  return symbols.join('\n') || '未找到符号';
}
