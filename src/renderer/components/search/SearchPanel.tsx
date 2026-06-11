import React, { useState, useCallback, useRef } from 'react';
import { useWorkspace } from '../../context/WorkspaceContext';
import { useEditor } from '../../context/EditorContext';
import { X } from 'lucide-react';

interface SearchResult {
  path: string;
  line: number;
  preview: string;
}

interface Props {
  onClose: () => void;
}

export default function SearchPanel({ onClose }: Props) {
  const { rootPath } = useWorkspace();
  const { openFile } = useEditor();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSearch = useCallback(
    async (q: string) => {
      if (!q.trim() || !rootPath) {
        setResults([]);
        return;
      }
      setSearching(true);
      try {
        const res = await window.api.fs.searchFiles(rootPath, q.trim());
        setResults(res);
      } catch {
        setResults([]);
      }
      setSearching(false);
    },
    [rootPath]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSearch(query);
    }
  };

  const handleResultClick = (result: SearchResult) => {
    openFile(result.path);
  };

  const grouped = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    if (!acc[r.path]) acc[r.path] = [];
    acc[r.path].push(r);
    return acc;
  }, {});

  const fileName = (p: string) => p.split('/').pop() || p;
  const dirName = (p: string) => {
    const parts = p.split('/');
    parts.pop();
    return parts.join('/') || '/';
  };

  return (
    <div className="h-full flex flex-col bg-editor-sidebar border-l border-editor-border">
      <div className="flex h-8 items-center justify-between border-b border-editor-border px-3">
        <span className="text-10 font-semibold uppercase tracking-wide text-muted-foreground">
          搜索
        </span>
        <button
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center text-muted-foreground hover:bg-editor-active hover:text-foreground"
          title="关闭搜索"
          aria-label="关闭搜索"
        >
          <X size={14} strokeWidth={1.8} />
        </button>
      </div>

      <div className="px-3 py-2">
        <div className="flex gap-1">
          <input
            ref={inputRef}
            className="flex-1 border border-editor-border bg-editor-bg px-2 py-1 text-xs text-editor-text outline-none focus:border-editor-accent"
            placeholder="搜索工作区..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto selectable">
        {results.length === 0 && query && !searching && (
          <div className="border-b border-editor-border px-3 py-2 text-xs text-muted-foreground">
            无结果
          </div>
        )}
        {results.length === 0 && !query && (
          <div className="border-b border-editor-border px-3 py-2 text-xs text-muted-foreground">
            等待搜索
          </div>
        )}

        {Object.entries(grouped).map(([filePath, matches]) => (
          <div key={filePath} className="mb-1">
            <div className="px-3 py-1 text-11 text-muted-foreground font-semibold truncate">
              {fileName(filePath)}{' '}
              <span className="font-normal text-muted-foreground">{dirName(filePath)}</span>
            </div>
            {matches.map((match, i) => (
              <div
                key={`${filePath}:${match.line}:${i}`}
                className="flex items-start gap-2 px-3 pl-6 py-[1px] cursor-pointer hover:bg-editor-hover text-xs text-editor-text transition-colors"
                onClick={() => handleResultClick(match)}
              >
                <span className="text-muted-foreground font-mono text-11 flex-shrink-0 w-8 text-right">
                  {match.line}
                </span>
                <span className="truncate font-mono text-11">
                  {match.preview}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
