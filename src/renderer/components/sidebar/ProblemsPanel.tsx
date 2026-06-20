import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useWorkspace } from '../../context/WorkspaceContext';
import { useEditor } from '../../context/EditorContext';
import { AlertCircle, AlertTriangle, Info, RefreshCw, type LucideIcon } from 'lucide-react';

interface Problem {
  file: string;
  line: number;
  column: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
  rule?: string;
}

const PROBLEM_META: Record<Problem['severity'], { Icon: LucideIcon; className: string }> = {
  error: { Icon: AlertCircle, className: 'text-red-400' },
  warning: { Icon: AlertTriangle, className: 'text-yellow-400' },
  info: { Icon: Info, className: 'text-blue-400' },
};

export default function ProblemsPanel() {
  const { rootPath } = useWorkspace();
  const { openFile } = useEditor();
  const [problems, setProblems] = useState<Problem[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastCheck, setLastCheck] = useState('');

  const refresh = useCallback(async () => {
    if (!rootPath) return;
    setLoading(true);
    try {
      const output = await window.api.lint.run(rootPath);
      const parsed = parseLintOutput(output);
      setProblems(parsed);
      setLastCheck(new Date().toLocaleTimeString('zh-CN'));
    } catch (e: any) {
      setProblems([{ file: '', line: 0, column: 0, severity: 'error', message: `诊断失败：${e.message}` }]);
    }
    setLoading(false);
  }, [rootPath]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleClick = (p: Problem) => {
    if (p.file) {
      openFile(p.file);
      // Could also navigate to the line, but Monaco line focus requires editor ref
    }
  };

  const errors = problems.filter(p => p.severity === 'error');
  const warnings = problems.filter(p => p.severity === 'warning');
  const infos = problems.filter(p => p.severity === 'info');

  return (
    <div className="h-full flex flex-col bg-editor-sidebar">
      <div className="flex h-8 items-center justify-between border-b border-editor-border px-3">
        <div className="flex items-center gap-2">
          <span className="text-10 font-semibold uppercase tracking-wide text-muted-foreground">
            问题
          </span>
          <span className="font-mono text-10 text-muted-foreground">
            {errors.length} 错 {warnings.length} 警
          </span>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="flex h-6 w-6 items-center justify-center text-muted-foreground hover:bg-editor-active hover:text-foreground disabled:opacity-40"
          title="刷新"
          aria-label="刷新问题"
        >
          <RefreshCw size={14} strokeWidth={1.8} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto selectable">
        {loading && problems.length === 0 && (
          <div className="border-b border-editor-border px-3 py-2 text-xs text-muted-foreground">
            分析中...
          </div>
        )}
        {!loading && problems.length === 0 && (
          <div className="border-b border-editor-border px-3 py-2 text-xs text-muted-foreground">
            未发现问题
          </div>
        )}

        {problems.map((p, i) => {
          const { Icon, className } = PROBLEM_META[p.severity];
          return (
            <div
              key={i}
              className="flex cursor-pointer items-start gap-2 border-b border-editor-border/30 px-3 py-[3px] text-xs hover:bg-editor-hover"
              onClick={() => handleClick(p)}
            >
              <Icon size={13} strokeWidth={1.8} className={`mt-0.5 flex-shrink-0 ${className}`} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-editor-text">{p.message}</div>
                <div className="truncate font-mono text-10 text-muted-foreground">
                  {p.file ? `${p.file.split('/').pop()}#${p.line}` : ''}
                  {p.rule ? ` · ${p.rule}` : ''}
                </div>
              </div>
            </div>
          );
        })}

        {lastCheck && (
          <p className="border-t border-editor-border px-3 py-2 text-10 text-muted-foreground">
            上次检查 {lastCheck}
          </p>
        )}
      </div>
    </div>
  );
}

/** Parse ESLint compact format and tsc output into Problem array */
function parseLintOutput(output: string): Problem[] {
  const problems: Problem[] = [];
  const lines = output.split('\n');

  for (const line of lines) {
    if (!line.trim()) continue;

    // ESLint compact format: /path/to/file: line 10, col 5, Error - message (rule)
    const eslintMatch = line.match(/^(.+):\s*line\s+(\d+),\s*col\s+(\d+),\s*(Error|Warning)\s*-\s*(.+?)(?:\s*\((.+?)\))?$/);
    if (eslintMatch) {
      problems.push({
        file: eslintMatch[1].trim(),
        line: parseInt(eslintMatch[2]),
        column: parseInt(eslintMatch[3]),
        severity: eslintMatch[4].toLowerCase() === 'error' ? 'error' : 'warning',
        message: eslintMatch[5].trim(),
        rule: eslintMatch[6]?.trim(),
      });
      continue;
    }

    // TSC format: src/file.ts(10,5): error TS2345: message
    const tscMatch = line.match(/^(.+?)\((\d+),(\d+)\):\s*(error|warning)(?:\s+\w+)?[:\s]+(.+)/);
    if (tscMatch) {
      problems.push({
        file: tscMatch[1].trim(),
        line: parseInt(tscMatch[2]),
        column: parseInt(tscMatch[3]),
        severity: tscMatch[4] === 'error' ? 'error' : 'warning',
        message: tscMatch[5].trim(),
      });
      continue;
    }

    // Catch any line that looks like an error
    if (line.toLowerCase().includes('error') || line.toLowerCase().includes('warning')) {
      problems.push({
        file: '',
        line: 0,
        column: 0,
        severity: line.toLowerCase().includes('error') ? 'error' : 'warning',
        message: line.slice(0, 200),
      });
    }
  }

  return problems;
}
