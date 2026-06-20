/**
 * Skills reader — lets the IDE's own (API) agents use the same `.claude/skills/`
 * skills the CLI agents load natively. `list` returns a lightweight menu (dir
 * name + frontmatter description); `read` returns one skill's full SKILL.md on
 * demand. This is the progressive-disclosure half: the menu goes into the
 * agent's prompt, and a `use_skill` tool calls `read` only when needed.
 */

import fs from 'fs/promises';
import path from 'path';

export interface SkillMeta {
  /** Directory name under .claude/skills/ — the canonical id. */
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
  private skillsDir(root: string): string {
    return path.join(root, '.claude', 'skills');
  }

  /** List installed skills (dir name + description). Empty if none / no dir. */
  async list(root: string): Promise<SkillMeta[]> {
    let entries: import('fs').Dirent[];
    try {
      entries = await fs.readdir(this.skillsDir(root), { withFileTypes: true });
    } catch {
      return [];
    }
    const out: SkillMeta[] = [];
    for (const e of entries) {
      if (!e.isDirectory() || !SAFE_NAME.test(e.name)) continue;
      try {
        const md = await fs.readFile(path.join(this.skillsDir(root), e.name, 'SKILL.md'), 'utf-8');
        out.push({ name: e.name, description: frontmatterDescription(md) });
      } catch {
        // directory without a SKILL.md — skip
      }
    }
    return out;
  }

  /** Read one skill's full SKILL.md. Rejects unsafe names (path traversal). */
  async read(root: string, name: string): Promise<string> {
    if (!SAFE_NAME.test(name)) throw new Error(`非法技能名: ${name}`);
    return fs.readFile(path.join(this.skillsDir(root), name, 'SKILL.md'), 'utf-8');
  }
}
