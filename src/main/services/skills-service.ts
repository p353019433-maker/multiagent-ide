/**
 * Workspace skills reader.
 *
 * Skills are optional user/workspace instructions loaded on demand by the
 * `use_skill` tool. The product-neutral location is `.multiagent/skills/`.
 * Personal local skills can live in `.local/skills/` and stay ignored by git.
 * `.claude/skills/` is kept only as a compatibility path for users migrating
 * from Claude-style local skills; it should not be treated as the public
 * product default or a place for committed built-in skills.
 */

import fs from 'fs/promises';
import path from 'path';

export interface SkillMeta {
  /** Directory name under one of the supported skills directories. */
  name: string;
  description: string;
}

const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

/** Pull `description` from a SKILL.md YAML frontmatter block (single line). */
function frontmatterDescription(md: string): string {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return '';
  const d = m[1].match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? '';
  return d.replace(/^["']|["']$/g, '').slice(0, 600);
}

export class SkillsService {
  private skillsDirs(root: string): string[] {
    return [
      // Public/project-level skills, if a repository intentionally provides any.
      path.join(root, '.multiagent', 'skills'),
      // Private local skills for one user's workflow; ignored by default.
      path.join(root, '.local', 'skills'),
      // Compatibility only. Do not use this as the product's canonical location.
      path.join(root, '.claude', 'skills'),
    ];
  }

  /** List installed skills (dir name + description). Empty if none / no dir. */
  async list(root: string): Promise<SkillMeta[]> {
    const out: SkillMeta[] = [];
    const seen = new Set<string>();

    for (const dir of this.skillsDirs(root)) {
      let entries: import('fs').Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const e of entries) {
        if (!e.isDirectory() || !SAFE_NAME.test(e.name) || seen.has(e.name)) continue;
        try {
          const md = await fs.readFile(path.join(dir, e.name, 'SKILL.md'), 'utf-8');
          out.push({ name: e.name, description: frontmatterDescription(md) });
          seen.add(e.name);
        } catch {
          // Directory without a SKILL.md — skip.
        }
      }
    }

    return out;
  }

  /** Read one skill's full SKILL.md. Rejects unsafe names (path traversal). */
  async read(root: string, name: string): Promise<string> {
    if (!SAFE_NAME.test(name)) throw new Error(`非法技能名: ${name}`);

    for (const dir of this.skillsDirs(root)) {
      try {
        return await fs.readFile(path.join(dir, name, 'SKILL.md'), 'utf-8');
      } catch {
        // Try the next supported skills directory.
      }
    }

    throw new Error(`未找到技能: ${name}`);
  }
}
