/**
 * Focus trap + restore utilities for modal-style overlays (settings panel,
 * command palette). Keeps keyboard focus inside the overlay while it's open
 * and returns focus to the triggering element on close — a keyboard-first IDE
 * shouldn't Tab into hidden workbench content behind a modal.
 */

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Return focusable elements inside `root`, in DOM order. */
export function getFocusableCandidates(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
  ).filter((el) => el.offsetParent !== null || el === document.activeElement);
}

export interface FocusTrap {
  /** Detach the trap and restore focus to the element that had it before. */
  release: () => void;
}

/**
 * Trap keyboard focus inside `container`. Tab/Shift-Tab cycle within the
 * container; on mount focus moves to the first focusable element (or the
 * container itself). Calling `release()` restores focus to whatever was
 * active before the trap was installed.
 */
export function trapFocus(container: HTMLElement): FocusTrap {
  const previouslyFocused = document.activeElement as HTMLElement | null;

  const focusFirst = () => {
    const candidates = getFocusableCandidates(container);
    const target = candidates[0] ?? container;
    target.focus();
    if (document.activeElement !== target) {
      // Some elements (e.g. a div with tabindex=0) may refuse focus; fall back.
      container.tabIndex = -1;
      container.focus();
    }
  };
  // Defer one tick so the container is in the DOM and visible.
  setTimeout(focusFirst, 0);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const candidates = getFocusableCandidates(container);
    if (candidates.length === 0) {
      e.preventDefault();
      return;
    }
    const first = candidates[0];
    const last = candidates[candidates.length - 1];
    const active = document.activeElement;
    if (e.shiftKey) {
      if (active === first || !container.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (active === last || !container.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  document.addEventListener('keydown', onKeyDown, true);

  return {
    release() {
      document.removeEventListener('keydown', onKeyDown, true);
      // Restore focus to the trigger unless it's been removed from the DOM.
      if (previouslyFocused && document.body.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    },
  };
}
