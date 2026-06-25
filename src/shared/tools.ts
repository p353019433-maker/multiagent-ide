import type { ToolDefinition } from './types';

/**
 * Expanded task tools.
 * Grouped logically: file ops, code analysis, web, interaction, system.
 */
export const BUILTIN_TOOLS: ToolDefinition[] = [
  // ── File Operations ──
  {
    name: 'read_file',
    description: '读取工作区中某个文件的内容。',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '文件的绝对路径或相对于工作区根目录的路径。',
        },
        offset: {
          type: 'number',
          description: '从第几行开始读取（1-indexed）。用于超长文件的分段读取。',
        },
        limit: {
          type: 'number',
          description: '最多读取多少行。',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description:
      '创建新文件或完全覆盖已有文件。需要用户批准后才执行。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '要写入的文件路径。' },
        content: { type: 'string', description: '完整文件内容。' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'replace_in_file',
    description:
      '替换文件中某个精确匹配的文本块。old_str 必须在文件中唯一出现且精确匹配（包括空白字符）。这是修改已有文件的首选工具（比 write_file 修改整个文件更安全）。需要用户批准后才执行。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径。' },
        old_str: { type: 'string', description: '要被替换的精确文本。' },
        new_str: { type: 'string', description: '替换后的文本。' },
        replace_all: {
          type: 'boolean',
          description: '设为 true 时替换所有匹配（需要用户批准）。',
        },
      },
      required: ['path', 'old_str', 'new_str'],
    },
  },
  {
    name: 'list_directory',
    description: '列出目录中的直接子项。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '目录路径。' },
      },
      required: ['path'],
    },
  },
  {
    name: 'search_files',
    description: '在工作区中搜索文本或正则表达式。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '要搜索的文本或正则表达式。' },
        file_pattern: {
          type: 'string',
          description: '可选的 glob 模式，如 "*.ts" 或 "src/**"，用于限制搜索范围。',
        },
        case_sensitive: {
          type: 'boolean',
          description: '是否区分大小写，默认不区分。',
        },
        include_hidden: {
          type: 'boolean',
          description: '是否包含隐藏文件和目录（. 开头），默认不包含。',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'find_files',
    description: '按 glob 模式查找文件名匹配的文件。例如 "*.tsx"、"test*.ts"。',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob 匹配模式。' },
        directory: {
          type: 'string',
          description: '起始目录，默认为工作区根目录。',
        },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'get_file_info',
    description: '获取文件或目录的详细信息：大小、修改时间、是否为目录。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件或目录路径。' },
      },
      required: ['path'],
    },
  },

  // ── Code Analysis ──
  {
    name: 'read_lints',
    description: '读取当前工作区的 ESLint 或 TypeScript 诊断信息。',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '可选：只检查特定文件或目录。不传则检查整个工作区。',
        },
      },
      required: [],
    },
  },
  {
    name: 'extract_symbols',
    description: '提取 TypeScript/JavaScript 文件中的符号：函数、类、导出、接口等。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '要分析的文件路径。' },
      },
      required: ['path'],
    },
  },
  {
    name: 'find_definition',
    description:
      '查找一个符号（函数/类/接口/类型等）的定义位置（类 go-to-definition）。返回所有声明该名字的文件与行号。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '要查找定义的符号名（精确匹配）。' },
      },
      required: ['name'],
    },
  },
  {
    name: 'find_references',
    description:
      '查找一个标识符在整个工作区的引用位置（类 find-references，按词边界匹配）。用于评估改动影响面。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '要查找引用的标识符。' },
      },
      required: ['name'],
    },
  },
  {
    name: 'codebase_search',
    description:
      '按概念/语义在整个工作区检索最相关的代码位置。先在符号索引（函数/类/接口/类型名）中按相关度打分匹配，再回退到全文搜索。比 search_files 更适合“在哪里实现了 X”“处理 Y 的代码在哪”这类问题——无需事先知道确切关键词。',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '自然语言或关键词描述，如 "用户登录校验" 或 "parse git remote"。',
        },
        limit: {
          type: 'number',
          description: '返回结果数量，默认 10。',
        },
      },
      required: ['query'],
    },
  },

  // ── Planning ──
  {
    name: 'update_plan',
    description:
      '创建或更新当前任务的执行计划（有序待办清单），让用户直观看到多步任务的进度。每次调用都传入【完整】的步骤列表（全量覆盖，不是增量）。适合 3 步以上的任务；琐碎的单步任务不必使用。随进展把步骤标记为 in_progress / completed。',
    parameters: {
      type: 'object',
      properties: {
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              content: { type: 'string', description: '该步骤的简短描述。' },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'completed'],
                description: '步骤状态：pending 待办 / in_progress 进行中 / completed 完成。',
              },
            },
            required: ['content', 'status'],
          },
          description: '完整的有序步骤列表（全量覆盖）。传入空列表或省略即清空当前计划。',
        },
      },
      // `steps` is intentionally NOT required: omitting it clears the plan
      // ("0 步"), which the executor handles. Keeping it required would make the
      // now-wired arg validator reject a legitimate clear-the-plan call.
    },
  },
  {
    name: 'use_skill',
    description:
      '加载一个已安装技能（.claude/skills/<name>/SKILL.md）的完整正文,并严格按其指引执行。当任务匹配系统提示「可用技能」里列出的某个技能时调用;name 用技能的目录名。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '技能名（.claude/skills/ 下的目录名）。' },
      },
      required: ['name'],
    },
  },

  // ── Git Integration ──
  {
    name: 'git_status',
    description: '查看当前 git 仓库状态：改变的文件、分支、暂存区。',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'git_diff',
    description: '查看当前工作区相对于 HEAD 的 diff。',
    parameters: {
      type: 'object',
      properties: {
        staged: { type: 'boolean', description: '是否只显示已暂存的变化。' },
        path: { type: 'string', description: '可选：只显示特定文件的 diff。' },
      },
      required: [],
    },
  },
  {
    name: 'git_log',
    description: '查看 git 提交历史。',
    parameters: {
      type: 'object',
      properties: {
        count: { type: 'number', description: '返回条数，默认 10。' },
      },
      required: [],
    },
  },
  {
    name: 'git_branch_list',
    description: '列出所有分支。',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'git_create_branch',
    description: '创建并切换到新分支。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '新分支名称。' },
      },
      required: ['name'],
    },
  },
  {
    name: 'git_switch_branch',
    description: '切换到已有分支。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '目标分支名称。' },
      },
      required: ['name'],
    },
  },
  {
    name: 'git_commit',
    description: '暂存所有变更并提交。会自动暂存！',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string', description: '提交信息。' },
      },
      required: ['message'],
    },
  },
  {
    name: 'git_push',
    description: '推送当前分支到远程。',
    parameters: {
      type: 'object',
      properties: {
        remote: { type: 'string', description: '远程仓库名，默认 origin。' },
      },
      required: [],
    },
  },
  {
    name: 'git_worktree_list',
    description: '列出当前仓库所有 worktree。',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'git_worktree_add',
    description: '创建新的 git worktree 隔离分支（类似 Codex fork session）。任务可在新 worktree 里独立工作。',
    parameters: {
      type: 'object',
      properties: {
        branch: { type: 'string', description: '新分支名称。' },
        base: { type: 'string', description: '基础分支，默认当前分支。' },
        path: { type: 'string', description: 'worktree 路径，默认自动生成。' },
      },
      required: ['branch'],
    },
  },
  {
    name: 'git_merge',
    description: '将指定分支合并到当前分支。支持 merge/squash/rebase。',
    parameters: {
      type: 'object',
      properties: {
        source: { type: 'string', description: '要合并的源分支。' },
        method: { type: 'string', description: '合并方式：merge（默认）, squash, rebase。' },
      },
      required: ['source'],
    },
  },
  {
    name: 'git_merge_diff',
    description: '查看两个分支之间的差异（源分支相对于目标分支的变更）。',
    parameters: {
      type: 'object',
      properties: {
        base: { type: 'string', description: '基础分支。' },
        head: { type: 'string', description: '比较的分支，默认当前分支。' },
      },
      required: ['base'],
    },
  },

  // ── Command Execution ──
  {
    name: 'run_command',
    description:
      '在工作区中运行 shell 命令。对于需要交互的命令或长时间运行的命令（如 dev server），使用 run_background_command。',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '要执行的 shell 命令。' },
        timeout_ms: {
          type: 'number',
          description: '超时时间（毫秒），默认 60s。设为 0 表示不限制。',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'run_background_command',
    description:
      '启动一个后台命令（如 npm run dev）并返回 session ID。后续使用 get_background_output 检查输出。',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '要在后台执行的命令。' },
      },
      required: ['command'],
    },
  },
  {
    name: 'get_background_output',
    description: '获取后台运行命令的最近输出。',
    parameters: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'run_background_command 返回的 session ID。' },
      },
      required: ['session_id'],
    },
  },
  {
    name: 'kill_background_command',
    description: '终止一个正在运行的后台命令。',
    parameters: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: '要终止的 session ID。' },
      },
      required: ['session_id'],
    },
  },

  // ── Web & External ──
  {
    name: 'web_search',
    description: '在互联网上搜索信息。需要配置搜索 API（Tavily 等）。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词。' },
        count: { type: 'number', description: '结果数量，默认 5。' },
      },
      required: ['query'],
    },
  },
  {
    name: 'web_fetch',
    description: '抓取一个 URL 的内容并提取为文本/Markdown。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '要抓取的 HTTP(S) URL。' },
        extract_mode: {
          type: 'string',
          enum: ['markdown', 'text'],
          description: '提取模式：markdown 或纯文本。默认 markdown。',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'preview_url',
    description: '在 IDE 内置浏览器中预览一个 URL。常用于查看 dev server 的运行效果。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '要预览的 URL。' },
      },
      required: ['url'],
    },
  },

  // ── Multi-file Operations ──
  {
    name: 'read_multiple_files',
    description: '一次性读取多个文件的内容。比多次调用 read_file 更高效。',
    parameters: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: '要读取的文件路径列表。',
        },
      },
      required: ['paths'],
    },
  },
  {
    name: 'search_and_replace',
    description:
      '在整个工作区中按【字面文本】搜索并替换（区分大小写，非正则）。每个文件的改动都会走审批。这是批量重构的有力工具。',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: '要查找的字面文本（精确、区分大小写，不是正则）。' },
        replacement: { type: 'string', description: '替换内容。' },
        file_pattern: {
          type: 'string',
          description: '限制文件范围的 glob 模式，如 "*.ts"。',
        },
        dry_run: {
          type: 'boolean',
          description: '设为 true 只预览不改文件。',
        },
      },
      required: ['pattern', 'replacement'],
    },
  },

  // ── Context & Memory ──
  {
    name: 'save_context',
    description:
      '保存一段上下文信息，供后续会话使用。例如项目的架构概览、关键决策等。',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: '上下文键名。' },
        content: { type: 'string', description: '要保存的内容。' },
        merge: {
          type: 'boolean',
          description: '如果键已存在，是否追加（默认覆盖）。',
        },
      },
      required: ['key', 'content'],
    },
  },
  {
    name: 'load_context',
    description: '加载之前保存的上下文信息。',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: '要加载的上下文键名。' },
      },
      required: ['key'],
    },
  },

  // ── GitHub ──
  {
    name: 'github_list_issues',
    description: '列出 GitHub 仓库的 issues。',
    parameters: {
      type: 'object',
      properties: {
        state: {
          type: 'string',
          enum: ['open', 'closed', 'all'],
          description: 'Issue 状态过滤，默认 open。',
        },
      },
      required: [],
    },
  },
  {
    name: 'github_get_issue',
    description: '获取某个 GitHub issue 的完整内容（含正文）。',
    parameters: {
      type: 'object',
      properties: {
        number: { type: 'number', description: 'Issue 编号。' },
      },
      required: ['number'],
    },
  },
  {
    name: 'github_create_issue',
    description: '在 GitHub 仓库中创建新 issue。需要用户批准后执行。',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Issue 标题。' },
        body: { type: 'string', description: 'Issue 正文（Markdown）。' },
        labels: {
          type: 'array',
          items: { type: 'string' },
          description: '标签列表。',
        },
      },
      required: ['title'],
    },
  },
  {
    name: 'github_list_comments',
    description: '列出某个 issue 的所有评论。',
    parameters: {
      type: 'object',
      properties: {
        number: { type: 'number', description: 'Issue 编号。' },
      },
      required: ['number'],
    },
  },
  {
    name: 'github_add_comment',
    description: '在 issue 上添加评论。需要用户批准后执行。',
    parameters: {
      type: 'object',
      properties: {
        number: { type: 'number', description: 'Issue 编号。' },
        body: { type: 'string', description: '评论正文（Markdown）。' },
      },
      required: ['number', 'body'],
    },
  },
  {
    name: 'github_list_prs',
    description: '列出 GitHub 仓库的 Pull Requests。',
    parameters: {
      type: 'object',
      properties: {
        state: {
          type: 'string',
          enum: ['open', 'closed', 'all'],
          description: 'PR 状态过滤，默认 open。',
        },
      },
      required: [],
    },
  },
  {
    name: 'github_get_pr',
    description: '获取某个 PR 的详细信息，包含标题、正文、分支。',
    parameters: {
      type: 'object',
      properties: {
        number: { type: 'number', description: 'PR 编号。' },
      },
      required: ['number'],
    },
  },
  {
    name: 'github_get_pr_diff',
    description: '获取某个 PR 的完整 diff。用于代码审查。',
    parameters: {
      type: 'object',
      properties: {
        number: { type: 'number', description: 'PR 编号。' },
      },
      required: ['number'],
    },
  },
  {
    name: 'github_create_pr',
    description: '创建新的 Pull Request。需要用户批准后执行。',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'PR 标题。' },
        head: { type: 'string', description: '源分支名。' },
        base: { type: 'string', description: '目标分支名，默认 main。' },
        body: { type: 'string', description: 'PR 正文（Markdown）。' },
      },
      required: ['title', 'head'],
    },
  },
  {
    name: 'github_list_workflows',
    description: '列出最近的 GitHub Actions CI 运行记录。',
    parameters: {
      type: 'object',
      properties: {
        branch: { type: 'string', description: '按分支过滤。' },
      },
      required: [],
    },
  },
  {
    name: 'github_search_code',
    description: '在 GitHub 上搜索代码。可以跨仓库搜索或限制在当前仓库内。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词（支持 GitHub 搜索语法）。' },
      },
      required: ['query'],
    },
  },
  {
    name: 'github_get_repo',
    description: '获取当前仓库的元信息（star 数、默认分支、语言等）。',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'github_create_review',
    description: '对 PR 提交代码审查（comment、approve 或 request changes）。审查内容是自动生成的代码审查意见。',
    parameters: {
      type: 'object',
      properties: {
        number: { type: 'number', description: 'PR 编号。' },
        event: {
          type: 'string',
          enum: ['COMMENT', 'APPROVE', 'REQUEST_CHANGES'],
          description: '审查动作：COMMENT=纯评论，APPROVE=批准，REQUEST_CHANGES=要求修改。默认 COMMENT。',
        },
        body: { type: 'string', description: '审查总结（Markdown）。' },
        comments: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '文件路径。' },
              line: { type: 'number', description: '行号。' },
              body: { type: 'string', description: 'Comment text.' },
            },
          },
          description: '逐行审查意见。每个元素包含 path、line、body。',
        },
      },
      required: ['number'],
    },
  },
  {
    name: 'github_merge_pr',
    description: '合并 Pull Request。需要用户批准后执行。',
    parameters: {
      type: 'object',
      properties: {
        number: { type: 'number', description: 'PR 编号。' },
        method: {
          type: 'string',
          enum: ['merge', 'squash', 'rebase'],
          description: '合并方式，默认 merge。',
        },
      },
      required: ['number'],
    },
  },
  {
    name: 'github_create_release',
    description: '创建 GitHub Release。需要用户批准后执行。',
    parameters: {
      type: 'object',
      properties: {
        tag: { type: 'string', description: 'Tag（如 v1.0.0），如果 tag 不存在会自动创建。' },
        name: { type: 'string', description: 'Release 名称，默认用 tag。' },
        body: { type: 'string', description: 'Release 说明（Markdown）。' },
        draft: { type: 'boolean', description: '是否存为草稿。' },
      },
      required: ['tag'],
    },
  },
];

export const TASK_SYSTEM_PROMPT = `You are a coding task runner integrated into Code IDE. You help users by reading, writing, and modifying code in their workspace.

## Capabilities
You have access to many tools that let you interact with the user's workspace:

**File Operations:**
- read_file: Read any file (with optional offset/limit for large files)
- write_file: Create or overwrite a file (requires user approval)
- replace_in_file: Target a specific block of text in a file and replace it (requires user approval). Preferred over write_file for existing files.
- list_directory: Browse the file tree
- search_files: Search text/regex across the codebase with optional file pattern filtering
- find_files: Find files by glob pattern (e.g. "*.tsx")
- get_file_info: Get file size, modification time, etc.

**Code Analysis:**
- read_lints: Run ESLint/TypeScript diagnostics
- extract_symbols: Extract functions, classes, exports, interfaces from TS/JS files
- codebase_search: Semantic/concept search across the workspace — use this first when you don't know the exact keyword ("where is X handled?"). Falls back to full-text search.

**Planning:**
- update_plan: Maintain a short ordered plan (todo list) for multi-step tasks so the user can see progress. Pass the FULL step list on every call; mark steps in_progress/completed as you go.
- use_skill: Load and follow an installed skill's full SKILL.md. When the system prompt lists "可用技能", call use_skill for the matching one BEFORE acting.

**Git:**
- git_status: See what's changed, current branch
- git_diff: View changes vs HEAD
- git_log: Recent commit history

**Commands:**
- run_command: Run a shell command (with timeout)
- run_background_command: Start a long-running command (dev server, build watcher)
- get_background_output: Check output from a background command
- kill_background_command: Stop a background command

**Web & External:**
- web_search: Search the internet
- web_fetch: Fetch a URL and extract content
- preview_url: Open a URL in the IDE's built-in browser

**Multi-file:**
- read_multiple_files: Read several files at once
- search_and_replace: Search-and-replace across the workspace (requires approval)

**Context:**
- save_context / load_context: Save/load information for later use

**GitHub:**
- github_list_issues / github_get_issue / github_create_issue: Browse and create issues (create requires approval)
- github_list_comments / github_add_comment: Read and post comments (post requires approval)
- github_list_prs / github_get_pr / github_get_pr_diff / github_create_pr: Browse PRs, read diffs, create PRs (create requires approval)
- github_list_workflows: Check CI/CD status
- github_search_code: Search code on GitHub
- github_get_repo: Get repo metadata

## Guidelines
1. Gather context first: use codebase_search to locate relevant code, then read those files.
2. Make precise, minimal edits. Prefer replace_in_file over write_file when modifying existing files.
3. Explain your plan briefly before executing tools.
4. After making changes, summarize what you did.
5. If a task is unclear, ask before taking destructive actions.
6. Always read a file before editing it — never guess its contents.
7. For multi-step tasks, plan ahead and execute tools in logical order.
8. If a tool fails, read the error, adjust your approach, and retry — do not repeat the exact same failing call.
9. For multi-step tasks (roughly 3+ steps), call update_plan early to lay out a short ordered plan, then update each step's status as you progress. Skip it for trivial single-step tasks.

## Approval & Safety
The user controls an approval mode. Writes, shell commands, and external (GitHub) actions may require the user's approval before they run; destructive shell commands (rm -rf, git push --force, curl | sh, sudo, etc.) always require explicit approval. If an action is rejected, do not retry it — explain and propose an alternative. Prefer the least destructive command that accomplishes the task.

Be direct and concise. Focus on getting the task done.`;

export const AGENT_SYSTEM_PROMPT = TASK_SYSTEM_PROMPT;
