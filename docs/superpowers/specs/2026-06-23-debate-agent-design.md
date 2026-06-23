# 单 Agent 多角色辩论式执行 — 产品重构设计

**日期**：2026-06-23
**项目**：AI Code IDE（重构后拟更名，待定）
**状态**：已批准，待执行
**作者**：brainstorming 流程产出（用户 + 主导 agent）

---

## 1. 背景与动机

### 1.1 我们做了什么实验

项目初版是一个对标 Cursor / Codex / Antigravity 的本地优先 AI 代码编辑器，核心卖点是**多 Agent 圆桌编排**：把不同公司出的 AI 编码工具（Claude Code、Codex、Antigravity、OpenCode）和纯 API Agent 凑到一起，让它们并行评审、各自在隔离 worktree 里实现、最后评分合并。

### 1.2 实验结论

效果不好，甚至不如单 Agent。根因：

1. **异构 Agent 无法真正协调** — 每个 CLI 有自己的工具集、系统提示词、上下文窗口和协议，没法让它们用统一"语言"协作。提示词能否传进去、传对也各不一样。
2. **Worktree 隔离切断了共享上下文** — 每个 Agent 在自己的分支里改代码，彼此不知道队友改了啥；评审阶段的产出跟实现阶段是脱节的。
3. **CLI Agent 不可靠** — 经常超时、额度用完、模型掉线；圆桌编排里只要有一个环节 fail，整体都得等。
4. **单 Agent 反而有优势** — 完整上下文窗口、知道自己每一步在做什么、失败了自己修复。

### 1.3 这次重构要解决什么

不是"修好多 Agent 圆桌"，而是**换一条路**：把"多 Agent 协作"的预期收益（更全面的思考、更少的盲区），用"单 Agent 内部多角色辩论"的方式实现出来。

学术和产品界已有验证信号：Anthropic Extended Thinking、self-consistency、Reflection、Mixture of Agents，本质上都是"让模型自己跟自己辩论"来提高质量。我们要做的是把这种能力变成**用户可配置、过程透明、成本可控**的产品。

### 1.4 用户定位

作者本人（本地单用户）。按 `CLAUDE.md` 项目宪章的安全口径：本机单用户环境，不按多租户/防攻击者裁剪。实用性 > 自动化 > 智能化 > 性能 > 整洁。

---

## 2. 产品形态

### 2.1 形态定位

**桌面应用**（沿用现有 Electron 框架），但**砍掉 VSCode 式的"实时看代码 / 手动改代码"那套**。

体验对标 Codex / Claude / Antigravity 桌面端：用户只管下任务、看过程、验收结果，所有代码操作完全交给 Agent。

### 2.2 核心差异化

把 Codex / Claude 那种"单 Agent 单角色"改成 **"单 Agent 内部多角色讨论式执行"**。用户面对的是一个 Agent，但这个 Agent 内部走 **解析 → 方案 → 异议 → 修订 → 综合 → 执行** 的结构化辩论流程。不同角色可以挂不同的模型 / API。

跟 Codex / Claude 桌面端拉开差距的关键：**用户能看到内部讨论过程**，觉得这个 Agent 在"思考"，而不只是"吐文字"。信任感来自透明度。

### 2.3 不在范围（暂不做）

- Monaco 编辑器、文件树、标签页（`src/renderer/components/editor/`、`sidebar/`）
- 内联补全 FIM（`src/shared/fim.ts`、相关 IPC）
- 终端面板 UI（`terminal-service.ts` 保留给 agent 用，UI 砍掉）
- 代码语义检索 / 索引（`index-service.ts`、`codebase-search-service.ts`）— agent 自己用 `search_files` 工具够用
- 现有的圆桌编排（`useRoundTable.ts`、`agentReview.ts`、`agentDiscussion.ts`、`agentImplementation.ts`）— 用新的辩论流程替换
- CLI Agent 适配（`cli-agent-service.ts`）— 不再 spawn 外部 CLI
- MCP（沿用宪章决定，暂缓）

> 这些模块**先不动代码、不删除**，只是不在新产品主流程里接进去。等新流程跑通后再统一清理，避免重构期间破坏可回滚性。

---

## 3. 架构

### 3.1 保留复用（现有资产）

| 现有模块 | 在新产品里的角色 |
|---|---|
| `headlessTaskRunner.ts` | 执行阶段核心，原样复用 |
| `toolExecutor.ts` + `shared/tools.ts` | 工具系统，原样复用 |
| `ai-service.ts` | 多供应商 LLM 网关，原样复用 |
| `ipc.ts` + `preload.ts` + 安全围栏 | IPC 层，原样复用 |
| `git-service.ts` worktree 隔离 | 执行阶段沙箱，原样复用 |
| `useApproval.ts` + `command-policy.ts` | 审批系统，原样复用 |
| `store-service.ts` + `safeStorage` | 配置持久化，原样复用 |
| `agent-log-service.ts` | 诊断日志，原样复用 |

### 3.2 新建模块

| 新模块 | 位置 | 职责 |
|---|---|---|
| 辩论编排引擎 | `src/renderer/task-engine/debate-engine.ts` | 驱动固定 6 阶段流程，替代 `useRoundTable.ts` |
| 角色定义 | `src/shared/roles.ts` | 内置 5 个角色的系统提示词 + 输入输出 schema |
| 工作文档类型 | `src/shared/scratchpad.ts` | 结构化演进文档的类型定义 |
| 辩论视图 | `src/renderer/components/debate/DebateView.tsx` | 流式展示讨论过程 |
| 角色配置 UI | `src/renderer/components/settings/RolesSettings.tsx` | 给每个角色选模型 / API |
| 任务上下文瘦身 | `src/renderer/context/TaskContext.tsx`（重构） | 砍掉编排内联代码，分离辩论状态 |

### 3.3 数据流

```
用户下任务
    │
    ▼
debate-engine.run(request)
    │
    ├─ 阶段1 解析员 → ai.chat(角色1, scratchpad) → 写 analysis
    ├─ 阶段2 方案者 → ai.chat(角色2, scratchpad) → 写 proposal
    ├─ 阶段3 异议者 → ai.chat(角色3, scratchpad) → 写 critiques
    ├─ 阶段4 方案者 → ai.chat(角色2, scratchpad) → 写 revised_proposal + changes + dismissed
    ├─ 阶段5 综合者 → ai.chat(角色5, scratchpad) → 写 final_plan
    │
    └─ 阶段6 执行 → headlessTaskRunner.run(final_plan.steps)
                      └─ 在 worktree 里写代码、跑验证、自动修复
                          └─ 产出 diff + 验证结果 → 用户验收
```

固定 6 步。讨论阶段 5 次模型调用 + 执行阶段 1 次（执行内部可能多轮工具调用，但对外是 1 个阶段）。**最多 6 次顶层模型调用**，成本可控、可预测。

---

## 4. 核心流程：结构化辩论

### 4.1 六阶段定义

| 阶段 | 角色 | 读 | 写 | 推荐模型 |
|---|---|---|---|---|
| 1 | 解析员 | `request` | `analysis` | 便宜快（DeepSeek Flash） |
| 2 | 方案者 | `analysis` | `proposal` | 强推理（Claude Opus / GLM-5.2） |
| 3 | 异议者 | `proposal` | `critiques` | 不同的强模型（避免跟方案者同源 bias） |
| 4 | 方案者 | `proposal` + `critiques` | `revised_proposal` + `changes` + `dismissed` | 同阶段 2 |
| 5 | 综合者 | `proposal` + `revised_proposal` + `critiques` | `final_plan` | 最强（Claude Opus） |
| 6 | 执行 | `final_plan.steps` | diff + 验证结果 | headlessTaskRunner（用执行角色的模型） |

### 4.2 为什么是"结构化辩论"而不是"自由讨论"或"刚性流水线"

- **不要自由讨论**：发散容易收敛难，token 失控，用户看不懂，最难实现。
- **不要刚性流水线**：评审发现大问题没法回退修正，方案容易表面化。
- **结构化辩论**：方案者 vs 异议者各说一次（限轮次），综合者拍板。像真实工程设计评审：工程师画图 → 其他人 review 提 2-3 个必须解决的问题 → 工程师改一版 → 技术经理拍板。

### 4.3 流程约束

1. **辩论限轮次** — 方案者 vs 异议者各出场一次（阶段 2 + 阶段 4），不无限扯皮。
2. **每轮输出固定结构** — 异议者不是自由说话，而是填 `[{severity, issue, suggestion}]` 数组。
3. **方案者能看到异议、能针对性修改** — 有来有回，但只有一次。
4. **综合者做最后裁决** — 不是投票，而是由一个角色"拍板"。
5. **角色不需要自己规划下一步** — 流程已定死，它只按要求输出。

### 4.4 流程是固定的（决定 1 选 A）

系统内置这套 6 阶段流程，用户只能调每个角色挂哪个模型 / API，**不能改流程结构**。先做固定流程把效果跑通，后面要扩展再加可编排。

---

## 5. 数据结构：Scratchpad（工作文档）

贯穿整个流程的"共享记忆"。每个角色只读自己需要的前置字段、只写自己的字段。

```typescript
interface Scratchpad {
  request: string;              // 用户原始问题（不变）

  // 阶段1 解析员写入
  analysis: {
    requirements: string[];     // 拆解出的需求点
    constraints: string[];      // 技术约束 / 项目约定
    context: string;            // 相关的现有文件、代码片段
  };

  // 阶段2 方案者写入
  proposal: {
    approach: string;           // 总体思路
    files: {
      path: string;
      action: "create" | "modify" | "delete";
      reason: string;
    }[];
    steps: string[];            // 实施步骤
  };

  // 阶段3 异议者写入
  critiques: {
    severity: "high" | "medium" | "low";
    issue: string;
    suggestion: string;
  }[];

  // 阶段4 方案者第二次写入
  revised_proposal: {
    approach: string;
    files: Scratchpad["proposal"]["files"];
    steps: string[];
  };
  changes: string[];            // 针对每条 critique 改了什么
  dismissed: { issue: string; reason: string }[];  // 决定不改的及理由

  // 阶段5 综合者写入
  final_plan: {
    approach: string;
    steps: { action: string; target: string; detail: string }[];
    rollback: string;           // 出错怎么回滚
  };
}
```

**关键点**：每个字段都是强类型 JSON，不是自由文本。下一阶段精确解析，不靠碰运气。

---

## 6. 提示词设计

### 6.1 三段式结构

每个角色的提示词都遵循同一模板：

```
[段1 · 你是谁]
角色人格 + 思考方式 + 关注什么

[段2 · 你拿到什么]
当前 Scratchpad 里该角色需要读的字段（以 JSON 形式贴进去）

[段3 · 你要输出什么]
精确的 JSON schema + 字段说明 + 约束（如"critiques 必须是 2-3 条"）
```

好处：改提示词 = 改三段中任意一段，互不影响。调人格动段 1，调上下文动段 2，调输出格式动段 3。

### 6.2 交接示意（阶段 2 → 阶段 3）

阶段 2 方案者产出后，Scratchpad 含 `proposal`。阶段 3 异议者收到的提示词：

```
你是一个严格的代码评审员。你的任务是评估下面的方案。

【当前方案】
方案者提出的方案是：用 ripgrep 实现全文搜索

【你的任务】
找出 2-3 个该方案可能的问题，按严重程度排序。
对于每个问题，给出具体建议。

【输出格式】
{
  "critiques": [
    {
      "severity": "high|medium|low",
      "issue": "问题的具体描述",
      "suggestion": "建议的改进方案"
    }
  ]
}
```

异议者输出后，Scratchpad 追加 `critiques`。阶段 4 方案者收到的提示词：

```
你之前提出了一个方案。现在收到了以下评审意见。
请针对每条意见，要么修改方案，要么给出不接受的理由。

【你的原方案】
用 ripgrep 实现全文搜索

【评审意见】（2 条）
1. [高] ripgrep 需要作为外部依赖安装...
2. [中] 没有搜索文件名...

【输出格式】
{
  "revised_proposal": { "approach": "...", "files": [...], "steps": [...] },
  "changes": ["逐条描述你改了什么"],
  "dismissed": [{ "issue": "你决定不改的问题", "reason": "为什么不改" }]
}
```

### 6.3 三条原则

1. **上下文的每一行都是精确定义的结构**，不是"给我看看方案"这种模糊指令。
2. **角色不需要自己规划下一步** — 流程已定死，它只按要求输出。
3. **提示词里不夹杂对话记忆** — 每次调用模型的消息就是"角色说明 + 当前 Scratchpad 的 JSON + 输出格式要求"，没别的。

### 6.4 写好提示词是唯一真正难的地方

技术实现（Electron、IPC、服务编排）项目里已有。**提示词 + Scratchpad 结构设计是这个系统唯一真正难的工程**。需要在实际跑通后反复迭代调优。

---

## 7. 五个角色的分工

| 阶段 | 角色 | 人格定位 | 推荐模型 | 温度建议 |
|---|---|---|---|---|
| 1 | 解析员 | 务实、拆解需求、收集上下文 | 便宜快（DeepSeek Flash） | 低 |
| 2 | 方案者 | 系统设计思维、考虑可维护性 | 强推理（Claude Opus / GLM-5.2） | 低 |
| 3 | 异议者 | 挑剔、找漏洞、爱唱反调 | 不同的强模型（避免跟方案者同源 bias） | 中高 |
| 4 | 方案者 | 同阶段 2，但带着异议修订 | 同阶段 2 | 低 |
| 5 | 综合者 | 决断、拍板、不纠结 | 最强（Claude Opus） | 低 |

用户可在设置里给每个角色重新指定模型 / API / 温度。上表是默认推荐。

---

## 8. 用户界面

### 8.1 主界面三区域

砍掉编辑器 / 文件树后，主界面只有三个区域：

```
┌─────────────────────────────────────┐
│  任务输入框（顶部）                  │
├─────────────────────────────────────┤
│                                     │
│  讨论过程展示区（主体）              │
│                                     │
│  ▸ [解析员] 拆解出 3 个需求...       │
│  ▸ [方案者] 方案：用 X 实现...       │
│  ▸ [异议者] 发现 2 个问题：...       │
│  ▸ [方案者] 已采纳 1 条，修订...     │
│  ▸ [综合者] 终版方案：...            │
│  ▸ [执行] 正在写代码 (3/5 步)...     │
│                                     │
├─────────────────────────────────────┤
│  结果验收区（底部）                  │
│  改动文件列表 + diff + 验证结果       │
│  [采纳] [回滚] [继续讨论]            │
└─────────────────────────────────────┘
```

### 8.2 流式展示

讨论过程**流式展示**——每个角色输出时实时滚动出来，让用户有"看着它在思考"的感觉。这是跟 Codex / Claude 桌面端拉开差距的核心。

### 8.3 结果验收

执行阶段产出后，底部展示：
- 改动文件列表
- 每个文件的 diff
- 验证结果（lint / tsc / 测试）
- 三个动作按钮：**采纳**（合并到主分支）/ **回滚**（删 worktree）/ **继续讨论**（把执行结果喂回综合者再走一轮）

### 8.4 设置页

- **角色配置**：每个角色一张卡片，选模型 / API / 温度
- **供应商管理**：沿用现有 `SettingsWorkbench.tsx` 的供应商 CRUD
- **审批档位**：沿用现有三档（只读 / 自动 / 完全）

---

## 9. 实施阶段（建议拆分）

> 详细步骤由后续 writing-plans 产出，这里只给高层拆分。

1. **阶段 A：Scratchpad + 角色定义** — `scratchpad.ts`、`roles.ts`，纯类型和提示词，可单测
2. **阶段 B：辩论编排引擎** — `debate-engine.ts`，6 阶段驱动 + 流式回调，可单测（mock ai.chat）
3. **阶段 C：UI 重构** — 砍掉编辑器 / 文件树，新建 `DebateView` 三区域布局
4. **阶段 D：角色配置 UI** — `RolesSettings.tsx`
5. **阶段 E：接通执行阶段** — debate-engine 产出的 `final_plan` 喂给 `headlessTaskRunner`
6. **阶段 F：TaskContext 瘦身** — 砍掉编排内联代码、分离辩论状态、清理废弃模块
7. **阶段 G：跑通端到端 + 调提示词** — 用真实任务验证，迭代提示词和 Scratchpad 结构

---

## 10. 风险与待解

| 风险 | 缓解 |
|---|---|
| 提示词写不好，角色输出不合规 | JSON schema 强约束 + 解析失败重试一次 + 日志可观测 |
| 模型不支持 JSON 输出 | 综合 / 方案角色选支持 function calling 或强 JSON 的模型 |
| 6 次调用的延迟叠加体验差 | 流式展示 + 阶段间可中断 |
| 执行阶段失败无法恢复 | 沿用 worktree 隔离 + 检查点回滚（已有） |
| TaskContext 重构影响面大 | 阶段 F 放最后，前面新模块独立可测 |

### 待解问题（留给 writing-plans）

- Scratchpad 的 `context` 字段：解析员怎么收集？调 `search_files` 工具还是只读用户指定的文件？
- 执行阶段的 `final_plan.steps` 跟 `headlessTaskRunner` 现有入参怎么对齐？
- "继续讨论"按钮把执行结果回喂综合者，Scratchpad 要不要加 `execution_result` 字段？
- 多轮任务（用户在同一个会话里连续下多条指令）时，Scratchpad 是每条指令重建还是累积？

---

## 11. 成功标准

1. 一个用户下任务后，能看到 6 阶段讨论过程流式展开
2. 不同角色能挂不同模型 / API（设置可配）
3. 执行阶段在 worktree 里产出可验收的 diff + 验证结果
4. 用户能采纳 / 回滚 / 继续讨论
5. 整个流程成本可控（顶层 ≤ 6 次模型调用 + 执行阶段工具调用）
6. 端到端跑通一个真实任务（如"给项目加文件搜索功能"），产出质量优于现有单 Agent 直跑

---

## 12. 跟项目宪章（CLAUDE.md）的对齐

- **实用性 / 自动化 / 智能化优先**：辩论流程默认全自动跑通，只在危险操作和最终验收留人。
- **单用户本地**：不按多租户裁剪，沿用现有安全口径。
- **质量门**：每个阶段模块配单测；提交前 `npm test` + `tsc` 全绿。
- **不泄密**：API Key 继续走 safeStorage，不进仓库 / 日志 / 提示词。
- **范围克制**：砍掉大而全 IDE 功能，聚焦多角色辩论这一条主线做到极致。

---

_本设计由 brainstorming 流程产出，待 writing-plans 拆成实施计划后进入执行。_
