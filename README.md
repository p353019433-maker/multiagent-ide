<!--
╔══════════════════════════════════════════════════════════════════════╗
║  DreamSeed 种梦计划 — AI创造者大赛  官方 README 模板                ║
║                                                                      ║
║  使用说明：                                                          ║
║  1. 将本模板放在参赛仓库根目录 README.md 的顶部                       ║
║  2. 头图使用 DreamField 官方公开活动图片地址                         ║
║  3. 请保留 DREAMFIELD_README_HEADER_START / END 标识                 ║
║  4. 分割线以下供创作者自由编写项目内容                               ║
╚══════════════════════════════════════════════════════════════════════╝
-->

<!-- DREAMFIELD_README_HEADER_START -->

<p align="center">
  <a href="https://www.dreamfield.top">
    <img src="https://www.dreamfield.top/dream-field/contest-readme/assets/dreamseed-readme-banner.png" alt="DreamSeed 种梦计划参赛作品" width="100%" />
  </a>
</p>

<!-- DREAMFIELD_README_HEADER_END -->

# MultiAgent IDE

一个本地优先、面向个人开发者的 AI 代码编辑器。它提供可配置的 Agent 工作流、多供应商 LLM 接入、代码检索、终端执行、Git/GitHub 集成和本地个性化规则。

## 当前状态

本项目是一个桌面端个人开发工具，仍在活跃迭代中。它不是多租户 SaaS、远程开发平台或不可信插件宿主。默认假设用户在自己的本机上运行，并通过本地配置选择模型、endpoint、规则和审批模式。

完整方向与长期边界见 [`CLAUDE.md`](./CLAUDE.md)；个性化配置方式见 [`docs/PERSONALIZATION.md`](./docs/PERSONALIZATION.md)。

## 功能

- 📁 **文件管理** — 文件树浏览、多标签编辑、创建/删除/重命名
- ✏️ **Monaco Editor** — 语法高亮、代码折叠、多光标、主题
- 🤖 **AI Agent 模式** — AI 自主读写文件、执行命令、搜索代码
- 🔄 **多供应商切换** — OpenAI-compatible / Anthropic / Gemini / Ollama / 本地模型
- 🔗 **自定义 Endpoint** — 支持任意 OpenAI 兼容 API
- 🔒 **安全存储** — provider key / GitHub token 使用 Electron safeStorage 加密；普通 UI 配置不承诺加密
- 💬 **流式聊天** — Markdown 渲染、代码高亮、实时输出
- 🔧 **工具可视化** — Agent 执行过程透明展示

## 快速开始

### 环境要求

- Node.js >= 20 且 < 27（推荐 Node 22）
- npm >= 9

### 安装

```bash
npm install
```

### 开发模式

```bash
npm run dev
```

这会同时启动 Vite dev server 和 Electron 窗口。

### 构建

```bash
npm run build
```

产物在 `release/` 目录。

## 本地使用定位

这个项目按**个人本地 IDE**设计，不按多用户/SaaS/不可信插件宿主建模：配置、会话、索引和 Agent 工作区都默认留在本机。安全策略重点是限制 Agent 对已授权工作区之外的访问、把对外写操作和高风险命令留给用户确认；不是强隔离沙箱。

## 个性化方式

项目只提供通用能力，个人工作流应通过本地配置表达：

- provider 和 endpoint：在应用设置里配置，不写进仓库
- 工作区规则：使用 `AGENTS.md`、`.cursorrules`、`.cursor/rules`、`.github/copilot-instructions.md` 或 `CLAUDE.md`
- 本地私有规则：使用 `*.local.md`、`.agent.local.md`、`.local/` 等被 `.gitignore` 排除的文件
- 本地工具链：通过 PATH repair 和设置页接入，不把单个用户的 CLI 名称写进项目文案

详见 [`docs/PERSONALIZATION.md`](./docs/PERSONALIZATION.md)。

## 项目结构

```
src/
├── main/                          # Electron 主进程
│   ├── index.ts                   # 入口、窗口创建、服务装配、IPC 注册
│   ├── preload.ts                 # contextBridge 安全桥接（白名单）
│   ├── ipc.ts                     # IPC 总线（来源/路径围栏、危险操作确认）
│   └── services/
│       ├── ai-service.ts          # 多供应商 AI 适配（OpenAI 兼容 / Anthropic）
│       ├── file-service.ts        # 文件系统操作
│       ├── git-service.ts         # git + worktree
│       ├── github-service.ts      # GitHub REST
│       ├── web-service.ts         # web_search / web_fetch（含 SSRF 防护）
│       ├── terminal-service.ts    # node-pty 终端 + 命令执行
│       ├── store-service.ts       # 持久化配置；secret 在 IPC/AIService 层用 safeStorage 加密
│       ├── file-watcher-service.ts# 文件监听（增量触发索引失效）
│       ├── index-service.ts / index-scan.ts / index-worker.ts  # 符号/向量索引（worker 线程）
│       ├── bm25.ts / hybrid.ts    # BM25 + RRF 混合检索
│       └── codebase-search-service.ts  # codebase_search 编排（hybrid→符号→全文）
├── renderer/                      # React 前端
│   ├── task-engine/               # Agent 引擎
│   │   ├── useTaskEngine.ts       # 多轮循环、重试、lint 自愈、检查点
│   │   ├── toolExecutor.ts        # 工具分发 + 参数校验 + 审批门
│   │   ├── headlessTaskRunner.ts  # 无人值守执行（策略更严）
│   │   ├── debate-engine.ts       # 多角色辩论 → 隔离 worktree 执行
│   │   ├── applyEdit.ts           # 容差编辑（精确→忽略空白→首尾锚点）
│   │   └── useApproval.ts / taskUtils.ts / validateToolArgs.ts
│   ├── context/                   # 全局状态（Workspace / Editor / Task / Theme）
│   ├── components/                # layout / workbench / task / settings / editor / terminal / palette
│   └── utils/
└── shared/                        # 主进程/渲染进程共享
    ├── types.ts                   # 类型定义
    ├── tools.ts                   # Agent 工具定义 + 系统提示
    ├── command-policy.ts          # 危险命令拦截 + 三档审批矩阵
    ├── fim.ts                     # FIM 能力探测
    └── roles.ts / scratchpad.ts   # 多角色辩论协议
```

## AI Agent 工具

Agent 模式下 AI 可以调用以下工具：

| 工具 | 说明 |
|------|------|
| `read_file` | 读取文件内容 |
| `write_file` | 创建/覆盖文件 |
| `replace_in_file` | 局部编辑文件 |
| `list_directory` | 列出目录内容 |
| `search_files` | 全项目文本搜索 |
| `codebase_search` | 向量语义检索（配置 embedding 后），回退符号/全文 |
| `run_command` | 执行 shell 命令 |

完整工具集涵盖文件、代码分析、Git、Worktree、命令、Web、GitHub 等。具体可用能力以当前代码实现和测试结果为准。

## 代码语义检索（Embedding）

在「设置 → 代码索引」配置 embedding 模型后，`codebase_search` 工具使用向量语义检索，理解概念而非仅匹配关键词。

- **OpenAI 兼容**：支持 OpenAI、DeepSeek、本地 Ollama 等任意兼容端点
- **混合检索（hybrid）**：向量 + BM25 + 符号，经 RRF（Reciprocal Rank Fusion）融合，可选 LLM 重排（失败自动熔断）
- **增量缓存**：代码切块后按内容 hash 缓存向量到本地；文件变化时索引自动失效、仅重算改动的切块
- **优雅降级**：未配置 embedding 时自动回退到符号索引 + 全文检索

## 多角色辩论（Multi-Role Debate）

把一个任务交给多个角色串行打磨，再在隔离 worktree 中执行终版方案：

**解析员 → 方案者 → 批评者 → 方案者（修订）→ 综合者**，最后由**执行者**在 `<root>_wt/<branch>` worktree 里跑通。各角色通过共享的 scratchpad 单向传递结构化中间产物（需求 / 方案 / 批评 / 终版计划 + 回滚方案）。执行结果可一键采纳为新会话或丢弃，删除会话时其 worktree 也会一并回收。

## 上下文与性能

- **Prompt Caching** — 对支持缓存的 provider 自动设置缓存断点，降低多轮 Agent 成本
- **上下文压缩** — 长会话超过阈值时自动将早期对话压缩为摘要，避免上下文无限增长
- **`@` 文件引用** — 在对话中输入 `@path/to/file` 即可把该文件完整内容注入上下文
- **持久化记忆** — `save_context` / `load_context` 落盘到本地存储，重启不丢失
- **Agent 鲁棒性** — 工具失败按错误类型自动重试（指数退避），并检测无进展的重复调用自动停止

## 内联补全（FIM）

内联补全会自动探测当前模型能力：

- **专用代码模型走 FIM（Fill-In-the-Middle）** — 同时利用光标前后文
- **聊天模型自动回退** — 无 FIM 接口时回退到聊天式补全
- **编辑感知预测** — 记录最近的编辑作为上下文，补全会预测下一处自然修改

## 代码导航与编辑

- **find_definition / find_references**：基于符号表的跳转定义 + 全工作区引用查找
- **Apply Model（容差编辑应用）**：`replace_in_file` 编辑通过三级级联应用：精确 → 忽略空白/缩进 → 首尾锚点
- **Artifacts**：每轮 Agent 改完代码自动产出交付报告（改动文件 + ESLint/tsc 验证结果 + diff 统计），存到 `.ide/artifacts/`

## 测试

```bash
npm test          # 运行测试（vitest）
npm run test:watch
```

纯逻辑模块（Apply Model、命令策略、FIM 探测、agent 工具）已有单元测试覆盖。

## 项目规则

在项目根目录放置规则文件，会自动追加到 Agent 的系统提示词中（按优先级取第一个存在）：

`AGENTS.md` → `.cursorrules` → `.cursor/rules` → `.github/copilot-instructions.md` → `CLAUDE.md`

适合定义代码风格、技术栈约定、禁止事项等项目级 Agent 行为。个人私有规则建议使用 `.agent.local.md` 或 `.local/`，不要提交到仓库。

## 自动 lint 自愈

Agent 完成一轮文件改动后，会自动对**它改过的文件**跑 ESLint + tsc 检查；若发现错误，自动把诊断结果回喂给 Agent 让它修复（每轮最多一次）。

## 检查点回滚

每一轮 Agent 改动前会自动快照涉及的文件。对话面板底部的「检查点」列表可一键**回滚该轮的全部文件改动**。

## 多模态输入

对话输入框支持粘贴截图或附加图片，发送给支持视觉的模型。常用于贴报错截图、设计稿、UI 草图。

## 安全审批

三档审批模式（对话面板顶部切换，默认「自动」）：

| 档位 | 读 | 工作区写入 | shell 命令 | 对外/不可逆操作 |
|------|----|-----------|-----------|----------------|
| 🔒 只读 | 放行 | 手动批准 | 手动批准 | 手动批准 |
| ⚖️ 自动（默认） | 放行 | 预览后自动接受（可拒绝） | 安全命令直接执行；危险命令手动批准 | 手动批准 |
| ⚡ 完全 | 放行 | 全自动 | 本地命令尽量自动 | 默认仍需确认，除非用户显式允许 |

危险命令（`rm -rf`、`git push --force`、`git reset --hard`、`curl … \| sh`、`sudo`、`chmod 777`、`mkfs`、`dd`、fork bomb 等）会被识别并进入更严格的确认流程。

## 支持的 AI 供应商

- **OpenAI-compatible** — OpenAI、DeepSeek、本地网关、自定义 endpoint 等
- **Anthropic** — Claude 系列模型
- **Google Gemini** — 通过 OpenAI-compatible endpoint 或 preset 接入
- **Ollama / 本地模型** — 本地推理与 embedding
- **自定义** — 任何兼容项目接口约定的 provider

## 技术栈

- Electron 33
- React 18 + TypeScript
- Vite 6
- Monaco Editor
- Tailwind CSS
- xterm.js (终端)
- OpenAI SDK + Anthropic SDK

## License

MIT
