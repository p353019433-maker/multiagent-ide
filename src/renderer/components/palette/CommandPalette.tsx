import React from 'react';
import { ChevronRight, FileText, Search } from 'lucide-react';
import { useWorkspace } from '../../context/WorkspaceContext';
import { useEditorActions } from '../../context/EditorContext';
import { fuzzyFilter, fuzzyMatch, fuzzyMatchPath } from './fuzzy';
import type { PaletteMode } from './paletteEvents';

export interface PaletteCommand {
  id: string;
  label: string;
  /** 右侧提示（快捷键 / 分类） */
  hint?: string;
  /** 额外匹配词（如英文别名），不参与高亮 */
  keywords?: string;
  run: () => void;
}

interface FileItem {
  abs: string;
  rel: string;
}

import { trapFocus } from '../../utils/focusTrap';

interface Props {
  initialMode: PaletteMode;
  commands: PaletteCommand[];
  onClose: () => void;
}

const MAX_RESULTS = 50;

function toRel(abs: string, rootPath: string): string {
  let rel = abs.startsWith(rootPath) ? abs.slice(rootPath.length) : abs;
  rel = rel.replace(/\\/g, '/');
  return rel.startsWith('/') ? rel.slice(1) : rel;
}

/** 按命中位置高亮字符 */
function Highlighted({ text, positions }: { text: string; positions: number[] }) {
  if (!positions.length) return <>{text}</>;
  const set = new Set(positions);
  return (
    <>
      {Array.from(text, (ch, i) =>
        set.has(i) ? (
          <span key={i} className="font-semibold text-editor-accent">
            {ch}
          </span>
        ) : (
          ch
        )
      )}
    </>
  );
}

export default function CommandPalette({ initialMode, commands, onClose }: Props) {
  const { rootPath } = useWorkspace();
  const { openFile } = useEditorActions();
  const [query, setQuery] = React.useState(initialMode === 'commands' ? '>' : '');
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [files, setFiles] = React.useState<FileItem[] | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  const isCommandMode = query.startsWith('>');
  const term = (isCommandMode ? query.slice(1) : query).trim();

  // 打开时拉一次文件清单（带忽略规则的全量列表）
  React.useEffect(() => {
    if (!rootPath) {
      setFiles([]);
      return;
    }
    let cancelled = false;
    window.api.fs
      .listFiles(rootPath)
      .then((paths) => {
        if (cancelled) return;
        setFiles(paths.map((abs) => ({ abs, rel: toRel(abs, rootPath) })));
      })
      .catch(() => {
        if (!cancelled) setFiles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [rootPath]);

  const fileResults = React.useMemo(() => {
    if (isCommandMode) return [];
    const all = files ?? [];
    if (!term) {
      return all.slice(0, MAX_RESULTS).map((item) => ({ item, score: 0, positions: [] as number[] }));
    }
    return fuzzyFilter(term, all, (f) => f.rel, { limit: MAX_RESULTS, matcher: fuzzyMatchPath });
  }, [isCommandMode, files, term]);

  const commandResults = React.useMemo(() => {
    if (!isCommandMode) return [];
    if (!term) {
      return commands.slice(0, MAX_RESULTS).map((item) => ({ item, score: 0, positions: [] as number[] }));
    }
    const out: { item: PaletteCommand; score: number; positions: number[] }[] = [];
    for (const c of commands) {
      const m = fuzzyMatch(term, c.label);
      if (m) {
        out.push({ item: c, score: m.score, positions: m.positions });
        continue;
      }
      if (c.keywords) {
        const km = fuzzyMatch(term, c.keywords);
        if (km) out.push({ item: c, score: km.score - 2, positions: [] });
      }
    }
    out.sort((a, b) => b.score - a.score || a.item.label.localeCompare(b.item.label));
    return out.slice(0, MAX_RESULTS);
  }, [isCommandMode, commands, term]);

  const resultCount = isCommandMode ? commandResults.length : fileResults.length;

  React.useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  React.useEffect(() => {
    const el = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const runActive = React.useCallback(
    (index: number) => {
      if (isCommandMode) {
        const entry = commandResults[index];
        if (!entry) return;
        onClose();
        entry.item.run();
      } else {
        const entry = fileResults[index];
        if (!entry) return;
        onClose();
        void openFile(entry.item.abs);
      }
    },
    [isCommandMode, commandResults, fileResults, onClose, openFile]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (resultCount ? (i + 1) % resultCount : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (resultCount ? (i - 1 + resultCount) % resultCount : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runActive(activeIndex);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/20"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={isCommandMode ? '命令面板' : '快速打开文件'}
    >
      <div
        className="mx-auto mt-[10vh] w-[560px] max-w-[90vw] border border-editor-border bg-editor-sidebar shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex h-9 items-center gap-2 border-b border-editor-border px-3">
          {isCommandMode ? (
            <ChevronRight size={14} strokeWidth={1.8} className="flex-shrink-0 text-editor-accent" />
          ) : (
            <Search size={14} strokeWidth={1.8} className="flex-shrink-0 text-muted-foreground" />
          )}
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isCommandMode ? '输入命令…' : '搜索文件名…（输入 > 进入命令模式）'}
            className="h-full min-w-0 flex-1 bg-transparent text-xs text-editor-text placeholder:text-muted-foreground focus:outline-none"
            aria-label={isCommandMode ? '命令搜索' : '文件搜索'}
          />
        </div>

        <div ref={listRef} className="max-h-[320px] overflow-y-auto" role="listbox">
          {!isCommandMode && files === null && (
            <div className="px-3 py-2 text-xs text-muted-foreground">正在读取文件列表…</div>
          )}
          {!isCommandMode && !rootPath && (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              尚未打开文件夹。输入 &gt; 可执行命令。
            </div>
          )}
          {!isCommandMode && files !== null && rootPath && fileResults.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">无匹配文件</div>
          )}
          {isCommandMode && commandResults.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">无匹配命令</div>
          )}

          {!isCommandMode &&
            fileResults.map((entry, index) => {
              const { rel } = entry.item;
              const sep = rel.lastIndexOf('/');
              const name = rel.slice(sep + 1);
              const dir = sep >= 0 ? rel.slice(0, sep) : '';
              const namePositions = entry.positions
                .filter((p) => p > sep)
                .map((p) => p - sep - 1);
              const dirPositions = entry.positions.filter((p) => p >= 0 && p < sep);
              return (
                <div
                  key={entry.item.abs}
                  role="option"
                  aria-selected={index === activeIndex}
                  className={`flex h-7 cursor-pointer items-center gap-2 px-3 text-xs ${
                    index === activeIndex
                      ? 'bg-editor-active text-foreground'
                      : 'text-editor-text hover:bg-editor-hover'
                  }`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => runActive(index)}
                >
                  <FileText size={13} strokeWidth={1.7} className="flex-shrink-0 text-muted-foreground" />
                  <span className="flex-shrink-0">
                    <Highlighted text={name} positions={namePositions} />
                  </span>
                  {dir && (
                    <span className="min-w-0 truncate text-11 text-muted-foreground">
                      <Highlighted text={dir} positions={dirPositions} />
                    </span>
                  )}
                </div>
              );
            })}

          {isCommandMode &&
            commandResults.map((entry, index) => (
              <div
                key={entry.item.id}
                role="option"
                aria-selected={index === activeIndex}
                className={`flex h-7 cursor-pointer items-center gap-2 px-3 text-xs ${
                  index === activeIndex
                    ? 'bg-editor-active text-foreground'
                    : 'text-editor-text hover:bg-editor-hover'
                }`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => runActive(index)}
              >
                <span className="min-w-0 flex-1 truncate">
                  <Highlighted text={entry.item.label} positions={entry.positions} />
                </span>
                {entry.item.hint && (
                  <span className="flex-shrink-0 font-mono text-10 text-muted-foreground">
                    {entry.item.hint}
                  </span>
                )}
              </div>
            ))}
        </div>

        <div className="flex h-6 items-center gap-3 border-t border-editor-border px-3 font-mono text-10 text-muted-foreground">
          <span>↑↓ 选择</span>
          <span>Enter {isCommandMode ? '执行' : '打开'}</span>
          <span>Esc 关闭</span>
          {!isCommandMode && <span>&gt; 命令模式</span>}
        </div>
      </div>
    </div>
  );
}
