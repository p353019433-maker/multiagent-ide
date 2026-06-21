import React, { useEffect, useState } from 'react';
import { Hexagon } from 'lucide-react';

interface SkillMeta {
  name: string;
  description?: string;
}

/** Derive a 元技能/项目 tag from the skill name (SkillMeta has no kind field). */
function skillTag(name: string): string {
  return /^(darwin|meta|skill-)/i.test(name) || name.endsWith('-skill') ? '元技能' : '项目';
}

/**
 * Left-column "技能" list (round mode): reads .claude/skills via the native
 * skills API. Pure display — skills are injected into agent prompts elsewhere.
 */
export default function SkillsList({ rootPath }: { rootPath: string | null }) {
  const [skills, setSkills] = useState<SkillMeta[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (!rootPath) {
      setSkills([]);
      return;
    }
    window.api.skills
      .list(rootPath)
      .then((list: SkillMeta[]) => {
        if (!cancelled) setSkills(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        if (!cancelled) setSkills([]);
      });
    return () => {
      cancelled = true;
    };
  }, [rootPath]);

  return (
    <div>
      <div className="flex items-center px-1 pb-1.5 pt-4">
        <span className="text-10 font-bold uppercase tracking-[0.06em] text-foreground/40">技能</span>
        <span className="ml-auto font-mono text-10 text-foreground/40">.claude/skills</span>
      </div>
      {skills.length === 0 ? (
        <p className="px-1 text-10 leading-relaxed text-foreground/40">
          {rootPath ? '此项目没有 .claude/skills' : '打开项目后显示技能'}
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {skills.map((s) => (
            <div
              key={s.name}
              title={s.description || s.name}
              className="flex items-center gap-2 rounded-[9px] border border-border bg-background px-[11px] py-2"
            >
              <Hexagon size={13} strokeWidth={1.8} className="flex-none text-status" />
              <span className="flex-1 truncate text-xs text-foreground/90">{s.name}</span>
              <span className="font-mono text-[9.5px] text-foreground/40">{skillTag(s.name)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
