# Local Agent Cleanup Checklist

This document records the cleanup decisions that still require local directory inspection. The GitHub connector can confirm some paths are directories, but it cannot list their child files in this chat.

## Goal

Keep the public repository clean and product-neutral. Personal UI/design skills, local workflow prompts, private provider notes, and one-off local agent files should not ship as built-in product files.

The DreamSeed README header is intentionally out of scope for this cleanup.

## Already addressed in this branch

- `.gitignore` ignores local skill/plugin directories:
  - `.claude/skills/`
  - `.opencode/skills/`
  - `.superpowers/`
- `SkillsService` now treats:
  - `.multiagent/skills/` as the product-neutral project-level skill path
  - `.local/skills/` as the private local skill path
  - `.claude/skills/` as compatibility-only
- `SECURITY.md` and `docs/PERSONALIZATION.md` document that local skills should stay private unless deliberately productized.

## Local inspection commands

Run from the repository root.

```bash
git status --short

git ls-files ".claude/skills/**" ".opencode/skills/**" ".superpowers/**"

find .claude/skills .opencode/skills .superpowers -maxdepth 5 -type f 2>/dev/null | sort
```

The `git ls-files` command shows files already tracked by git. The `find` command shows local files that may not be tracked yet but should still be inspected.

## Decision rules

### Remove from public repository

Remove or untrack files if they are personal/local rather than product behavior. Examples:

- one-off UI/design skills used during local polish work
- personal taste guides or review prompts
- prompts mentioning private preferences, local model routing, local CLI habits, or one user's workflow
- provider-specific skill packs that are not part of the product contract
- files mentioning private/local toolchains such as Claude Code, OpenCode, OpenClaw, local proxy ports, or local paths
- files mainly about Apple/Material/Netflix/Brat/HCT/Stranger Things-style design inspiration rather than reusable product behavior

If the file should remain on the maintainer's machine, untrack it and keep it under an ignored local path. If it should not remain at all, remove it from the working tree and commit the deletion.

### Move only intentionally productized skills

If a skill is genuinely reusable for all users, productize it before keeping it:

1. Move it under `.multiagent/skills/<neutral-skill-name>/`.
2. Remove private taste, private model/provider names, local machine assumptions, one-off project context, and personal workflow instructions.
3. Keep examples neutral and repository-agnostic.
4. Add frontmatter with a short neutral `description:`.
5. Commit the move as a productized skill change.

### Keep private local skills local

If a skill is useful only for the maintainer's own local workflow, keep it outside git:

- preferred location: `.local/skills/<skill-name>/`
- compatibility location: `.claude/skills/<skill-name>/`
- do not commit these files

## Final verification

These checks should be run before merge or in a follow-up local-agent commit.

```bash
# No tracked local skill/plugin files should remain in ignored local directories.
git ls-files ".claude/skills/**" ".opencode/skills/**" ".superpowers/**"

# Review remaining product files for local/private fingerprints.
git grep -n -I -E "Apple Design Resources|Material 3|HCT|Brat|Stranger Things|OpenClaw|Claude Code|OpenCode|127\.0\.0\.1|localhost:[0-9]+|/Users/|C:\\\\Users" -- .

# Review final diff.
git status --short
git diff --stat main...HEAD
git diff main...HEAD -- .
```

Expected result:

- The first command should print nothing.
- Any grep hits should be individually justified, generalized, or removed.
- The final diff should contain only productization cleanup and intentional product skill moves.

## Suggested follow-up commit themes

Use one or more of these themes depending on the local inspection result:

- remove local skill files
- productize reusable workspace skills
- untrack private local agent files
- generalize remaining local workflow fingerprints
