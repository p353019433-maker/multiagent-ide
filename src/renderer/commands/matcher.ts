import type { Command, CommandMatch } from './types';

/**
 * Fuzzy match `query` against a command's label + keywords + shortcut + id.
 *
 * Strategy (cheap, no deps): character-by-character substring scan over a
 * normalized haystack. Each consecutive match adds a bonus; each gap
 * subtracts. This matches VS Code's behaviour closely enough for ~100
 * commands without pulling in a real fuzzy lib like fzf.
 */
export function matchCommand(command: Command, query: string): CommandMatch | null {
  const q = query.trim().toLowerCase();
  if (!q) {
    // Empty query: show everything, neutral score.
    return { command, score: 0.5, highlight: [] };
  }

  const haystack = [
    command.label,
    ...(command.keywords ?? []),
    command.category ?? '',
    command.shortcut ?? '',
    command.id,
  ]
    .join('\u0001')
    .toLowerCase();

  let qi = 0;
  let score = 0;
  let consecutive = 0;
  let firstHit = -1;
  const highlight: number[] = [];
  // Track the "global" position across the joined haystack by counting
  // lengths of the parts; for the palette we only need relative positions
  // within label, so map back later. For now, collect label-local indices.
  let labelLower = command.label.toLowerCase();
  for (let i = 0; i < haystack.length && qi < q.length; i++) {
    if (haystack[i] === q[qi]) {
      if (firstHit < 0) firstHit = i;
      consecutive++;
      score += 1 + consecutive * 0.2;
      qi++;
      // If we're still inside the label portion, record for highlight.
      if (i < labelLower.length) highlight.push(i);
    } else {
      consecutive = 0;
    }
  }

  if (qi < q.length) return null; // not all chars matched

  // Heavier weight for a match that begins at word boundaries or covers
  // the entire label.
  if (firstHit === 0) score += 1.0;
  if (labelLower.startsWith(q)) score += 2.0;
  // Penalize very long haystacks so matches buried in id/category lose to
  // matches in the label.
  score -= haystack.length * 0.0005;

  // Clamp to [0, 1] for stable ordering.
  const normalized = Math.max(0, Math.min(1, score / 5));
  return { command, score: normalized, highlight };
}

export function matchCommands(commands: Command[], query: string, limit = 50): CommandMatch[] {
  const matches: CommandMatch[] = [];
  for (const cmd of commands) {
    const m = matchCommand(cmd, query);
    if (m) matches.push(m);
  }
  matches.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const catA = a.command.category ?? '';
    const catB = b.command.category ?? '';
    if (catA !== catB) return catA.localeCompare(catB);
    return a.command.label.localeCompare(b.command.label);
  });
  return matches.slice(0, limit);
}
