import React, { useEffect, useRef, useState, useCallback } from 'react';

interface ContextMenuProps {
  x: number;
  y: number;
  items: {
    label: string;
    separator?: boolean;
    action?: () => void;
    disabled?: boolean;
  }[];
  onClose: () => void;
}

export default function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = () => onClose();
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };

    // Delay to avoid the click that triggered the context menu
    const timer = setTimeout(() => {
      document.addEventListener('click', handleClick);
      document.addEventListener('contextmenu', handleClick);
      document.addEventListener('keydown', handleKey);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handleClick);
      document.removeEventListener('contextmenu', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="fixed z-50 bg-editor-active border border-editor-border rounded shadow-2xl py-1 min-w-[160px] text-[13px]"
      style={{ left: x, top: y }}
    >
      {items.map((item, i) =>
        item.separator ? (
          <div key={i} className="border-t border-editor-border mx-1 my-1" />
        ) : (
          <button
            key={i}
            className={`w-full text-left px-3 py-1.5 text-editor-text hover:bg-editor-hover transition-colors ${
              item.disabled ? 'opacity-40 cursor-not-allowed' : ''
            }`}
            onClick={() => {
              if (!item.disabled) item.action?.();
              onClose();
            }}
            disabled={item.disabled}
          >
            {item.label}
          </button>
        )
      )}
    </div>
  );
}