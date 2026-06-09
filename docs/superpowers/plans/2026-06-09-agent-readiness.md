# Agent Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a shared Agent readiness model and surface it in the empty editor and task panel so first-run users know the next required action.

**Architecture:** Keep readiness logic pure in `src/renderer/readiness/agentReadiness.ts`. Renderer components consume the derived items and map action IDs to existing callbacks. No Agent runtime, IPC, or settings persistence behavior changes in this slice.

**Tech Stack:** React 18, TypeScript, Vitest, existing Tailwind utility classes, lucide-react icons.

---

### Task 1: Readiness Model

**Files:**
- Create: `src/renderer/readiness/agentReadiness.ts`
- Test: `src/renderer/readiness/agentReadiness.test.ts`

- [ ] **Step 1: Write failing tests**

Test the four expected readiness states: no workspace/provider, workspace without provider, provider/model configured, and embedding enabled.

- [ ] **Step 2: Verify tests fail**

Run: `npm test -- src/renderer/readiness/agentReadiness.test.ts`

Expected: fail because the module does not exist.

- [ ] **Step 3: Implement pure readiness functions**

Create a small typed module with `getAgentReadiness(input)` returning ordered items and `canRunAgent`.

- [ ] **Step 4: Verify tests pass**

Run: `npm test -- src/renderer/readiness/agentReadiness.test.ts`

Expected: pass.

### Task 2: Empty Editor Start Surface

**Files:**
- Modify: `src/renderer/components/editor/EditorArea.tsx`
- Modify: `src/renderer/components/layout/MainLayout.tsx`

- [ ] **Step 1: Thread existing callbacks**

Pass settings and task-panel actions from `MainLayout` into `EditorArea`.

- [ ] **Step 2: Render readiness actions**

Use `getAgentReadiness` in the empty editor state. Keep the current workbench look; add compact action rows.

- [ ] **Step 3: Verify layout tests**

Run: `npm test -- src/renderer/components/layout/MainLayout.test.ts`

Expected: pass.

### Task 3: Task Panel Blocked State

**Files:**
- Modify: `src/renderer/components/task/TaskPanel.tsx`
- Modify: `src/renderer/components/layout/MainLayout.tsx`

- [ ] **Step 1: Pass settings action to TaskPanel**

Allow the panel to open settings when no model service is configured.

- [ ] **Step 2: Replace dead-end copy**

When no provider/model exists, show readiness status and a direct configure action.

- [ ] **Step 3: Run task-panel related tests**

Run: `npm test -- src/renderer/components/task/TaskSessionTabs.test.ts src/renderer/context/TaskContext.test.ts`

Expected: pass.

### Task 4: Full Verification

**Files:**
- No additional files.

- [ ] **Step 1: Run full test suite**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 2: Run builds**

Run: `npm run build:main`

Run: `npm run build:renderer`

Expected: both pass; renderer bundle budgets OK.

- [ ] **Step 3: Browser smoke check**

Start Vite and inspect `http://127.0.0.1:5173/` with Browser. Confirm the empty workbench and task panel show readiness actions.
