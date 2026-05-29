import React, { useState, useCallback, useRef } from 'react';
import { useWorkspace } from '../../context/WorkspaceContext';
import { useEditor } from '../../context/EditorContext';

interface SearchResult {
  path: string;
  line: number;
  preview: string;
}

export default function SearchPanel() {
  const { rootPath } = useWorkspace();
  const { openFile } = useEditor();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [visible, setVisible] = useState(true);
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
    // TODO: scroll to line in editor
  };

  // Group results by file
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
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-editor-border">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
          Search
        </span>
        <button
          onClick={() => setVisible(!visible)}
          className="text-xs px-1.5 py-0.5 rounded hover:bg-editor-active text-gray-400 hover:text-white"
          title={visible ? 'Collapse' : 'Expand'}
        >
          {visible ? '▼' : '▲'}
        </button>
      </div>

      {visible && (
        <>
          {/* Search input */}
          <div className="px-3 py-2">
            <div className="flex gap-1">
              <input
                ref={inputRef}
                className="flex-1 bg-editor-bg border border-editor-border rounded px-2 py-1 text-xs text-editor-text outline-none focus:border-editor-accent"
                placeholder="Search in workspace..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
              />
              <button
                onClick={() => handleSearch(query)}
                className="px-2 py-1 bg-editor-accent text-white text-xs rounded hover:opacity-90"
              >
                {searching ? '...' : 'Go'}
              </button>
            </div>
          </div>

          {/* Results */}
          <div className="flex-1 overflow-y-auto selectable">
            {results.length === 0 && query && !searching && (
              <p className="text-xs text-gray-500 text-center mt-4">No results</p>
            )}
            {results.length === 0 && !query && (
              <p className="text-xs text-gray-500 text-center mt-4">Enter a search term</p>
            )}

            {Object.entries(grouped).map(([filePath, matches]) => (
              <div key={filePath} className="mb-1">
                <div className="px-3 py-1 text-[11px] text-gray-500 font-semibold truncate">
                  {fileName(filePath)}{' '}
                  <span className="font-normal text-gray-600">{dirName(filePath)}</span>
                </div>
                {matches.map((match, i) => (
                  <div
                    key={`${filePath}:${match.line}:${i}`}
                    className="flex items-start gap-2 px-3 pl-6 py-[1px] cursor-pointer hover:bg-editor-hover text-xs text-editor-text transition-colors"
                    onClick={() => handleResultClick(match)}
                  >
                    <span className="text-gray-600 font-mono text-[11px] flex-shrink-0 w-8 text-right">
                      {match.line}
                    </span>
                    <span className="truncate font-mono text-[11px]">
                      {match.preview}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}