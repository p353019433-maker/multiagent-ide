# 全维度全量代码审查 + 修复执行计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 对 `src/` 全量代码做 6 维度审查（安全 / 性能 / 架构 / 代码质量 / 测试 / 可维护性），将发现按 P0/P1/P2 分级落地修复，commit 到 `main`，最终在聊天中输出报告。

**Architecture:** 6 个 Explore 子代理并发扫各自维度 → 主协调者整合去重 + 分级 + 排序 → 按 P0 → P1 → P2 顺序批量修复，每批 `tsc` + `vitest` 验证 → 全部修完后最终全量验证 + 输出报告。

**Tech Stack:** Electron 33, React 18, TypeScript 5.7, Vite 6, Vitest 2.1, Monaco Editor, xterm.js, OpenAI SDK, Anthropic SDK

**Spec:** `docs/superpowers/specs/2026-06-15-code-review-design.md`

---

## 文件清单

**审查范围（51 个源文件，7 个测试文件）：**

主进程 (15)：
- `src/main/index.ts`, `src/main/ipc.ts`, `src/main/preload.ts`
- `src/main/services/{ai-service, analysis-service, codebase-search-service, file-service, git-service, github-service, index-service, store-service, terminal-service, web-service}.ts`

渲染端 (28)：
- `src/renderer/{App, main}.tsx`, `src/renderer/theme.ts`, `src/renderer/types/api.d.ts`
- `src/renderer/agent/{agentUtils, applyEdit, toolExecutor, useAgentEngine, useApproval}.ts(x)`
- `src/renderer/components/{chat, editor, layout, search, settings, sidebar, terminal, ui}/*.tsx`
- `src/renderer/context/{AIContext, EditorContext, ThemeContext, WorkspaceContext, conversationStore}.ts(x)`

Shared (4)：
- `src/shared/{command-policy, fim, tools, types}.ts`

**测试文件 (7)：** `ai-service.test.ts`, `agentUtils.test.ts`, `applyEdit.test.ts`, `toolExecutor.integration.test.ts`, `conversationStore.test.ts`, `command-policy.test.ts`, `fim.test.ts`

**将创建/修改的产出文件：**
- 报告输出位置：**仅聊天中**（不创建文件）
- commit 历史：落到 `main` 分支

---

## Phase 0：环境基线

### Task 0.1：确认基线干净 + 基线测试通过

**Files:**
- Read: `git status`, `tsc` 输出, `vitest` 输出

- [ ] **Step 1：确认工作区干净**

Run: `git status`
Expected: `nothing to commit, working tree clean`

- [ ] **Step 2：跑 TypeScript 编译检查基线**

Run: `npx tsc -p tsconfig.main.json --noEmit`
Expected: 0 errors（如果有 error，记下来作为基线噪声，纳入"未修"列表）

- [ ] **Step 3：跑测试基线**

Run: `npm test`
Expected: 所有现有测试通过，记录测试数量为 `N`

- [ ] **Step 4：记录基线数据**

在聊天中记录：`tsc 0 errors / N tests passing / 工作区 clean`，作为后续验证对照。

---

## Phase 1：派遣 6 个并行扫描代理

### Task 1.1：调用 dispatching-parallel-agents skill

**Files:**
- 无（流程触发）

- [ ] **Step 1：声明 skill**

"I am now using the dispatching-parallel-agents skill to dispatch 6 parallel scan agents."

- [ ] **Step 2：按 skill 规范派遣 6 个 Explore 子代理**

每个代理的自包含任务描述（写入 prompt 中）：

**Agent 1 — 安全**
```
目标：对 `src/` 全量做安全审查。
重点关注：
- IPC 边界：src/main/preload.ts, src/main/ipc.ts 暴露的 channel 是否有最小权限、参数校验？
- 路径处理：所有 fs 操作（file-service, codebase-search-service, index-service, git-service, web-service）是否做 symlink 解析 + workspace 内约束？是否存在 ../ 路径穿越？
- 命令执行：terminal-service, git-service, web-service 中的 child_process / spawn / exec 是否过滤 shell 元字符？危险命令拦截（rm -rf, sudo 等）是否真的拦得住？
- 密钥：store-service 中 API key 存储是否用 safeStorage？是否有明文落盘？
- 渲染端：contextMenu, chat 消息渲染是否使用 dangerouslySetInnerHTML？是否做 XSS 防护？
- webview/iframe 边界：BrowserPreview 是否限制导航目标？
不做：性能、命名、API 设计风格判断。
输出格式（每条发现）：
[P0/P1/P2] 标题
文件:行号 | 模块
问题描述（贴 5-10 行代码）
风险/影响
修复建议（具体改动方向，不超过 3 句）
```

**Agent 2 — 性能**
```
目标：对 `src/` 全量做性能审查。
重点：
- 大文件/大列表渲染：FileTree, ChatPanel, SearchPanel, AgentToolView, conversationStore
- 重复计算：useMemo / useCallback 缺失、embedding 缓存命中率
- agent 循环：useAgentEngine 的循环退出条件、无限重试风险
- 内存：是否有事件监听器未清理、setInterval/setTimeout 未 clear、订阅未 unsubscribe
- 启动：ipc 注册、services 初始化是否有阻塞 main thread
- I/O：同步 fs、未限流的网络请求
不做：UI 命名、API 设计、严重 bug 判断。
输出格式同 Agent 1。
```

**Agent 3 — 架构**
```
目标：对 `src/` 全量做架构审查。
重点：
- 模块边界：main / renderer / shared 的依赖方向是否单向？是否有 renderer import main 的反模式？
- 循环依赖：import graph 检查
- 单一职责：单个文件是否做了 3+ 件不相关的事？
- 接口清晰度：service 暴露的方法是否职责单一、命名一致？
- 数据流：Context (AIContext, EditorContext, WorkspaceContext, ThemeContext) 之间的耦合度
- 工具层：src/shared/tools.ts 与 toolExecutor 的契约是否清晰？
不做：单文件内代码风格、严重 bug。
输出格式同 Agent 1。
```

**Agent 4 — 代码质量**
```
目标：对 `src/` 全量做代码质量审查。
重点：
- 类型安全：是否有 any, as unknown as, @ts-ignore, @ts-expect-error
- 错误处理：try/catch 是否吞错？是否有未处理的 promise rejection？
- 命名：函数名/变量名是否反映意图？
- 可读性：单个函数是否超过 50 行？嵌套深度 > 4？
- 重复代码：是否有多处 copy-paste 的相似逻辑？
- 注释：必要的位置是否有注释？是否有死注释（描述已不存在的代码）？
不做：架构、严重 bug。
输出格式同 Agent 1。
```

**Agent 5 — 测试覆盖**
```
目标：对 `src/` 评估测试覆盖。
已知 7 个测试文件：ai-service, agentUtils, applyEdit, toolExecutor.integration, conversationStore, command-policy, fim。
重点：
- 关键路径覆盖：preload IPC handlers、file-service 路径校验、terminal-service 命令执行、index-service 增量更新、git-service ref 解析、codebase-search-service 检索逻辑、ai-service 工具调用 — 哪些有/没有测试？
- 边界条件：空字符串、超长输入、并发、错误返回 — 现有测试是否覆盖？
- 可测性：是否有大量逻辑埋在 React 组件里（不易单测）？
不做：性能优化、UI bug。
输出格式同 Agent 1。
```

**Agent 6 — 可维护性**
```
目标：对 `src/` 做可维护性审查。
重点：
- 日志/可观测性：console.log/error/warn 是否散布在生产代码？关键错误是否有上下文？
- 配置硬编码：是否有 magic number 散落各文件（超时、重试次数、token 限制）？
- 依赖卫生：package.json 的 deps 是否都用到了？是否有未使用的 devDeps？
- 文档：复杂逻辑（agent 工具调用、embedding 索引、approval 流）是否有内联解释？
- 未来兼容性：是否使用了 deprecated API？是否有硬编码的版本号？
- 类型导出：shared/types.ts 是否完备？是否所有需要共享的类型都已 export？
不做：短期 bug、UI 命名。
输出格式同 Agent 1。
```

- [ ] **Step 3：等待 6 个代理全部返回**

Expected: 6 份结构化报告，每份包含若干条 P0/P1/P2 发现。

- [ ] **Step 4：原始报告先在聊天中转储**（不丢上下文）

用 markdown 表格或编号列表把所有发现暂存，供后续整合用。

---

## Phase 2：整合去重 + 分级排序

### Task 2.1：去重

**Files:**
- 无（协调者内部分析）

- [ ] **Step 1：按 (文件:行号 + 问题类型) 聚类**

把 6 份报告的所有发现放入一个数组，按 `file:line` 和问题关键词聚类。

- [ ] **Step 2：识别重复**

如果同一条问题被 ≥ 2 个代理报告，提升一档严重程度（如 P1 → P0）。

- [ ] **Step 3：识别关联**

如果多个发现本质是同一个根因（如 preload 暴露 channel + 服务端缺校验），合并为一条。

- [ ] **Step 4：输出整合后清单**

格式：`[#编号] [P?] 维度 — 文件:行 — 标题`，带原始发现 ID 索引。

### Task 2.2：分级排序

**Files:**
- 无

- [ ] **Step 1：套用 P0/P1/P2 标准**

- P0：安全 / 数据丢失 / 必崩
- P1：性能严重退化 / 明显 bug
- P2：代码质量 / 风格

- [ ] **Step 2：构建修复批次**

把同文件或同模块的 P0 归到同一批；P1 类似。

- [ ] **Step 3：在聊天中输出完整分级清单**

让用户看到完整地图。形式：
```
P0 批 1（X 个）：
  #1 [安全] preload.ts:42 — ...
  #2 [性能] index-service.ts:88 — ...
P0 批 2（X 个）：...
P1 批 1（X 个）：...
...
```

- [ ] **Step 4：检查是否需要用户决策**

如果有"灰色"问题（介于 P0 和 P1 之间），在聊天中明确询问用户，按用户判断调整。

---

## Phase 3：修复循环

> **每个发现按本 Phase 的 TDD 适配模式修复。** 由于审查是"找到啥修啥"，本 phase 的代码块用"伪代码 + 占位说明"展示动作结构，实际代码由协调者根据 `Task 2.1` 的清单逐条填入。

### Task 3.0：通用修复模式（每条发现都按此执行）

**Files:**
- Modify: 由 `Task 2.1` 清单的 `文件:行号` 决定

- [ ] **Step 1：定位代码 + 读懂上下文**

```bash
# 读取目标文件 + 上下文
sed -n '<行号-10>,<行号+10>p' <文件>
```

- [ ] **Step 2：评估修复范围**

判断：单文件局部 vs 跨文件大改？若评估为"跨文件大改 > 15 分钟手动改"，**降级为 P3**，跳到 Step 7 标记"未修"。

- [ ] **Step 3：写/扩展测试（如果修复是逻辑类）**

- 若修复涉及可测试的纯逻辑（路径校验、命令拦截、agent 工具、applyEdit 等），在对应 `*.test.ts` 加测试用例
- 若修复是 React 组件 / 简单风格调整，可跳过本步

```bash
# 跑测试确认能 fail
npm test -- --testPathPattern=<相关测试文件>
```

- [ ] **Step 4：实施修复**

按"修复建议"具体改代码，**保持最小改动**——只动需要动的地方。

- [ ] **Step 5：跑 tsc + 相关测试**

```bash
npx tsc -p tsconfig.main.json --noEmit
npm test -- --testPathPattern=<相关测试文件>
```

Expected: tsc 0 errors + 该测试通过

- [ ] **Step 6：commit**

```bash
git add <修改的文件>
git commit -m "fix(review): #<编号> <维度> — <一句话问题描述>

- 修复内容
- 验证：tsc 通过 / vitest 通过

Refs: code-review 2026-06-15"
```

- [ ] **Step 7：若降级为 P3，标记"未修"**

不 commit，不改代码。在最终报告的"未修"列表中标注。

### Task 3.1：P0 批 1 修复

**Files:**
- 由本批 P0 决定

- [ ] **Step 1：从 `Task 2.2` 输出的 P0 批 1 清单读出本批条目**

- [ ] **Step 2：对每条发现应用 `Task 3.0` 的 7 步模式**

- [ ] **Step 3：批结束后跑全量验证**

```bash
npx tsc -p tsconfig.main.json --noEmit
npm test
```

Expected: tsc 0 errors + 所有测试通过

- [ ] **Step 4：若验证失败，定位并回滚**

```bash
git log --oneline -5
git revert <commit>
```

回到 P0 批 1 之前的 HEAD，单独处理失败的修复。

### Task 3.2：P0 批 2+ 修复（如果还有）

**Files:**
- 由本批 P0 决定

- [ ] **Step 1-N：同 Task 3.1 模式**

- 每个 P0 批都是 Task 3.1 的复制
- 直到所有 P0 修完

### Task 3.3：P1 批 1 修复

- [ ] **Step 1-N：同 Task 3.1 模式**

### Task 3.4：P1 批 2+ 修复

- [ ] **Step 1-N：同 Task 3.1 模式**

### Task 3.5：P2 修复（可选）

- [ ] **Step 1-N：同 Task 3.1 模式**

> 用户可在此选择收尾（不再做 P2）或继续。

---

## Phase 4：最终验证 + 报告

### Task 4.1：全量验证

- [ ] **Step 1：跑 TypeScript 编译**

```bash
npx tsc -p tsconfig.main.json --noEmit
```

Expected: 0 errors

- [ ] **Step 2：跑全部测试**

```bash
npm test
```

Expected: 全通过，对比基线 `N` 个测试，新加的测试数 = 新增 P0/P1/P2 修复带来的

- [ ] **Step 3：构建测试（可选）**

```bash
npm run build:renderer
```

Expected: 无错误

- [ ] **Step 4：对比基线**

在聊天中输出："基线 0 errors / N tests → 当前 0 errors / M tests，差异 = +X 修复带来的新测试"

### Task 4.2：输出报告

- [ ] **Step 1：汇总 commit 列表**

```bash
git log --oneline <基线 commit>..HEAD
```

- [ ] **Step 2：在聊天中输出报告，按 spec 第 8 节结构**

```
## 代码审查报告 — 2026-06-15

### 概述
- 审查范围（src/、6 维度、6 代理并行）
- 6 维度发现统计（P0/P1/P2 数量 + 修复数）

### 已修复（X 个）
表格：[#] [严重] [维度] [文件:行] [标题] [commit]

### 已识别但未修（X 个）
表格：[#] [严重] [维度] [位置] [原因]

### 维度小结
- 安全 / 性能 / 架构 / 代码质量 / 测试 / 可维护性 — 各 2~3 段

### 推荐后续行动
- 不在本次范围内的架构性建议
- 长期改进方向
```

---

## 自检清单

- [x] Spec 覆盖：6 维度扫描 → Phase 1；整合去重 → Phase 2；P0/P1/P2 修复 → Phase 3；报告 → Phase 4
- [x] 占位符检查：Phase 3 用"通用修复模式 + 实际由整合清单填充"代替具体代码，符合"审查-发现-修复"的元任务性质
- [x] 类型一致性：所有"修复 commit 信息格式"统一为 spec 第 7 节
- [x] 任务粒度：每条 Task 2-5 分钟可执行

---

## 异常处理决策表

| 情况 | 行动 |
|---|---|
| 6 代理中某个返回"无发现" | 报告"维度小结"中写"无显著问题" |
| P0 修复后测试失败 | `git revert` 该 commit，单独处理 |
| 单条修复 > 15 分钟手动改 | 降级 P3，不 commit，列入未修 |
| 涉及依赖升级 | 标 P3，列入推荐后续行动 |
| 用户中途叫停 | 输出当前进度 + 已 commit 列表 |
