# UI Function Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the IDE UI with its real agent workflow: task list, current task conversation, auto-shown run inspector, and settings grouped by capability.

**Architecture:** Keep the existing MainLayout shell and TaskPanel engine. Reframe the left column as the task/workspace navigator, convert DeliveryTray into a context-sensitive RunInspector, keep model + multi-role controls in the composer, and move low-frequency configuration language into SettingsWorkbench.

**Tech Stack:** React + TypeScript, existing Tailwind/CSS token classes, Vitest, Vite build, existing TaskContext/useTaskEngine state.

---

## File Structure

**Modify:**
- `src/renderer/components/workbench/WorkbenchLeft.tsx` — left workspace/task navigator copy and status markers.
- `src/renderer/components/workbench/DeliveryTray.tsx` — evolve to RunInspector behavior/sections without renaming imports yet.
- `src/renderer/components/task/TaskPanel.tsx` — auto-show/hide inspector, remove duplicate tool log from conversation, composer control placement/copy.
- `src/renderer/components/settings/SettingsWorkbench.tsx` — capability-oriented settings navigation labels and explanatory copy.
- `src/renderer/components/layout/MainLayout.tsx` — command palette labels/setting tab targets if needed.
- `src/renderer/types/api.d.ts` — only if SettingsTab names change.

**Test/verify:**
- `node_modules/.bin/tsc -p tsconfig.json --noEmit`
- `node_modules/.bin/vitest run src/renderer/components/task/TaskSessionTabs.test.ts src/renderer/context/TaskContext.test.ts`
- `node_modules/.bin/vitest run`
- `node_modules/.bin/vite build --mode production`

---

### Task 1: Left navigation reflects workspace + task history

**Files:**
- Modify: `src/renderer/components/workbench/WorkbenchLeft.tsx`

- [ ] **Step 1: Adjust copy and task item metadata**

Replace the left-column label language so it reads as task/workspace UI rather than a generic agent workspace. Keep the component's existing API.

Use this shape inside the `conversations.map` block:

```tsx
{conversations.map((conv) => {
  const active = conv.id === activeConversationId;
  const isolated = Boolean(conv.worktree);
  const latest = conv.messages[conv.messages.length - 1];
  const failed = latest?.role === 'assistant' && /失败|error|failed/i.test(latest.content || '');
  return (
    <button
      key={conv.id}
      type="button"
      onClick={() => setActiveConversation(conv.id)}
      className={`my-0.5 grid w-full cursor-pointer grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-2 rounded-[9px] px-[11px] py-[9px] text-left ${
        active
          ? 'border border-border-strong bg-background shadow-[0_1px_3px_rgba(0,0,0,.07)]'
          : 'border border-transparent hover:bg-foreground/[0.05]'
      }`}
    >
      <span
        className={`h-2 w-2 rounded-full ${
          failed ? 'bg-red-400' : active ? 'bg-foreground' : isolated ? 'bg-yellow-400' : 'bg-foreground/20'
        }`}
        aria-hidden="true"
      />
      <span className="block min-w-0 truncate text-[13px] font-medium text-foreground">{conv.title}</span>
      {isolated && (
        <span className="rounded bg-warn-surface px-1.5 py-0.5 font-mono text-10 text-warn">WT</span>
      )}
    </button>
  );
})}
```

- [ ] **Step 2: Update section labels**

Use these labels:

```tsx
<div className="text-10 font-bold uppercase tracking-[0.08em] text-foreground/35">Workspace</div>
...
<div className="px-2 py-1.5 text-10 font-bold uppercase tracking-[0.06em] text-foreground/40">任务</div>
```

- [ ] **Step 3: Run quick typecheck**

Run:

```bash
node_modules/.bin/tsc -p tsconfig.json --noEmit
```

Expected: no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/workbench/WorkbenchLeft.tsx
git commit -m "ui(workbench): align left rail with task navigation"
```

---

### Task 2: Convert DeliveryTray into context-sensitive Run Inspector

**Files:**
- Modify: `src/renderer/components/workbench/DeliveryTray.tsx`

- [ ] **Step 1: Reframe labels and sections**

Keep the component name for now to avoid a broad rename. Change visible copy from generic “Inspector/任务详情” and tab labels into run-evidence language:

```tsx
<div className="text-10 font-bold uppercase tracking-[0.08em] text-foreground/35">Run Inspector</div>
<div className="mt-0.5 text-[13px] font-semibold text-foreground">运行详情</div>
...
<TabBtn id="delivery" label="改动" />
<TabBtn id="commands" label="工具" n={toolExecutions.length} />
<TabBtn id="verify" label="验证" n={artifacts.length} />
<TabBtn id="checkpoint" label="回滚" n={checkpoints.length} />
```

- [ ] **Step 2: Add a status summary at the top of the delivery section**

At the start of the delivery tab content, show a summary card:

```tsx
<div className="mb-3 rounded-[12px] border border-border bg-background px-3.5 py-2.5 shadow-card">
  <div className="text-xs font-semibold text-foreground">本次运行</div>
  <div className="mt-1 grid grid-cols-3 gap-2 font-mono text-10 text-foreground/45">
    <span>{toolExecutions.length} tools</span>
    <span>{deliveredFiles.length} files</span>
    <span>{checkpoints.length} checkpoints</span>
  </div>
</div>
```

- [ ] **Step 3: Keep empty states explicit**

Retain current empty messages but update the commands empty state to:

```tsx
<p className="px-1 text-11 leading-relaxed text-foreground/45">
  Agent 调用工具时会自动显示在这里；对话区只保留上下文和结论。
</p>
```

- [ ] **Step 4: Run focused build check**

Run:

```bash
node_modules/.bin/tsc -p tsconfig.json --noEmit
```

Expected: no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/workbench/DeliveryTray.tsx
git commit -m "ui(workbench): reframe delivery tray as run inspector"
```

---

### Task 3: Auto-show and hide the run inspector from TaskPanel

**Files:**
- Modify: `src/renderer/components/task/TaskPanel.tsx`

- [ ] **Step 1: Add inspector visibility state**

Near existing state declarations, add:

```tsx
const [inspectorDismissed, setInspectorDismissed] = useState(false);
const hasInspectorContent =
  toolExecutions.length > 0 ||
  checkpoints.length > 0 ||
  artifacts.length > 0 ||
  !!pendingApproval ||
  multiRoleRunning ||
  !!multiRoleResult ||
  !!currentDebate;
const showInspector = hasInspectorContent && !inspectorDismissed;
```

- [ ] **Step 2: Reset dismissal when new run evidence appears**

Add this effect after `hasRuntimeRows`:

```tsx
useEffect(() => {
  if (isStreaming || multiRoleRunning || pendingApproval || toolExecutions.some((e) => e.status === 'running')) {
    setInspectorDismissed(false);
  }
}, [isStreaming, multiRoleRunning, pendingApproval, toolExecutions]);
```

- [ ] **Step 3: Stop rendering tool executions in the conversation timeline**

Remove this block from the scrollable conversation body:

```tsx
{toolExecutions.length > 0 && (
  <div className="my-3 overflow-hidden rounded-[10px] border border-border shadow-card">
    {toolExecutions.map((exec) => (
      <ToolExecutionRow key={exec.id} execution={exec} />
    ))}
  </div>
)}
```

Remove the now-unused `ToolExecutionRow` import.

- [ ] **Step 4: Render the inspector conditionally**

Replace the always-visible aside:

```tsx
<aside className="w-[360px] flex-none border-l border-border">
  <DeliveryTray ... />
</aside>
```

with:

```tsx
{showInspector && (
  <aside className="w-[360px] flex-none border-l border-border">
    <div className="flex h-full flex-col">
      <button
        type="button"
        onClick={() => setInspectorDismissed(true)}
        className="self-end px-3 py-2 text-11 text-foreground/45 hover:text-foreground"
        aria-label="关闭运行详情"
        title="关闭运行详情"
      >
        关闭
      </button>
      <div className="min-h-0 flex-1">
        <DeliveryTray
          toolExecutions={toolExecutions}
          checkpoints={checkpoints}
          artifacts={artifacts}
          multiRoleResult={multiRoleResult}
          onRevert={revertCheckpoint}
          onOpen={openFile}
        />
      </div>
    </div>
  </aside>
)}
```

- [ ] **Step 5: Run typecheck**

```bash
node_modules/.bin/tsc -p tsconfig.json --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/task/TaskPanel.tsx
git commit -m "ui(task): auto-show run inspector only when useful"
```

---

### Task 4: Composer controls match current-run semantics

**Files:**
- Modify: `src/renderer/components/task/TaskPanel.tsx`

- [ ] **Step 1: Move model selector closer to composer if needed**

Keep the header model picker for now, but add compact run-mode copy near the composer controls so users understand the model + multi-role affect the next run:

```tsx
<span className="inline-flex items-center rounded-lg px-2.5 py-1 text-[11px] font-semibold text-foreground/50" style={{ background: '#f1f1ef' }}>
  当前任务设置
</span>
```

Place it before the multi-role button in the composer control row.

- [ ] **Step 2: Simplify approval controls from main composer**

Do not remove approval mode controls in this pass, but visually demote them by changing the hint pill text to short status:

```tsx
<span className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold text-foreground/60" style={{ background: '#f1f1ef' }}>
  安全：{APPROVAL_MODE_META[approvalMode].label}
</span>
```

Remove the long `{APPROVAL_MODE_META[approvalMode].hint}` display from the composer.

- [ ] **Step 3: Make multi-role send semantics visible**

Change send button title based on multi-role:

```tsx
title={multiRoleMode ? '启动多角色任务' : '运行任务'}
aria-label={multiRoleMode ? '启动多角色任务' : '运行任务'}
```

- [ ] **Step 4: Run typecheck**

```bash
node_modules/.bin/tsc -p tsconfig.json --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/task/TaskPanel.tsx
git commit -m "ui(task): clarify composer run controls"
```

---

### Task 5: Settings navigation matches capability groups

**Files:**
- Modify: `src/renderer/components/settings/SettingsWorkbench.tsx`
- Modify: `src/renderer/components/layout/MainLayout.tsx`
- Modify: `src/renderer/types/api.d.ts` only if SettingsTab changes are required.

- [ ] **Step 1: Keep existing tab ids but change labels to capability language**

In `SettingsWorkbench.tsx`, update `navItems` to:

```tsx
const navItems: { id: typeof tab; label: string; icon: typeof Users; description: string }[] = [
  { id: 'providers', label: '模型与 Provider', icon: Boxes, description: '配置模型服务、API Key、baseURL 和默认模型' },
  { id: 'roles', label: 'Agent / 多角色', icon: Sparkles, description: '配置多角色阶段、角色职责和运行参数' },
  { id: 'index', label: '索引与代码理解', icon: Search, description: '配置 embedding、语义索引和重建索引' },
  { id: 'editor', label: '编辑器与外观', icon: SettingsIcon, description: '主题、字体、编辑器行为和补全体验' },
];
```

- [ ] **Step 2: Show description under active settings header**

After `activeNavLabel`, compute:

```tsx
const activeNav = navItems.find((item) => item.id === tab);
```

In the main header, replace the simple span with:

```tsx
<div>
  <div className="text-sm font-semibold text-foreground">{activeNav?.label || '设置'}</div>
  {activeNav?.description && <div className="mt-0.5 text-11 text-foreground/45">{activeNav.description}</div>}
</div>
```

- [ ] **Step 3: Add safety/GitHub explanatory placeholders without adding new tabs**

At the bottom of the providers tab, add a small note:

```tsx
<div className="border-t border-editor-border px-3 py-3 text-11 leading-relaxed text-muted-foreground">
  API Key 使用主进程加密存储。GitHub token 和外部写操作确认将在后续设置页中独立展示；当前外部操作仍会在运行详情中要求确认。
</div>
```

- [ ] **Step 4: Update command palette settings labels**

In `MainLayout.tsx`, change command labels:

```tsx
{ id: 'editorSettings', label: '打开设置: 编辑器与外观', keywords: 'theme font tab wrap', run: () => onOpenSettings('editor') },
{ id: 'indexSettings', label: '打开设置: 索引与代码理解', keywords: 'embedding index search semantic', run: () => onOpenSettings('index') },
```

Add:

```tsx
{ id: 'providerSettings', label: '打开设置: 模型与 Provider', keywords: 'provider model api key', run: () => onOpenSettings('providers') },
{ id: 'rolesSettings', label: '打开设置: Agent / 多角色', keywords: 'agent multi role roles', run: () => onOpenSettings('roles') },
```

- [ ] **Step 5: Run typecheck**

```bash
node_modules/.bin/tsc -p tsconfig.json --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/settings/SettingsWorkbench.tsx src/renderer/components/layout/MainLayout.tsx
git commit -m "ui(settings): group configuration by capability"
```

---

### Task 6: Final verification

**Files:**
- No implementation files expected.

- [ ] **Step 1: Run TypeScript checks**

```bash
node_modules/.bin/tsc -p tsconfig.main.json --noEmit
node_modules/.bin/tsc -p tsconfig.json --noEmit
```

Expected: both commands exit 0.

- [ ] **Step 2: Run focused UI-adjacent tests**

```bash
node_modules/.bin/vitest run src/renderer/components/task/TaskSessionTabs.test.ts src/renderer/context/TaskContext.test.ts src/renderer/readiness/agentReadiness.test.ts
```

Expected: all selected tests pass.

- [ ] **Step 3: Run full tests**

```bash
node_modules/.bin/vitest run
```

Expected: all tests pass.

- [ ] **Step 4: Run production renderer build**

```bash
node_modules/.bin/vite build --mode production
```

Expected: build succeeds.

- [ ] **Step 5: Final status**

```bash
git status --short
git log --oneline -6
```

Expected: working tree clean; recent commits show the UI plan and implementation commits.

---

## Self-Review

**Spec coverage:**
- Left task/workspace column: Task 1.
- Center conversation + composer run controls: Tasks 3 and 4.
- Auto-shown right run inspector: Tasks 2 and 3.
- Settings grouped by capability: Task 5.
- Runtime details separated from chat: Tasks 2 and 3.
- Verification: Task 6.

**Placeholder scan:** No TBD/TODO placeholders. All code snippets are concrete.

**Type consistency:** Uses existing component/file names (`DeliveryTray`, `TaskPanel`, `SettingsWorkbench`, `WorkbenchLeft`) and existing data types (`TaskToolExecution`, `Checkpoint`, `Artifact`, `RunDebateTaskResult`).
