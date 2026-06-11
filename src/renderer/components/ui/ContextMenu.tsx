import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

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
  const [position, setPosition] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;

    const padding = 4;
    const rect = menu.getBoundingClientRect();
    setPosition({
      left: Math.max(padding, Math.min(x, window.innerWidth - rect.width - padding)),
      top: Math.max(padding, Math.min(y, window.innerHeight - rect.height - padding)),
    });
  }, [x, y, items]);

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
      className="fixed z-50 min-w-[160px] border border-editor-border bg-editor-sidebar py-1 text-13"
      style={{ left: position.left, top: position.top }}
    >
      {items.map((item, i) =>
        item.separator ? (
          <div key={i} className="border-t border-editor-border mx-1 my-1" />
        ) : (
          <button
            key={i}
            className={`w-full px-3 py-1.5 text-left text-editor-text transition-colors hover:bg-editor-hover ${
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
