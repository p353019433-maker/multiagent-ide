# Personalization Guide

MultiAgent IDE should feel personal after setup, but the repository itself should stay clean and reusable. The core rule is:

> Put shared product behavior in the repository. Put personal workflow, private endpoints, local tools, and secret-bearing rules in ignored local files or app settings.

## What belongs in the repository

These are product-level defaults and should remain generic:

- provider schema and preset examples
- approval modes and command policy
- Agent tool definitions
- code search and indexing behavior
- UI components and interaction model
- public docs and examples
- tests for shared behavior

Avoid naming one developer's model routing, local proxy port, private CLI aliases, personal prompts, or workspace habits in public docs or source comments.

## What belongs in local configuration

These should stay out of git:

- real API keys
- private provider endpoints
- local gateway URLs
- model nicknames tied to one setup
- local CLI names and paths
- personal Agent roles or identity files
- private project rules
- private UI/design skills used for one-off local work
- workspace-specific scratch files

Recommended ignored paths:

```text
.local/
*.local.json
*.local.md
.agent.local.md
agents.local.md
.env
.env.*.local
.ide/
.claude/skills/
.opencode/skills/
.superpowers/
```

## Provider setup

Use the app settings to add providers. Prefer neutral provider names in docs and examples:

```text
OpenAI-compatible
Anthropic
Gemini
Ollama / local model
Custom endpoint
```

For personal setups, keep the exact endpoint and model routing local. For example, do this in app settings or a private local note, not in README:

```text
baseURL=http://127.0.0.1:<private-port>/v1
model=<private-model-alias>
```

## Workspace rules

The app loads project rules from the first available file in this order:

```text
AGENTS.md
.cursorrules
.cursor/rules
.github/copilot-instructions.md
CLAUDE.md
```

Use repository-level rules for behavior that all users should share. Use ignored local rules for personal workflow:

```text
.agent.local.md
.local/rules.md
```

Examples of good public rules:

- code style
- test command
- build command
- architecture constraints
- known project conventions

Examples of private local rules:

- preferred model names
- local CLI commands
- private endpoint routing
- personal tone or workflow preferences
- temporary experiment instructions

## Skills

Skills are optional workflow modules loaded by `use_skill`. Keep the default product boundary clean:

```text
.multiagent/skills/   # shareable project-level skills, only if intentionally public
.local/skills/        # private local skills, ignored by git
.claude/skills/       # compatibility path only, ignored by git
```

Do not commit one-off UI/design skills, local review prompts, personal taste guides, or provider-specific skill packs unless they are intentionally productized and useful to all users.

If a skill is worth sharing, make it generic first:

- remove personal taste and local machine assumptions
- remove private model/provider names
- remove one-off project context
- add neutral examples
- document when the skill should be used

## CLI integrations

The app repairs PATH for GUI-launched desktop sessions so common CLI tools can be found. Keep code comments generic; document specific local tools in ignored local notes.

Good public wording:

```text
Repair PATH for CLI tools launched from macOS GUI sessions.
```

Avoid public wording like:

```text
Make my local claude/codex/custom-agent command work.
```

## Security and privacy

Local personalization can contain sensitive data. Do not commit:

- app config exports with tokens
- local endpoint URLs if they identify private infrastructure
- `.ide/` artifacts containing prompts, diffs, or code snippets
- logs containing model requests or tool outputs
- project rules that reveal private workflow or credentials
- local skills that encode personal UI taste, private review criteria, or private workflow assumptions

If a personal file is useful as a template, convert it into an example with placeholders before committing.

## Product-clean checklist

Before pushing, check whether a change makes the project feel like one person's workstation instead of a configurable product:

- Does it say "the author" where it should say "the user" or "personal developer"?
- Does it name a private model, local proxy, or personal CLI?
- Does it encode a workflow that should be a profile/preset instead?
- Does it make a private rule public?
- Does it ship a local UI/design skill as a built-in feature?
- Does it assume one school, one machine, one account, or one provider?

If yes, move it to local config, a preset example, or a docs recipe.
