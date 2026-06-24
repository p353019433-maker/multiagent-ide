import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import type { ModelProvider } from '@shared/types';

interface Props {
  providers: ModelProvider[];
  activeProviderId: string | null;
  activeModel: string | null;
  /** Select a model; the picker also resolves which provider owns it. */
  onSelect: (providerId: string, model: string) => void;
  /** Optional prefix shown before the model name, e.g. "主持人". */
  labelPrefix?: string;
}

/**
 * Combined cross-provider model picker — replaces the two plain <select>s
 * (provider + model) with a single dropdown that lists every configured
 * provider's models in one menu, grouped by provider name, with a check on the
 * active model. Mirrors the Open Design `model-pick` dropdown, styled with the
 * project's own theme tokens. Picking an entry sets both provider and model.
 */
export default function ModelPicker({ providers, activeProviderId, activeModel, onSelect, labelPrefix }: Props) {
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
        className="flex h-8 max-w-[220px] items-center gap-2 rounded-lg border border-border-strong bg-background px-2.5 text-xs text-foreground shadow-[0_1px_2px_rgba(0,0,0,.04)] outline-none transition-colors hover:bg-surface-1"
        title="选择模型"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="flex h-4 w-4 flex-none items-center justify-center rounded-[5px] bg-foreground">
          <span className="h-1.5 w-1.5 rounded-[1.5px]" style={{ background: '#9fe870' }} />
        </span>
        <span className="min-w-0 truncate font-semibold">
          {labelPrefix ? `${labelPrefix} ` : ''}
          {activeModel || '选择模型'}
        </span>
        <ChevronDown size={12} strokeWidth={1.8} className="flex-none text-foreground/35" />
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
