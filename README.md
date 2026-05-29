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
| `edit_file` | 局部编辑文件 |
| `list_directory` | 列出目录内容 |
| `search_files` | 全项目文本搜索 |
| `run_command` | 执行 shell 命令 |

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
