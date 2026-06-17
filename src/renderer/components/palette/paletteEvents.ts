/** Quick Open / 命令面板的全局唤起事件（Monaco 内部快捷键也经此转发） */

export type PaletteMode = 'files' | 'commands';

export const OPEN_PALETTE_EVENT = 'open-palette';

export function openPalette(mode: PaletteMode): void {
  window.dispatchEvent(new CustomEvent(OPEN_PALETTE_EVENT, { detail: { mode } }));
}

export function onOpenPalette(handler: (mode: PaletteMode) => void): () => void {
  const listener = (e: Event) => {
    const mode = (e as CustomEvent<{ mode?: PaletteMode }>).detail?.mode;
    if (mode === 'files' || mode === 'commands') handler(mode);
  };
  window.addEventListener(OPEN_PALETTE_EVENT, listener);
  return () => window.removeEventListener(OPEN_PALETTE_EVENT, listener);
}
