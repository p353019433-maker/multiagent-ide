# Agent Readiness Design

## Goal

Make the IDE's first usable path obvious: open a workspace, configure a model service, optionally configure semantic indexing, then run an Agent task from the task workbench.

## Scope

This slice improves onboarding and task readiness only. It does not add LSP, debugging, extension hosting, or a new Agent runtime.

## Design

Add a small renderer-side readiness module that derives a stable status from existing app state:

- Workspace: whether `rootPath` is set.
- Model service: whether at least one provider exists and an active provider/model are selected.
- Indexing: whether embedding config is enabled.

The module returns ordered readiness items with labels, status, and action identifiers. UI components can render the same state without duplicating business logic.

## UI Integration

`EditorArea` empty state becomes a compact workbench start surface. It keeps the existing professional IDE layout and adds a short readiness checklist with direct actions for opening a folder, configuring models, opening the task panel, and configuring indexing.

`TaskPanel` replaces the plain "未配置模型服务" message with a readiness-aware blocked state. It should show why the task cannot run and provide a settings action instead of leaving the user at a dead end.

## Boundaries

Actions are local UI callbacks only:

- `openWorkspace`
- `openSettings`
- `openTaskPanel`
- `openIndexSettings`

The readiness module does not call Electron APIs, mutate global state, or inspect files. It is pure and unit-tested.

## Testing

Add unit tests for readiness derivation:

- No workspace and no provider.
- Workspace opened but no provider.
- Provider and model configured.
- Embedding enabled.

Run targeted tests first, then the full suite and production builds.
