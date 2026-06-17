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

# AI Code IDE

一个本地优先、主要面向个人桌面使用的 AI 代码编辑器，支持 AI Agent、多供应商 LLM 接入和自定义 endpoint。

## 功能

- 📁 **文件管理** — 文件树浏览、多标签编辑、创建/删除/重命名
- ✏️ **Monaco Editor** — 语法高亮、代码折叠、多光标、主题
- 🤖 **AI Agent 模式** — AI 自主读写文件、执行命令、搜索代码
- 🔄 **多供应商切换** — OpenAI / Anthropic / DeepSeek / Gemini / Ollama
- 🔗 **自定义 Endpoint** — 支持任何 OpenAI 兼容 API
- 🔒 **安全存储** — API Key 使用 Electron safeStorage 加密
- 💬 **流式聊天** — Markdown 渲染、代码高亮、实时输出
- 🔧 **工具可视化** — Agent 执行过程透明展示

## 快速开始

### 环境要求

- Node.js >= 20 且 < 27（本地开发当前可用 Node 22/26；`.nvmrc` 推荐 Node 22）
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

这个项目当前按**个人本地 IDE**设计，不按多用户/SaaS/不可信插件宿主建模：配置、会话、索引和 Agent 工作区都默认留在本机。安全策略重点是限制 Agent 对已授权工作区之外的访问、把远端写操作和高风险命令留给用户确认；不是强隔离沙箱。

> 完整的项目方向、优先级与统一安全口径见 **[`CLAUDE.md`](./CLAUDE.md)（项目宪章）** —— 多 agent 协作时以它为准。

## 项目结构

```
src/
├── main/                  # Electron 主进程
│   ├── index.ts           # 入口，窗口创建，IPC 注册
│   ├── preload.ts         # 安全桥接 API
│   └── services/
│       ├── ai-service.ts      # 多供应商 AI 适配层
│       ├── file-service.ts    # 文件系统操作
│       ├── store-service.ts   # 持久化存储
│       └── terminal-service.ts # 终端 + 命令执行
├── renderer/              # React 前端
│   ├── App.tsx
│   ├── main.tsx
│   ├── context/           # 全局状态管理
│   │   ├── AIContext.tsx
│   │   ├── EditorContext.tsx
│   │   └── WorkspaceContext.tsx
│   ├── components/
│   │   ├── layout/        # 布局组件
│   │   ├── sidebar/       # 文件树
│   │   ├── editor/        # Monaco 编辑器
│   │   ├── chat/          # AI 聊天面板
│   │   └── settings/      # 设置界面
│   ├── styles/
│   └── types/
└── shared/                # 主进程/渲染进程共享
    ├── types.ts           # 类型定义
    └── tools.ts           # Agent 工具定义
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

> 完整工具集共 40+ 个，涵盖文件、代码分析、Git、Worktree、命令、Web、GitHub 等。

## 代码语义检索（Embedding）

在「设置 → 代码索引」配置 embedding 模型后，`codebase_search` 工具使用**真正的向量语义检索**——理解概念而非仅匹配关键词（例如问"哪里处理了超时重试"，即使代码里没有这些字眼也能命中）。

- **OpenAI 兼容**：支持 DeepSeek (`deepseek-embedding-v2`)、OpenAI (`text-embedding-3-small`)、本地 Ollama (`nomic-embed-text` / `bge-m3`) 等任意兼容端点
- **增量缓存**：代码切块后按内容 hash 缓存向量到本地，仅在文件变化时重算，重启不丢
- **优雅降级**：未配置 embedding 时自动回退到符号索引 + 全文检索，零影响

## 上下文与性能

- **Prompt Caching** — Anthropic 请求自动对 system prompt、工具定义和历史前缀打 `cache_control` 缓存断点，Agent 多轮循环显著降低 token 成本。
- **上下文压缩** — 长会话超过阈值时自动将早期对话压缩为摘要，避免上下文无限增长。
- **`@` 文件引用** — 在对话中输入 `@path/to/file` 即可把该文件完整内容注入上下文。
- **持久化记忆** — `save_context` / `load_context` 落盘到本地存储，重启不丢失。
- **Agent 鲁棒性** — 工具失败按错误类型自动重试（指数退避），并检测无进展的重复调用自动停止。

## 内联补全（FIM）

内联补全会自动探测当前模型能力：

- **专用代码模型走 FIM（Fill-In-the-Middle）** — 同时利用光标前后文，补全更快更准：
  - **DeepSeek** V3/V4（`deepseek-v4-pro` / `deepseek-v4-flash` / `deepseek-chat`）→ `/beta` completions + `suffix`
  - **Mistral Codestral** → 专用 `/v1/fim/completions` 端点
  - **本地模型**（Ollama/vLLM）：Qwen-Coder、DeepSeek-Coder、StarCoder2、CodeLlama、CodeGemma 等 → 按各自 sentinel token 格式
- **聊天模型自动回退** — Claude / GPT / Gemini 无 FIM 接口，回退到聊天式补全（原逻辑）
- FIM 模型补全又快又省，debounce/cooldown 自动调低（150ms / 300ms），聊天模型保持保守节流（300ms / 2s）
- **编辑感知预测**：记录最近的编辑作为上下文，补全会预测"下一处自然修改"（类 Cursor Tab，如批量重命名/应用同一模式）

## 代码导航与编辑

- **find_definition / find_references**：Agent 工具，基于符号表的跳转定义 + 按词边界的全工作区引用查找，用于评估改动影响面
- **Apply Model（容差编辑应用）**：`replace_in_file` 编辑通过三级级联应用——精确 → 忽略空白/缩进 → 首尾锚点，模型引用片段有空白差异也能成功落地
- **可验证交付物（Artifacts）**：每轮 Agent 改完代码自动产出交付报告（改动文件 + ESLint/tsc 验证结果 + diff 统计），存到 `.ide/artifacts/`，面板可查看

## 测试

```bash
npm test          # 运行测试（vitest）
npm run test:watch
```

纯逻辑模块（Apply Model、命令策略、FIM 探测、agent 工具）已有单元测试覆盖。

## 项目规则

在项目根目录放置规则文件，会自动追加到 Agent 的系统提示词中（按优先级取第一个存在的）：

`AGENTS.md` → `.cursorrules` → `.cursor/rules` → `.github/copilot-instructions.md` → `CLAUDE.md`

适合定义代码风格、技术栈约定、禁止事项等项目级 Agent 行为。

## 自动 lint 自愈

Agent 完成一轮文件改动后，会自动对**它改过的文件**跑 ESLint + tsc 检查；若发现错误，自动把诊断结果回喂给 Agent 让它修复（每轮最多一次），形成"改完即查、查到即修"的自愈循环。

## 检查点回滚

每一轮 Agent 改动前会自动快照涉及的文件。对话面板底部的「检查点」列表可一键**回滚该轮的全部文件改动**（新建的文件会被删除，修改的文件还原到改动前），相当于 Agent 操作的安全网。

## 多模态输入

对话输入框支持**粘贴截图**或点击 🖼 附加图片，发送给支持视觉的模型（如 DeepSeek-VL、Qwen-VL、Claude、GPT-4o 等）。常用于贴报错截图、设计稿、UI 草图。

## 安全审批

三档审批模式（对话面板顶部切换，默认「自动」）：

| 档位 | 读 | 工作区写入 | shell 命令 | 危险命令 |
|------|----|-----------|-----------|---------|
| 🔒 只读 | 放行 | 手动批准 | 手动批准 | 手动批准 |
| ⚖️ 自动（默认） | 放行 | 预览后 5 秒自动接受（可拒绝） | 直接执行 | **强制手动批准** |
| ⚡ 完全 | 放行 | 全自动 | 全自动 | 全自动 |

危险命令（`rm -rf`、`git push --force`、`git reset --hard`、`curl … \| sh`、`sudo`、`chmod 777`、`mkfs`、`dd`、fork bomb 等）无论何种档位都会强制弹出审批并标红提示。

## 支持的 AI 供应商

- **OpenAI** — GPT-4o, GPT-4o-mini, o1
- **Anthropic** — Claude Sonnet 4, Claude 3.5 Haiku, Claude 3 Opus
- **DeepSeek** — DeepSeek Chat, DeepSeek Coder
- **Google Gemini** — Gemini 2.5 Pro/Flash
- **Ollama** — 本地模型 (Llama3, CodeLlama, Mistral...)
- **自定义** — 任何 OpenAI 兼容 endpoint

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
