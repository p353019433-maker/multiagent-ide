# AI Code IDE

一个带 AI Agent 能力的桌面代码编辑器，支持多供应商 LLM 接入和自定义 endpoint。

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

- Node.js >= 18
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
| `codebase_search` | 语义/概念检索（符号索引 + 相关度打分，回退全文） |
| `run_command` | 执行 shell 命令 |

> 完整工具集共 40+ 个，涵盖文件、代码分析、Git、Worktree、命令、Web、GitHub 等。

## 上下文与性能

- **Prompt Caching** — Anthropic 请求自动对 system prompt、工具定义和历史前缀打 `cache_control` 缓存断点，Agent 多轮循环显著降低 token 成本。
- **上下文压缩** — 长会话超过阈值时自动将早期对话压缩为摘要，避免上下文无限增长。
- **`@` 文件引用** — 在对话中输入 `@path/to/file` 即可把该文件完整内容注入上下文。
- **持久化记忆** — `save_context` / `load_context` 落盘到本地存储，重启不丢失。
- **Agent 鲁棒性** — 工具失败按错误类型自动重试（指数退避），并检测无进展的重复调用自动停止。

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
