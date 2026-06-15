import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useWorkspace } from '../../context/WorkspaceContext';
import { useEditor } from '../../context/EditorContext';

interface Problem {
  file: string;
  line: number;
  column: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
  rule?: string;
}

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
      <div className="flex items-center justify-between px-3 py-2 border-b border-editor-border">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
            问题
          </span>
          <span className="text-[11px] text-gray-600">
            {errors.length} 错 {warnings.length} 警
          </span>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="text-xs px-1.5 py-0.5 rounded hover:bg-editor-active text-gray-400 hover:text-white"
          title="刷新"
        >
          {loading ? '⏳' : '🔄'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto selectable">
        {loading && problems.length === 0 && (
          <p className="text-xs text-gray-500 text-center mt-4">分析中...</p>
        )}
        {!loading && problems.length === 0 && (
          <p className="text-xs text-gray-500 text-center mt-4">未发现问题 ✓</p>
        )}

        {problems.map((p) => (
          <div
            key={`${p.file}:${p.line}:${p.column}:${p.message}`}
            className="flex items-start gap-2 px-3 py-[3px] cursor-pointer hover:bg-editor-hover text-xs border-b border-editor-border/30"
            onClick={() => handleClick(p)}
          >
            <span className={
              p.severity === 'error' ? 'text-red-400 flex-shrink-0 mt-0.5' :
              p.severity === 'warning' ? 'text-yellow-400 flex-shrink-0 mt-0.5' :
              'text-blue-400 flex-shrink-0 mt-0.5'
            }>
              {p.severity === 'error' ? '✕' : p.severity === 'warning' ? '⚠' : 'ℹ'}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-editor-text truncate">{p.message}</div>
              <div className="text-[10px] text-gray-600 font-mono truncate">
                {p.file ? `${p.file.split('/').pop()}#${p.line}` : ''}
                {p.rule ? ` · ${p.rule}` : ''}
              </div>
            </div>
          </div>
        ))}

        {lastCheck && (
          <p className="text-[10px] text-gray-700 text-center py-2">
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
