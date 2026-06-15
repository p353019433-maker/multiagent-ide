/**
 * Path/name safety helpers shared between sidebar tree and any other
 * caller that needs to validate a user-supplied name.
 */

/**
 * True if `name` is safe to use as a file/folder basename. Rejects:
 *  - empty / whitespace-only strings
 *  - path separators (`/`, `\`)
 *  - parent-directory references (`.` or `..`)
 *  - NUL and other control characters (which some shells/FUSE layers
 *    interpret as a path terminator or terminator escape)
 *  - leading/trailing whitespace
 */
export function isSafeName(name: string): boolean {
  if (!name) return false;
  if (name !== name.trim()) return false;
  if (name === '.' || name === '..') return false;
  if (/[\/\\]/.test(name)) return false;
  if (/[\u0000-\u001f\u007f]/.test(name)) return false;
  return true;
}
