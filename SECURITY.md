# Security Policy

MultiAgent IDE is a local-first desktop application for personal developer use. It is not designed as a multi-tenant SaaS, remote IDE, or untrusted plugin host.

## Threat model

The project primarily protects against:

- accidental destructive Agent actions
- commands that can damage local files or system state
- writes outside the authorized workspace
- silent external or irreversible actions
- accidental secret leakage into git
- unsafe web fetching patterns such as localhost/private-network SSRF

The project does not currently aim to provide:

- strong sandbox isolation for untrusted code
- multi-user access control
- enterprise compliance controls
- isolation between mutually untrusted users or plugins
- secure remote hosting out of the box

## Never commit

Do not commit:

```text
.env
.env.*.local
.local/
*.local.json
*.local.md
.agent.local.md
agents.local.md
.ide/
*.log
node_modules/
dist/
release/
.claude/settings.local.json
.openclaw/
```

The `.gitignore` excludes these paths, but `git add -f` can still override it.

## Secrets

Provider API keys and GitHub tokens should be stored through the app's secret flow, which uses Electron `safeStorage` when available.

Do not put secrets in:

- source code
- README examples
- screenshots
- issue bodies
- PR descriptions
- logs
- local rule files that may be committed later

If a secret was committed, rotate it immediately. Deleting it from the latest commit is not enough if the repository is public.

## Local data

The app can store local state such as:

- provider configuration
- conversation metadata
- workspace artifacts
- Agent checkpoints
- code snippets used in prompts or tool outputs
- index/cache data

Treat `.ide/`, logs, app config exports, and local profile files as private unless explicitly scrubbed.

## Commands and Agent automation

The app has command approval modes and dangerous command detection. These are guardrails against mistakes, not a complete sandbox.

Use more restrictive approval modes when opening unfamiliar repositories. Do not rely on the app to safely execute arbitrary untrusted code.

## Web and GitHub access

Web fetching should reject localhost, private IP ranges, metadata IPs, and unsafe redirects. GitHub write operations should remain explicit external actions unless the user intentionally opts into less restrictive behavior.

## Reporting security issues

For now, open a private channel with the maintainer if possible. If using a public issue, do not include secrets, private URLs, logs, screenshots with tokens, or complete local config files.
