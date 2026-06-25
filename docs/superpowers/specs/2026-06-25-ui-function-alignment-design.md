# UI / 功能对应设计: Codex/ZCode 式任务工作台

Date: 2026-06-25
Status: Draft approved in conversation; awaiting written-spec review

## 1. Goal

The app already has real agent capabilities: provider-backed chat, tool execution, file edits, git/worktree isolation, multi-role orchestration, approval gates, checkpoints, artifacts, indexing, GitHub tools, editor and terminal drawers. The UI should make those capabilities understandable without putting every configuration control on the main page.

The product direction is an agent-first task workbench, not a traditional IDE and not a round-table/debate UI.

Core principle:

> Main page = run tasks. Settings = configure capabilities. Right side = live evidence and results.

## 2. Chosen approach

Use a Codex/ZCode-style task workbench:

```text
┌──────────────────────────────────────────────────────────────────┐
│ Top bar: project / branch / index status              settings    │
├───────────────┬───────────────────────────────────┬──────────────┤
│ Task list      │ Current task conversation          │ Run details  │
│               │                                   │ auto-shown   │
│ - New task     │ - User messages                    │              │
│ - History      │ - Agent responses                  │ - Tools      │
│ - Worktree     │ - Composer                         │ - Changes    │
│               │   [Model] [Multi-role] [Send]       │ - Approval   │
└───────────────┴───────────────────────────────────┴──────────────┘
```

Rejected alternatives:

- Minimal chat-only UI: too little visibility for worktree, tool calls, and multi-role execution.
- Traditional IDE workbench: exposes too much low-frequency functionality on the main page and pulls the product away from agent-first task execution.

## 3. Main page information architecture

### 3.1 Left column: tasks and workspace

The left column exists to answer:

- Which workspace is open?
- Which task am I in?
- What tasks exist?
- Is this task isolated in a worktree?

It should show:

- Project / workspace entry.
- New task action.
- New isolated task / worktree action.
- Conversation history.
- Lightweight task status markers:
  - current task
  - running
  - failed / needs attention
  - worktree / isolated task

It should not show:

- Provider configuration.
- API keys.
- Embedding model configuration.
- GitHub token settings.
- Role prompts or multi-role parameter details.
- Safety/approval policy controls.

### 3.2 Center: current task conversation

The center exists to answer:

- What did I ask?
- What is the agent saying?
- How do I continue or stop this task?

It should show:

- Current conversation timeline.
- User messages.
- Agent responses.
- Streaming text.
- Composer.
- Model selector.
- Multi-role toggle.
- Attachment/image entry.
- Send / stop action.
- Readiness empty state when required setup is missing.

The model selector and multi-role toggle stay on the main page because they affect how the current task runs. Detailed provider and role configuration belongs in settings.

### 3.3 Right column: run inspector

The right column is not a static feature menu. It is a context-sensitive inspector that appears when the current task has live evidence or result details.

It appears automatically when any of these are present:

- Tool execution rows.
- Pending approval.
- File changes or artifacts.
- Checkpoints.
- Multi-role execution state.
- Multi-role result.
- Validation / lint / self-heal errors.

It hides when there is no run state, unless the user has manually pinned or reopened it.

The inspector should show sections, not a heavy tab system at first:

- Current status.
- Pending approval.
- Tool calls.
- Changed files / artifacts.
- Checkpoints / revert.
- Multi-role stages.
- Errors and validation results.

Rule:

> Center = conversation. Right = evidence.

Tool logs, diff evidence, and approval prompts should not flood the main chat timeline. The timeline shows summaries and outcomes; the inspector shows operational detail.

## 4. Runtime state flow

### 4.1 Idle

Only task list and current conversation are visible. The right inspector is hidden.

Composer shows:

- Selected model.
- Multi-role toggle.
- Send button.

### 4.2 User sends a task

The user message appears immediately. Composer switches to running mode.

If the agent is only streaming text, the right inspector can remain hidden.

### 4.3 Tool execution starts

The right inspector auto-opens and shows the tool timeline:

```text
Run details
✓ read MainLayout
✓ read TaskPanel
⏳ edit CSS
```

### 4.4 Approval needed

The inspector becomes an approval surface:

```text
Needs approval
Operation: modify file
File: MainLayout.tsx

[View diff]
[Reject] [Allow]
```

Approval should not interrupt the conversation layout.

### 4.5 Files changed

The inspector shows changed files and checkpoint actions:

```text
Changed files
✓ MainLayout.tsx
✓ TaskPanel.tsx

[Open editor] [Revert this turn]
```

Clicking a file opens the existing editor drawer.

### 4.6 Multi-role run

When multi-role is enabled, the inspector shows stage progress:

```text
Multi-role
✓ Analyze
✓ Propose
⏳ Critique
○ Synthesize
○ Execute

Worktree: task-...
```

The center timeline should show concise status and the final summary, not every internal stage log.

### 4.7 Error / self-heal

Validation errors appear in the inspector with actionable controls:

- Copy error.
- Open related file.
- Let agent retry / continue.

The center timeline summarizes that validation failed and whether self-heal is running.

### 4.8 Completed

After completion, keep the inspector visible as a result summary until the user closes it or switches task:

- Tool count.
- Changed file count.
- Tests / validation state.
- Checkpoint availability.
- Continue prompt.

## 5. Settings information architecture

Settings should be reorganized around capability configuration:

```text
Settings
├─ Models & Providers
├─ Agent / Multi-role
├─ Indexing & Code Understanding
├─ GitHub / External Services
├─ Safety & Approval
├─ Editor & Appearance
└─ Advanced / Diagnostics
```

### 5.1 Models & Providers

Configure:

- Providers.
- API keys.
- Base URLs.
- Model lists.
- Default model.
- Connection test.

Main page only shows the lightweight model selector.

### 5.2 Agent / Multi-role

Configure:

- Role names.
- Role prompts / responsibilities.
- Role enablement.
- Role temperature.
- Multi-role defaults.

The page should explain that multi-role is a single-agent multi-stage task flow, not a revived round-table UI.

### 5.3 Indexing & Code Understanding

Configure:

- Embedding provider.
- Embedding model.
- Reindex action.
- Index status and errors.

Main page only shows lightweight index status.

### 5.4 GitHub / External Services

Configure:

- GitHub token.
- Repository recognition status.
- Explanation of external write operations.

GitHub writes still require approval in the right inspector when invoked by the agent.

### 5.5 Safety & Approval

Configure:

- Approval mode: readonly / auto / full.
- allowExternalInFull.
- Dangerous command policy explanation.
- External operation confirmation behavior.

Main page does not need a full safety settings surface. A small read-only safety status is optional.

### 5.6 Editor & Appearance

Configure:

- Theme.
- Font.
- Tab size.
- Word wrap.
- Inline completion / FIM behavior.

The editor remains a drawer opened from changed files or the top-bar editor button.

### 5.7 Advanced / Diagnostics

Configure / expose:

- Export logs.
- Clear caches.
- Open config location.
- Version information.
- Reload window.

## 6. Component mapping

### 6.1 MainLayout

Owns global shell only:

- TitleBar.
- WorkbenchLeft.
- TaskPanel.
- Editor drawer.
- Terminal drawer.
- Command palette.

It should not own run-detail semantics. TaskPanel should decide whether the run inspector appears.

### 6.2 WorkbenchLeft

Owns:

- Workspace summary.
- New task.
- New isolated task.
- Task list.
- Task status markers.

### 6.3 TaskPanel

Owns:

- Conversation timeline.
- Composer.
- Model selector.
- Multi-role toggle.
- Streaming state.
- Abort.
- RunInspector visibility state.

Recommended internal structure:

```text
TaskPanel
├─ ConversationHeader
├─ ConversationTimeline
├─ RunInspector
└─ Composer
```

### 6.4 RunInspector / DeliveryTray

The existing DeliveryTray should evolve into a clearer RunInspector.

It should render sections for:

- Current status.
- Pending approval.
- Tool execution timeline.
- Changed files / artifacts.
- Checkpoints.
- Multi-role stage state.
- Errors / validation.

### 6.5 ModelPicker

Keep on the main page, but simplify it. It should be a quick selector plus a path to settings when no model/provider is configured.

### 6.6 Multi-role toggle

Keep near the composer. It affects the next run, so it belongs in the run controls.

The toggle copy should explain:

> Splits this task into analyze, propose, critique, synthesize, and execute phases.

### 6.7 SettingsWorkbench

Reorganize tabs to match the capability groups above. The first implementation can rename and regroup existing sections without redesigning every sub-form.

### 6.8 CommandPalette

Update commands to match the new information architecture:

- New task.
- New isolated task.
- Open settings: models.
- Open settings: multi-role.
- Open settings: indexing.
- Open settings: safety.
- Open editor.
- Open terminal.
- Switch theme.

## 7. Implementation priority

### Phase 1: Main workbench alignment

- WorkbenchLeft wording and status markers.
- TaskPanel composer with model selector + multi-role toggle clearly placed.
- RunInspector auto-show/hide logic.
- DeliveryTray renamed or visually reframed as run evidence.
- Right inspector sections for tools, approval, changes, checkpoints, multi-role.

### Phase 2: Settings alignment

- Rename and regroup settings tabs.
- Move low-frequency surfaces into appropriate settings sections.
- Add explanatory copy for providers, indexing, GitHub, safety, and multi-role.

### Phase 3: Polish

- Empty states.
- Running animations.
- Better task status dots.
- Multi-role progress visuals.
- Completion summary.

## 8. Non-goals

- Do not bring back round-table/debate UI.
- Do not make the editor or terminal permanent main-page columns.
- Do not expose API key or provider forms on the main page.
- Do not reintroduce external CLI agent runner UI.
- Do not redesign every settings sub-form in the first pass.

## 9. Acceptance criteria

- A user can understand the main page as: task list, current task, run details.
- A user can run a normal task without seeing low-frequency configuration.
- A user can switch model and multi-role mode from the composer.
- Runtime details appear automatically when useful and disappear when irrelevant.
- Tool calls, approvals, changed files, checkpoints, and multi-role stages have clear homes in the right inspector.
- Provider/API key/index/GitHub/safety/appearance configuration is discoverable in settings.
- The UI no longer suggests a round-table/debate product model.
