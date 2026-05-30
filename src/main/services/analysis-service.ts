/**
 * Analysis service — lint diagnostics and symbol extraction.
 *
 * Extracted from index.ts. All shell execution goes through TerminalService.runFile
 * (argument arrays, no shell) so agent-supplied file names can't inject commands.
 */

import path from 'path';
import type { TerminalService } from './terminal-service';
import type { FileService } from './file-service';

/** Reject paths containing shell metacharacters (defense-in-depth). */
function isSafePath(f: string): boolean {
  return !/[;&|`$<>(){}\[\]!*?"'\\\n\r]/.test(f);
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

  /** Structured diagnostic check for the agent self-heal loop (scoped to edited files). */
  async checkLint(cwd: string, files?: string[]): Promise<{ hasErrors: boolean; output: string }> {
    const targetFiles = (files || []).filter(isSafePath);
    let output = '';
    let hasErrors = false;

    try {
      const text = await this.eslint(cwd, targetFiles);
      if (text && /error/i.test(text)) {
        hasErrors = true;
        output += text + '\n';
      }
    } catch {
      // eslint unavailable — ignore
    }

    try {
      const text = await this.tsc(cwd);
      if (text && /error TS\d+/i.test(text)) {
        hasErrors = true;
        // When specific files were edited, surface only their diagnostics.
        if (files && files.length) {
          const wanted = files.map((f) => path.basename(f));
          const lines = text.split('\n').filter((l) => wanted.some((w) => l.includes(w)));
          output += (lines.length ? lines.join('\n') : text).slice(0, 4000) + '\n';
        } else {
          output += text.slice(0, 4000) + '\n';
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
