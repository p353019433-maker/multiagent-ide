import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import type { ModelProvider } from '@shared/types';

interface Props {
  providers: ModelProvider[];
  activeProviderId: string | null;
  activeModel: string | null;
  /** Select a model; the picker also resolves which provider owns it. */
  onSelect: (providerId: string, model: string) => void;
}

/**
 * Combined cross-provider model picker — replaces the two plain <select>s
 * (provider + model) with a single dropdown that lists every configured
 * provider's models in one menu, grouped by provider name, with a check on the
 * active model. Mirrors the Open Design `model-pick` dropdown, styled with the
 * project's own theme tokens. Picking an entry sets both provider and model.
 */
export default function ModelPicker({ providers, activeProviderId, activeModel, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape (the menu is a lightweight popover, not a
  // modal, so it should dismiss the moment focus leaves it).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-6 max-w-[180px] items-center gap-1.5 border border-editor-border bg-editor-active px-1.5 text-11 text-editor-text outline-none hover:bg-editor-hover"
        title="选择模型"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-editor-accent" />
        <span className="min-w-0 truncate font-mono">{activeModel || '选择模型'}</span>
        <ChevronDown size={12} strokeWidth={1.8} className="flex-shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="选择模型"
          className="absolute right-0 top-full z-50 mt-1 max-h-[60vh] w-64 overflow-y-auto border border-editor-border bg-editor-sidebar py-1 shadow-lg"
        >
          {providers.map((p) => (
            <div key={p.id}>
              <div className="px-2.5 py-1 text-10 font-semibold uppercase tracking-wide text-muted-foreground">
                {p.name}
              </div>
              {p.models.map((m) => {
                const active = p.id === activeProviderId && m === activeModel;
                return (
                  <button
                    key={`${p.id}:${m}`}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    onClick={() => {
                      onSelect(p.id, m);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-editor-hover ${
                      active ? 'text-foreground' : 'text-editor-text'
                    }`}
                  >
                    <span className="flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center text-editor-accent">
                      {active && <Check size={13} strokeWidth={2} />}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono">{m}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
