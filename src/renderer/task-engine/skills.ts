/**
 * Skills menu for the IDE's own (API) agents — the progressive-disclosure half.
 * The menu (names + descriptions) is injected into an agent's system prompt; the
 * agent loads a skill's full body on demand via the `use_skill` tool. Keeps big
 * SKILL.md bodies out of the prompt until actually needed.
 */

export interface SkillMeta {
  name: string;
  description: string;
}

/** Render the skills menu appended to an agent's system prompt. */
export function formatSkillsMenu(skills: SkillMeta[]): string {
  if (!skills.length) return '';
  return (
    '\n\n## 可用技能\n' +
    '本工作区已安装以下技能。当任务匹配某个技能时,先用 `use_skill(name)` 工具加载它的完整正文,' +
    '再严格按其指引执行;不要凭名字猜内容。\n' +
    skills.map((s) => `- **${s.name}**：${s.description}`).join('\n')
  );
}

/** Load the skills menu for a workspace (empty string when none / no workspace). */
export async function loadSkillsMenu(rootPath: string | null): Promise<string> {
  if (!rootPath) return '';
  const skills = await window.api.skills.list(rootPath).catch(() => [] as SkillMeta[]);
  return formatSkillsMenu(skills);
}
