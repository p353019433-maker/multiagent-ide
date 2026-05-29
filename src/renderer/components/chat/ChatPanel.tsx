import React, { useState, useRef, useEffect, useCallback } from 'react';
import { v4 as uuid } from 'uuid';
import { useAI } from '../../context/AIContext';
import { useWorkspace } from '../../context/WorkspaceContext';
import { useEditor } from '../../context/EditorContext';
import ChatMessage from './ChatMessage';
import AgentToolView from './AgentToolView';
import DiffPreview from '../editor/DiffPreview';
import type { ChatMessage as ChatMessageType, ToolCall, AgentToolExecution } from '@shared/types';
import { BUILTIN_TOOLS, AGENT_SYSTEM_PROMPT } from '@shared/tools';

export default function ChatPanel() {
  const {
    activeProviderId,
    activeModel,
    conversations,
    activeConversationId,
    newConversation,
    newWorktreeConversation,
    setActiveConversation,
    deleteConversation,
    addMessage,
  } = useAI();
  const { rootPath } = useWorkspace();
  const { activeFilePath, openFiles } = useEditor();

  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState('');
  const [toolExecutions, setToolExecutions] = useState<AgentToolExecution[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const activeConversation = conversations.find((c) => c.id === activeConversationId);
  const messages = activeConversation?.messages || [];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamContent, toolExecutions]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || !activeProviderId || !activeModel) return;
    if (isStreaming) return;

    let convId = activeConversationId;
    if (!convId) {
      convId = newConversation();
    }

    let contextPrefix = '';
    if (activeFilePath) {
      const file = openFiles.find((f) => f.path === activeFilePath);
      if (file) {
        contextPrefix = `[当前文件: ${activeFilePath}]\n\`\`\`${file.language}\n${file.content.slice(0, 3000)}\n\`\`\`\n\n`;
      }
    }

    const userMsg: ChatMessageType = {
      id: uuid(),
      role: 'user',
      content: input,
      timestamp: Date.now(),
    };
    addMessage(convId, userMsg);
    setInput('');
    setIsStreaming(true);
    setStreamContent('');
    setToolExecutions([]);

    const apiMessages: ChatMessageType[] = [
      ...messages,
      { ...userMsg, content: contextPrefix + userMsg.content },
    ];

    await runAgentLoop(convId, apiMessages);
  }, [input, activeProviderId, activeModel, activeConversationId, messages, activeFilePath, openFiles]);

  const runAgentLoop = async (convId: string, apiMessages: ChatMessageType[]) => {
    let loopMessages = [...apiMessages];
    let iterations = 0;
    const maxIterations = 10;

    while (iterations < maxIterations) {
      iterations++;
      setStreamContent('');

      try {
        const result = await new Promise<any>((resolve, reject) => {
          let content = '';
          const toolCalls: ToolCall[] = [];

          const unsubToken = window.api.ai.onStreamToken((token) => {
            content += token;
            setStreamContent(content);
          });
          const unsubTool = window.api.ai.onStreamToolCall((tc) => {
            toolCalls.push(tc);
          });
          const unsubComplete = window.api.ai.onStreamComplete((res) => {
            unsubToken();
            unsubTool();
            unsubComplete();
            unsubError();
            resolve({ ...res, content, toolCalls: toolCalls.length ? toolCalls : res.toolCalls });
          });
          const unsubError = window.api.ai.onStreamError((err) => {
            unsubToken();
            unsubTool();
            unsubComplete();
            unsubError();
            reject(new Error(err));
          });

          window.api.ai.chatStream(activeProviderId!, loopMessages, {
            model: activeModel!,
            tools: BUILTIN_TOOLS,
            systemPrompt: AGENT_SYSTEM_PROMPT,
            workspaceRoot: rootPath || undefined,
          });
        });

        const assistantMsg: ChatMessageType = {
          id: uuid(),
          role: 'assistant',
          content: result.content || '',
          toolCalls: result.toolCalls,
          timestamp: Date.now(),
        };
        addMessage(convId, assistantMsg);
        setStreamContent('');

        if (!result.toolCalls?.length || result.finishReason !== 'tool_calls') {
          break;
        }

        const toolResults = await executeTools(result.toolCalls);

        const toolMsg: ChatMessageType = {
          id: uuid(),
          role: 'tool',
          content: '',
          toolResults,
          timestamp: Date.now(),
        };
        addMessage(convId, toolMsg);

        loopMessages = [...loopMessages, assistantMsg, toolMsg];
      } catch (err: any) {
        const errorMsg: ChatMessageType = {
          id: uuid(),
          role: 'assistant',
          content: `❌ 错误：${err.message}`,
          timestamp: Date.now(),
        };
        addMessage(convId, errorMsg);
        break;
      }
    }

    setIsStreaming(false);
  };

  const executeTools = async (toolCalls: ToolCall[]) => {
    const results: { toolCallId: string; content: string; isError?: boolean }[] = [];

    for (const tc of toolCalls) {
      const execution: AgentToolExecution = {
        id: tc.id,
        name: tc.name,
        arguments: tc.arguments,
        status: 'running',
      };
      setToolExecutions((prev) => [...prev, execution]);

      try {
        const result = await executeSingleTool(tc);
        setToolExecutions((prev) =>
          prev.map((e) => (e.id === tc.id ? { ...e, status: 'success', result } : e))
        );
        results.push({ toolCallId: tc.id, content: result });
      } catch (err: any) {
        setToolExecutions((prev) =>
          prev.map((e) => (e.id === tc.id ? { ...e, status: 'error', error: err.message } : e))
        );
        results.push({ toolCallId: tc.id, content: `错误：${err.message}`, isError: true });
      }
    }

    return results;
  };

  const resolvePath = (p: string): string => {
    if (!rootPath) throw new Error('未打开工作区');
    if (p.startsWith(rootPath + '/') || p === rootPath) return p;
    if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) throw new Error('拒绝访问：路径超出工作区');
    const segments = p.split(/[/\\]/);
    const resolved: string[] = [];
    for (const seg of segments) {
      if (seg === '..') {
        if (resolved.length === 0) throw new Error('拒绝访问：检测到路径越界');
        resolved.pop();
      } else if (seg !== '.' && seg !== '') {
        resolved.push(seg);
      }
    }
    return rootPath + '/' + resolved.join('/');
  };

  /** Get GitHub token and resolve owner/repo from git remote */
  const getGitHubContext = async (): Promise<{
    token: string | null;
    info: { owner: string; repo: string } | null;
  }> => {
    const token = await window.api.store.decryptAndGet('github_token');
    if (!token) return { token: null, info: null };
    if (!rootPath) return { token, info: null };
    try {
      const result = await window.api.terminal.runCommand(rootPath, 'git remote get-url origin', 5000);
      const url = result.stdout.trim();
      if (!url) return { token, info: null };
      const info = await window.api.github.parseRemote(url);
      return { token, info };
    } catch {
      return { token, info: null };
    }
  };

  // ── Auto-approve mode: destructive writes auto-accept after a short preview, user can reject ──
  const autoApproveTimeout = useRef<NodeJS.Timeout | null>(null);

  const [pendingApproval, setPendingApproval] = useState<{
    toolCallId: string;
    filePath: string;
    action: 'write' | 'edit' | 'replace_in_file' | 'search_and_replace' | 'github';
    before: string;
    after: string;
    resolve: (approved: boolean) => void;
  } | null>(null);

  const requestApproval = (
    toolCallId: string,
    filePath: string,
    action: 'write' | 'edit' | 'replace_in_file' | 'search_and_replace' | 'github',
    before: string,
    after: string
  ): Promise<boolean> => {
    return new Promise((resolve) => {
      setPendingApproval({ toolCallId, filePath, action, before, after, resolve });
      // Auto-accept after 3 seconds — user can reject before that
      autoApproveTimeout.current = setTimeout(() => {
        setPendingApproval((prev) => {
          if (prev?.toolCallId === toolCallId) {
            prev.resolve(true);
            return null;
          }
          return prev;
        });
      }, 3000);
    });
  };

  const handleApprove = () => {
    if (autoApproveTimeout.current) clearTimeout(autoApproveTimeout.current);
    pendingApproval?.resolve(true);
    setPendingApproval(null);
  };

  const handleReject = () => {
    if (autoApproveTimeout.current) clearTimeout(autoApproveTimeout.current);
    pendingApproval?.resolve(false);
    setPendingApproval(null);
  };

  const executeSingleTool = async (tc: ToolCall): Promise<string> => {
    const args = tc.arguments;

    switch (tc.name) {
      // ── File Operations ──
      case 'read_file': {
        const filePath = resolvePath(args.path as string);
        const content = await window.api.fs.readFile(filePath);
        const offset = (args.offset as number) || 0;
        const limit = (args.limit as number) || 0;
        if (offset || limit) {
          const lines = content.split('\n');
          const start = Math.max(0, offset - 1);
          const end = limit ? start + limit : lines.length;
          return lines.slice(start, end).join('\n').slice(0, 10000);
        }
        return content.slice(0, 10000);
      }
      case 'write_file': {
        const filePath = resolvePath(args.path as string);
        const newContent = args.content as string;
        let existingContent = '';
        try {
          existingContent = await window.api.fs.readFile(filePath);
        } catch {
          // File doesn't exist yet
        }
        const approved = await requestApproval(tc.id, filePath, 'write', existingContent, newContent);
        if (!approved) return '文件写入被用户拒绝';
        await window.api.fs.writeFile(filePath, newContent);
        return `已写入文件：${args.path}`;
      }
      case 'replace_in_file': {
        const filePath = resolvePath(args.path as string);
        const content = await window.api.fs.readFile(filePath);
        const oldStr = args.old_str as string;
        const newStr = args.new_str as string;
        const replaceAll = args.replace_all as boolean;
        const occurrences = content.split(oldStr).length - 1;
        if (occurrences === 0) {
          throw new Error('文件中未找到 old_str');
        }
        if (!replaceAll && occurrences > 1) {
          throw new Error(`old_str 在文件中出现 ${occurrences} 次，不唯一。请添加更多上下文或设置 replace_all: true。`);
        }
        const updated = replaceAll ? content.split(oldStr).join(newStr) : content.replace(oldStr, newStr);
        const approved = await requestApproval(tc.id, filePath, 'edit', content, updated);
        if (!approved) return '文件编辑被用户拒绝';
        await window.api.fs.writeFile(filePath, updated);
        const count = replaceAll ? occurrences : 1;
        return `已在 ${args.path} 中替换 ${count} 处匹配`;
      }
      case 'list_directory': {
        const dirPath = resolvePath(args.path as string);
        const nodes = await window.api.fs.readDirectory(dirPath);
        return nodes.map((n: any) => `${n.isDirectory ? '📁' : '📄'} ${n.name}`).join('\n');
      }
      case 'search_files': {
        if (!rootPath) throw new Error('未打开工作区');
        const results = await window.api.fs.searchFiles(rootPath, args.query as string);
        return results
          .slice(0, 20)
          .map((r: any) => `${r.path}:${r.line} ${r.preview}`)
          .join('\n');
      }
      case 'find_files': {
        if (!rootPath) throw new Error('未打开工作区');
        const dir = args.directory ? resolvePath(args.directory as string) : rootPath;
        const files = await window.api.fs.findFiles(dir, args.pattern as string);
        return files.join('\n') || '未找到匹配的文件';
      }
      case 'get_file_info': {
        const filePath = resolvePath(args.path as string);
        const info = await window.api.fs.getFileInfo(filePath);
        const sizeStr = info.size >= 1024 * 1024
          ? (info.size / 1024 / 1024).toFixed(1) + ' MB'
          : info.size >= 1024
          ? (info.size / 1024).toFixed(1) + ' KB'
          : info.size + ' B';
        return `路径: ${filePath}\n大小: ${sizeStr}\n修改时间: ${info.modified}\n类型: ${info.isDirectory ? '目录' : '文件'}`;
      }

      // ── Code Analysis ──
      case 'read_lints': {
        const cwd = rootPath || '/';
        const filePath = args.path ? resolvePath(args.path as string) : undefined;
        return await window.api.lint.run(cwd, filePath);
      }
      case 'extract_symbols': {
        const filePath = resolvePath(args.path as string);
        return await window.api.symbols.extract(filePath);
      }

      // ── Git ──
      case 'git_status': {
        const cwd = rootPath || process.cwd();
        return await window.api.git.status(cwd);
      }
      case 'git_diff': {
        const cwd = rootPath || process.cwd();
        const staged = args.staged as boolean;
        const filePath = args.path ? resolvePath(args.path as string) : undefined;
        return await window.api.git.diff(cwd, staged, filePath);
      }
      case 'git_log': {
        const cwd = rootPath || process.cwd();
        return await window.api.git.log(cwd, (args.count as number) || 10);
      }
      case 'git_branch_list': {
        const cwd = rootPath || process.cwd();
        return await window.api.git.branchList(cwd);
      }
      case 'git_create_branch': {
        const cwd = rootPath || process.cwd();
        return await window.api.git.branchCreate(cwd, args.name as string);
      }
      case 'git_switch_branch': {
        const cwd = rootPath || process.cwd();
        return await window.api.git.branchSwitch(cwd, args.name as string);
      }
      case 'git_commit': {
        const cwd = rootPath || process.cwd();
        await window.api.git.stageAll(cwd);
        return await window.api.git.commit(cwd, args.message as string);
      }
      case 'git_push': {
        const cwd = rootPath || process.cwd();
        return await window.api.git.push(cwd, (args.remote as string) || 'origin');
      }
      case 'git_worktree_list': {
        const cwd = rootPath || process.cwd();
        const trees = await window.api.git.worktreeList(cwd);
        return JSON.stringify(trees, null, 2);
      }
      case 'git_worktree_add': {
        const cwd = rootPath || process.cwd();
        const branch = args.branch as string;
        const base = args.base as string | undefined;
        const wtPath = args.path as string | undefined;
        const parentDir = (cwd.endsWith('/') ? cwd.slice(0, -1) : cwd);
        const path = wtPath || `${parentDir}_wt/${branch}`;
        const res = await window.api.git.worktreeAdd(cwd, path, branch, base);
        if (!res.success) throw new Error(res.message);
        return `已创建隔离 worktree: ${res.path}
分支: ${branch}`;
      }
      case 'git_merge': {
        const cwd = rootPath || process.cwd();
        const source = args.source as string;
        const method = (args.method as string) || 'merge';
        const res = await window.api.git.worktreeMerge(cwd, source, method as any);
        if (!res.success) throw new Error(res.message);
        return res.message;
      }
      case 'git_merge_diff': {
        const cwd = rootPath || process.cwd();
        const base = args.base as string;
        const head = (args.head as string) || (await window.api.git.currentBranch(cwd));
        return await window.api.git.worktreeMergeDiff(cwd, base, head);
      }

      // ── Commands ──
      case 'run_command': {
        const cwd = rootPath || '/';
        const timeoutMs = (args.timeout_ms as number) ?? 60000;
        const result = await window.api.terminal.runCommand(cwd, args.command as string, timeoutMs);
        const output = (result.stdout + result.stderr).slice(0, 5000);
        return `退出码：${result.exitCode}\n${output}`;
      }
      case 'run_background_command': {
        const cwd = rootPath || '/';
        const id = await window.api.terminal.runBackgroundCommand(cwd, args.command as string);
        return `后台任务已启动，session ID: ${id}\n使用 get_background_output("${id}") 查看输出`;
      }
      case 'get_background_output': {
        const info = await window.api.terminal.getBackgroundOutput(args.session_id as string);
        if (!info) return 'session 不存在或已过期';
        let status = info.running ? '运行中' : `已退出 (退出码 ${info.exitCode})`;
        return `[${status}]\n${info.output}`;
      }
      case 'kill_background_command': {
        const ok = await window.api.terminal.killBackgroundCommand(args.session_id as string);
        return ok ? '后台任务已终止' : '未找到该 session';
      }

      // ── Web ──
      case 'web_search': {
        const results = await window.api.web.search(args.query as string, (args.count as number) || 5);
        return results.map((r: any) => `${r.title}\n${r.url}\n${r.snippet}`).join('\n\n') || '无搜索结果';
      }
      case 'web_fetch': {
        return await window.api.web.fetch(args.url as string, (args.extract_mode as any) || 'markdown');
      }
      case 'preview_url': {
        const url = args.url as string;
        window.dispatchEvent(new CustomEvent('preview-url', { detail: { url } }));
        return `已在内置浏览器中打开 ${url}`;
      }

      // ── Multi-file ──
      case 'read_multiple_files': {
        const paths = (args.paths as string[]).map((p) => resolvePath(p));
        const files = await window.api.fs.readMultipleFiles(paths);
        return Object.entries(files)
          .map(([p, content]) => `=== ${p} ===\n${content.slice(0, 5000)}`)
          .join('\n\n');
      }
      case 'search_and_replace': {
        if (!rootPath) throw new Error('未打开工作区');
        const pattern = args.pattern as string;
        const replacement = args.replacement as string;
        const dryRun = args.dry_run as boolean;
        // Search first
        const results = await window.api.fs.searchFiles(rootPath, pattern);
        if (results.length === 0) return '未找到匹配项';
        if (dryRun) {
          return `找到 ${results.length} 处匹配（预览模式，未修改文件）：\n` +
            results.map((r: any) => `${r.path}:${r.line} ${r.preview}`).join('\n');
        }
        // Group by file
        const byFile = new Map<string, { line: number; preview: string }[]>();
        for (const r of results) {
          if (!byFile.has(r.path)) byFile.set(r.path, []);
          byFile.get(r.path)!.push({ line: r.line, preview: r.preview });
        }
        let changed = 0;
        for (const [filePath, matches] of byFile) {
          const content = await window.api.fs.readFile(filePath);
          let updated = content;
          // Replace all matches per file (case-insensitive, simple string replace)
          for (const m of matches) {
            updated = updated.split(m.preview).join(replacement);
          }
          const approved = await requestApproval(tc.id, filePath, 'edit', content, updated);
          if (approved) {
            await window.api.fs.writeFile(filePath, updated);
            changed += matches.length;
          }
        }
        return `已替换 ${changed} 处匹配（共 ${results.length} 处发现）`;
      }

      // ── Context ──
      case 'save_context': {
        await window.api.context.save(
          args.key as string,
          args.content as string,
          (args.merge as boolean) || false
        );
        return `已保存上下文 "${args.key}"`;
      }
      case 'load_context': {
        const val = await window.api.context.load(args.key as string);
        return val || `未找到上下文 "${args.key}"`;
      }

      // ── GitHub ──
      case 'github_list_issues': {
        const { token, info } = await getGitHubContext();
        if (!token || !info) throw new Error('未配置 GitHub token 或无法识别仓库');
        const issues = await window.api.github.listIssues(token, info.owner, info.repo, (args.state as string) || 'open');
        return JSON.stringify(issues, null, 2);
      }
      case 'github_get_issue': {
        const { token, info } = await getGitHubContext();
        if (!token || !info) throw new Error('未配置 GitHub token 或无法识别仓库');
        const issue = await window.api.github.getIssue(token, info.owner, info.repo, args.number as number);
        return JSON.stringify(issue, null, 2);
      }
      case 'github_create_issue': {
        const { token, info } = await getGitHubContext();
        if (!token || !info) throw new Error('未配置 GitHub token 或无法识别仓库');
        const approved = await requestApproval(tc.id, `github issue: ${args.title}`, 'github', '', args.title as string);
        if (!approved) return 'GitHub 操作被用户拒绝';
        const result = await window.api.github.createIssue(token, info.owner, info.repo, args.title as string, (args.body as string) || '', args.labels as string[]);
        return `已创建 issue #${result.number}: ${result.html_url}`;
      }
      case 'github_list_comments': {
        const { token, info } = await getGitHubContext();
        if (!token || !info) throw new Error('未配置 GitHub token 或无法识别仓库');
        const comments = await window.api.github.listIssueComments(token, info.owner, info.repo, args.number as number);
        return JSON.stringify(comments, null, 2);
      }
      case 'github_add_comment': {
        const { token, info } = await getGitHubContext();
        if (!token || !info) throw new Error('未配置 GitHub token 或无法识别仓库');
        const approved = await requestApproval(tc.id, `评论 issue`, 'github', '', (args.body as string));
        if (!approved) return 'GitHub 操作被用户拒绝';
        await window.api.github.addIssueComment(token, info.owner, info.repo, args.number as number, args.body as string);
        return `评论已发布到 issue #${args.number}`;
      }
      case 'github_list_prs': {
        const { token, info } = await getGitHubContext();
        if (!token || !info) throw new Error('未配置 GitHub token 或无法识别仓库');
        const prs = await window.api.github.listPRs(token, info.owner, info.repo, (args.state as string) || 'open');
        return JSON.stringify(prs, null, 2);
      }
      case 'github_get_pr': {
        const { token, info } = await getGitHubContext();
        if (!token || !info) throw new Error('未配置 GitHub token 或无法识别仓库');
        const pr = await window.api.github.getPR(token, info.owner, info.repo, args.number as number);
        return JSON.stringify(pr, null, 2);
      }
      case 'github_get_pr_diff': {
        const { token, info } = await getGitHubContext();
        if (!token || !info) throw new Error('未配置 GitHub token 或无法识别仓库');
        const diff = await window.api.github.getPRDiff(token, info.owner, info.repo, args.number as number);
        return diff.slice(0, 8000);
      }
      case 'github_create_pr': {
        const { token, info } = await getGitHubContext();
        if (!token || !info) throw new Error('未配置 GitHub token 或无法识别仓库');
        const title = args.title as string;
        const head = args.head as string;
        const base = (args.base as string) || 'main';
        const body = (args.body as string) || '';
        const approved = await requestApproval(tc.id, `创建 PR: ${title}`, 'github', '', `head: ${head} → base: ${base}\n${body}`);
        if (!approved) return 'GitHub 操作被用户拒绝';
        const result = await window.api.github.createPR(token, info.owner, info.repo, title, head, base, body);
        return `已创建 PR #${result.number}: ${result.html_url}`;
      }
      case 'github_list_workflows': {
        const { token, info } = await getGitHubContext();
        if (!token || !info) throw new Error('未配置 GitHub token 或无法识别仓库');
        const runs = await window.api.github.listWorkflowRuns(token, info.owner, info.repo, args.branch as string | undefined);
        return JSON.stringify(runs, null, 2);
      }
      case 'github_search_code': {
        const { token, info } = await getGitHubContext();
        if (!token) throw new Error('未配置 GitHub token');
        const results = await window.api.github.searchCode(token, args.query as string, info?.owner, info?.repo);
        return JSON.stringify(results, null, 2);
      }
      case 'github_get_repo': {
        const { token, info } = await getGitHubContext();
        if (!token || !info) throw new Error('未配置 GitHub token 或无法识别仓库');
        const repo = await window.api.github.getRepo(token, info.owner, info.repo);
        return JSON.stringify(repo, null, 2);
      }
      case 'github_create_review': {
        const { token, info } = await getGitHubContext();
        if (!token || !info) throw new Error('未配置 GitHub token 或无法识别仓库');
        const number = args.number as number;
        const body = (args.body as string) || '';
        const event = (args.event as string) || 'COMMENT';
        const comments = args.comments as any[] | undefined;
        await window.api.github.createReview(token, info.owner, info.repo, number, event, body, comments);
        return event === 'APPROVE' ? `已批准 PR #${number}` : `已在 PR #${number} 上提交审查`;
      }
      case 'github_merge_pr': {
        const { token, info } = await getGitHubContext();
        if (!token || !info) throw new Error('未配置 GitHub token 或无法识别仓库');
        const number = args.number as number;
        const method = (args.method as string) || 'merge';
        const approved = await requestApproval(tc.id, `合并 PR #${number}`, 'github', '', `${method} PR #${number}`);
        if (!approved) return 'GitHub 操作被用户拒绝';
        await window.api.github.mergePR(token, info.owner, info.repo, number, method);
        return `PR #${number} 已合并`;
      }
      case 'github_create_release': {
        const { token, info } = await getGitHubContext();
        if (!token || !info) throw new Error('未配置 GitHub token 或无法识别仓库');
        const tag = args.tag as string;
        const name = (args.name as string) || tag;
        const body = (args.body as string) || '';
        const draft = args.draft as boolean | undefined;
        const approved = await requestApproval(tc.id, `创建 release: ${tag}`, 'github', '', `tag: ${tag}\n${body}`);
        if (!approved) return 'GitHub 操作被用户拒绝';
        const result = await window.api.github.createRelease(token, info.owner, info.repo, tag, name, body, draft);
        return `已创建 release ${tag}: ${result.html_url}`;
      }

      // ── Legacy compat ──
      case 'edit_file': {
        // Map to replace_in_file internally
        const filePath = resolvePath(args.path as string);
        const content = await window.api.fs.readFile(filePath);
        const oldStr = args.oldString as string;
        const newStr = args.newString as string;
        const occurrences = content.split(oldStr).length - 1;
        if (occurrences === 0) throw new Error('文件中未找到 oldString');
        if (occurrences > 1) throw new Error(`oldString 在文件中出现 ${occurrences} 次，不唯一。`);
        const updated = content.replace(oldStr, newStr);
        const approved = await requestApproval(tc.id, filePath, 'edit', content, updated);
        if (!approved) return '文件编辑被用户拒绝';
        await window.api.fs.writeFile(filePath, updated);
        return `已编辑文件：${args.path}`;
      }

      default:
        throw new Error(`未知工具：${tc.name}`);
    }
  };

  const handleAbort = () => {
    window.api.ai.abort();
    setIsStreaming(false);
  };

  /** Create a new isolated worktree session */
  const handleNewWorktreeSession = async () => {
    if (!rootPath) {
      alert('需要先打开一个 Git 项目才能创建隔离工作树');
      return;
    }
    try {
      // Check current branch
      const currentBranch = await window.api.git.currentBranch(rootPath);
      const branchName = `agent-${Date.now().toString(36)}`;
      const parentDir = (window as any).__WORKTREE_PARENT__ || rootPath;
      const wtPath = `${parentDir}_wt/${branchName}`;

      const result = await window.api.git.worktreeAdd(rootPath, wtPath, branchName, currentBranch);
      if (!result.success) {
        alert(`创建 worktree 失败：${result.message}`);
        return;
      }

      await newWorktreeConversation(wtPath, branchName, currentBranch);

      // Open the worktree directory in FileService (requires update)
      console.log(`Worktree created: ${wtPath}`);
    } catch (e: any) {
      alert(`创建隔离会话失败：${e.message || e}`);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full bg-editor-sidebar border-l border-editor-border">
      {/* Multi-session tab bar */}
      {conversations.length > 1 ? (
        <SessionTabs
          conversations={conversations}
          activeId={activeConversationId}
          onSelect={setActiveConversation}
          onDelete={deleteConversation}
          onNew={newConversation}
          onNewWorktree={handleNewWorktreeSession}
        />
      ) : (
        <div className="flex items-center justify-between px-3 py-2 border-b border-editor-border">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
            AI 对话
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => newConversation()}
              className="text-xs px-1.5 py-0.5 rounded hover:bg-editor-active text-gray-400 hover:text-white"
              title="新建对话"
            >
              💬+
            </button>
            <button
              onClick={handleNewWorktreeSession}
              className="text-xs px-1.5 py-0.5 rounded hover:bg-editor-active text-gray-400 hover:text-white"
              title="新建隔离工作树会话"
            >
              🪵+
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3 selectable">
        {messages.map((msg) => (
          <ChatMessage key={msg.id} message={msg} />
        ))}

        {toolExecutions.length > 0 && (
          <div className="space-y-1">
            {toolExecutions.map((exec) => (
              <AgentToolView key={exec.id} execution={exec} />
            ))}
          </div>
        )}

        {isStreaming && streamContent && (
          <div className="text-sm text-editor-text whitespace-pre-wrap streaming-cursor">
            {streamContent}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {pendingApproval && pendingApproval.action === 'github' ? (
        <div className="px-3 py-2 border-t border-editor-border flex-shrink-0 bg-yellow-900/10">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-yellow-400">
              ⚡ GitHub 操作：{pendingApproval.filePath}
            </span>
            <span className="text-[11px] text-yellow-400 animate-pulse">
              3 秒后自动接受
            </span>
          </div>
          <pre className="text-[11px] text-gray-300 mt-1 whitespace-pre-wrap bg-black/20 rounded p-2">
            {pendingApproval.after.slice(0, 500)}
          </pre>
          <div className="flex gap-2 mt-2">
            <button
              onClick={handleApprove}
              className="px-2 py-0.5 text-[11px] bg-green-600 text-white rounded hover:bg-green-700"
            >
              接受
            </button>
            <button
              onClick={handleReject}
              className="px-2 py-0.5 text-[11px] bg-red-600 text-white rounded hover:bg-red-700"
            >
              ✕ 拒绝
            </button>
          </div>
        </div>
      ) : pendingApproval ? (
        <div className="h-[250px] border-t border-editor-border flex-shrink-0 relative">
          <div className="absolute top-2 right-2 z-10 flex items-center gap-2 bg-editor-sidebar/90 rounded px-2 py-1 shadow">
            <span className="text-[11px] text-yellow-400 animate-pulse">
              3 秒后自动接受
            </span>
            <button
              onClick={handleReject}
              className="px-1.5 py-0.5 text-[11px] bg-red-600 text-white rounded hover:bg-red-700"
            >
              ✕ 拒绝
            </button>
          </div>
          <DiffPreview
            original={pendingApproval.before}
            modified={pendingApproval.after}
            filePath={pendingApproval.filePath}
            visible={true}
            onAccept={handleApprove}
            onReject={handleReject}
          />
        </div>
      ) : null}

      <div className="p-3 border-t border-editor-border">
        {!activeProviderId ? (
          <p className="text-xs text-gray-500 text-center">
            在设置中配置 AI 服务以开始对话
          </p>
        ) : (
          <div className="flex gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="跟 AI 说点什么..."
              className="flex-1 bg-editor-bg border border-editor-border rounded px-3 py-2 text-sm text-editor-text resize-none outline-none focus:border-editor-accent transition-colors"
              rows={2}
              disabled={isStreaming}
            />
            <div className="flex flex-col gap-1">
              {isStreaming ? (
                <button
                  onClick={handleAbort}
                  className="px-3 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700 transition-colors"
                >
                  停止
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={!input.trim()}
                  className="px-3 py-1 bg-editor-accent text-white text-xs rounded hover:opacity-90 transition-opacity disabled:opacity-40"
                >
                  发送
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Compact multi-session tab bar inside ChatPanel */
function SessionTabs({
  conversations,
  activeId,
  onSelect,
  onDelete,
  onNew,
  onNewWorktree,
}: {
  conversations: any[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: () => string;
  onNewWorktree: () => void;
}) {
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState('');
  const [showMenu, setShowMenu] = React.useState(false);
  const [mergeTarget, setMergeTarget] = React.useState<any | null>(null);
  const [mergeDiff, setMergeDiff] = React.useState('');
  const [mergeLoading, setMergeLoading] = React.useState(false);
  const [mergeError, setMergeError] = React.useState('');
  const [, forceRerender] = React.useState(0);

  const handleMerge = (conv: any) => {
    setMergeTarget(conv);
    setMergeDiff('');
    setMergeError('');
    setMergeLoading(true);
    window.api.git.worktreeMergeDiff('', conv.worktree.baseBranch, conv.worktree.branch)
      .then((diff: string) => { setMergeDiff(diff); setMergeLoading(false); })
      .catch((e: any) => { setMergeError(e.message); setMergeLoading(false); });
  };

  const handleMergeConfirm = async (method: string) => {
    if (!mergeTarget) return;
    setMergeLoading(true);
    try {
      const res = await window.api.git.worktreeMerge('', mergeTarget.worktree.branch, method);
      if (!res.success) throw new Error(res.message);
      // Push after merge
      await window.api.git.push('', 'origin');
      alert(`合并成功：${res.message}\n已推送到 origin`);
      setMergeTarget(null);
      // Optionally clean up worktree
    } catch (e: any) {
      setMergeError(e.message || String(e));
    }
    setMergeLoading(false);
  };

  const handleWorktreeCleanup = async (conv: any) => {
    if (!confirm(`删除 ${conv.worktree.branch} 的 worktree 和分支？`)) return;
    try {
      await window.api.git.worktreeRemove('', conv.worktree.path);
      alert('Worktree 已清理');
      onDelete(conv.id);
    } catch (e: any) {
      alert(`清理失败：${e.message}`);
    }
  };

  return (
    <>
    <div className="flex items-center border-b border-editor-border flex-shrink-0 overflow-x-auto hide-scrollbar">
      {conversations.map((conv) => (
        <div
          key={conv.id}
          onClick={() => onSelect(conv.id)}
          className={`group flex items-center gap-1 px-3 py-1.5 cursor-pointer border-r border-editor-border min-w-0 max-w-[160px] ${
            conv.id === activeId
              ? 'bg-editor-bg text-white border-t-2 ' + (conv.worktree ? 'border-t-yellow-500' : 'border-t-editor-accent')
              : 'text-gray-400 hover:bg-editor-hover'
          }`}
        >
          {conv.worktree && <span className="text-[10px] flex-shrink-0 group-hover:hidden">🪵</span>}
          {conv.worktree && (
            <div className="hidden group-hover:flex items-center gap-0.5 flex-shrink-0">
              <button
                onClick={(e) => { e.stopPropagation(); handleMerge(conv); }}
                className="text-[10px] text-emerald-400 hover:text-emerald-300"
                title="合并到基础分支"
              >
                ⥄
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleWorktreeCleanup(conv); }}
                className="text-[10px] text-red-400 hover:text-red-300"
                title="清理 worktree"
              >
                🗑
              </button>
            </div>
          )}
          {editingId === conv.id ? (
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => {
                if (draft.trim()) {
                  window.api.store.get('conversations').then((s: any) => {
                    if (s?.length) {
                      window.api.store.set('conversations', s.map((c: any) =>
                        c.id === conv.id ? { ...c, title: draft.trim() } : c
                      ));
                    }
                  });
                }
                setEditingId(null);
              }}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditingId(null); }}
              onClick={(e) => e.stopPropagation()}
              autoFocus
              spellCheck={false}
              className="w-full text-[11px] bg-editor-bg border border-editor-accent rounded px-1 py-0 text-white outline-none"
            />
          ) : (
            <span
              className="text-[11px] font-mono truncate select-none"
              onDoubleClick={() => { setEditingId(conv.id); setDraft(conv.title); }}
            >
              {conv.title || '新对话'}
            </span>
          )}
          {conversations.length > 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(conv.id); }}
              className="text-[10px] text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
            >
              ✕
            </button>
          )}
        </div>
      ))}
      <div className="relative flex-shrink-0">
        <button
          onClick={() => setShowMenu(!showMenu)}
          className="px-2 py-1.5 text-sm text-gray-400 hover:text-white hover:bg-editor-hover"
          title="新建会话"
        >
          +
        </button>
        {showMenu && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
            <div className="absolute left-0 top-full z-20 mt-0.5 w-44 bg-editor-sidebar border border-editor-border rounded shadow-lg py-1">
              <button
                onClick={() => { onNew(); setShowMenu(false); }}
                className="w-full text-left px-3 py-1.5 text-[11px] text-gray-300 hover:bg-editor-hover flex items-center gap-2"
              >
                <span className="text-xs">💬</span> 新建普通会话
              </button>
              <button
                onClick={() => { onNewWorktree(); setShowMenu(false); }}
                className="w-full text-left px-3 py-1.5 text-[11px] text-gray-300 hover:bg-editor-hover flex items-center gap-2"
              >
                <span className="text-xs">🪵</span> 新建隔离会话 (Worktree)
              </button>
            </div>
          </>
        )}
      </div>
    </div>

    {/* ── Merge diff modal ── */}
    {mergeTarget && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setMergeTarget(null)}>
        <div
          className="bg-editor-sidebar border border-editor-border rounded-lg shadow-2xl w-[700px] max-h-[80vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-editor-border">
            <span className="text-xs font-semibold text-gray-300">
              🪵 合并 {mergeTarget.worktree.branch} → {mergeTarget.worktree.baseBranch}
            </span>
            <button onClick={() => setMergeTarget(null)} className="text-gray-500 hover:text-white text-sm">✕</button>
          </div>
          <div className="flex-1 overflow-auto p-4">
            {mergeLoading ? (
              <p className="text-xs text-gray-500">加载 diff...</p>
            ) : mergeError ? (
              <p className="text-xs text-red-400">{mergeError}</p>
            ) : (
              <pre className="text-[11px] font-mono text-gray-300 whitespace-pre-wrap bg-black/20 rounded p-3">
                {mergeDiff || '没有差异'}
              </pre>
            )}
          </div>
          <div className="flex gap-2 px-4 py-3 border-t border-editor-border justify-end">
            <button onClick={() => handleMergeConfirm('merge')} className="px-3 py-1 text-[11px] bg-emerald-600 text-white rounded hover:bg-emerald-700">Merge</button>
            <button onClick={() => handleMergeConfirm('squash')} className="px-3 py-1 text-[11px] bg-blue-600 text-white rounded hover:bg-blue-700">Squash</button>
            <button onClick={() => handleMergeConfirm('rebase')} className="px-3 py-1 text-[11px] bg-purple-600 text-white rounded hover:bg-purple-700">Rebase</button>
            <button onClick={() => setMergeTarget(null)} className="px-3 py-1 text-[11px] bg-gray-600 text-white rounded hover:bg-gray-700">取消</button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}