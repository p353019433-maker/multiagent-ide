/**
 * Error-handling helpers.
 *
 * The codebase had ~21 `catch { /* silently fail *\/ }` sites that swallowed
 * errors without a trace. This module gives a single, named primitive that
 * records the error to `console.error` (still visible in DevTools) while
 * letting the caller continue. Use sparingly — most catches should still
 * re-throw or surface the error to the user.
 */

export function logAndIgnore(err: unknown, context?: Record<string, unknown>): void {
  // err is whatever the catch site got; normalise to a useful message.
  const message = err instanceof Error ? err.message : String(err);
  // eslint-disable-next-line no-console
  console.error(`[logAndIgnore]${context ? ' ' + JSON.stringify(context) : ''}`, message);
}
