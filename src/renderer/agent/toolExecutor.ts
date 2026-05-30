/**
 * Agent tool executor — the big dispatch that runs a single tool call.
 *
 * Extracted from ChatPanel verbatim (behavior-preserving). All host
 * capabilities the tools need are injected via ToolContext so this module has
 * no React or component coupling and can be tested in isolation.
 */

import { classifyCommand } from '@shared/command-policy';
import type { ToolCall } from '@shared/types';
import { applyEdit } from './applyEdit';

/** Action kinds for the approval gate (mirrors ChatPanel's pendingApproval). */
export type GateAction =
  | 'write'
  | 'edit'
  | 'replace_in_file'
  | 'search_and_replace'
  | 'github'
  | 'command';

export interface ToolContext {
  rootPath: string | null;
  /** Resolve & sandbox a tool path against the workspace root. */
  resolvePath: (p: string) => string;
  /** Mode-aware approval gate. Returns true if the action may proceed. */
  gateAction: (
    toolCallId: string,
    label: string,
    kind: 'write' | 'command' | 'external',
    before: string,
    after: string,
    action: GateAction,
    opts?: { dangerous?: boolean; dangerReason?: string }
  ) => Promise<boolean>;
  /** Write a file while recording a checkpoint snapshot + edit tracking. */
  writeFileTracked: (filePath: string, content: string) => Promise<void>;
  /** Resolve GitHub token + owner/repo from the workspace git remote. */
  getGitHubContext: () => Promise<{
    token: string | null;
    info: { owner: string; repo: string } | null;
  }>;
}

export async function executeSingleTool(tc: ToolCall, ctx: ToolContext): Promise<string> {
  const args = tc.arguments as Record<string, unknown>;
  const { rootPath, resolvePath, gateAction, writeFileTracked, getGitHubContext } = ctx;

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
      const approved = await gateAction(tc.id, filePath, 'write', existingContent, newContent, 'write');
      if (!approved) return '文件写入被用户拒绝';
      await writeFileTracked(filePath, newContent);
      return `已写入文件：${args.path}`;
    }
    case 'replace_in_file': {
      const filePath = resolvePath(args.path as string);
      const content = await window.api.fs.readFile(filePath);
      const oldStr = args.old_str as string;
      const newStr = args.new_str as string;
      const replaceAll = args.replace_all as boolean;
      const exact = content.split(oldStr).length - 1;
      if (!replaceAll && exact > 1) {
        throw new Error(`old_str 在文件中出现 ${exact} 次，不唯一。请添加更多上下文或设置 replace_all: true。`);
      }
      // Apply through the tolerant cascade (exact → whitespace → anchor) so
      // small indentation/whitespace mismatches don't fail the edit.
      const applied = applyEdit(content, oldStr, newStr, replaceAll);
      if (!applied.ok) {
        throw new Error('文件中未找到 old_str（已尝试精确、忽略空白、首尾锚点三种匹配）');
      }
      const approved = await gateAction(tc.id, filePath, 'write', content, applied.result, 'edit');
      if (!approved) return '文件编辑被用户拒绝';
      await writeFileTracked(filePath, applied.result);
      const note = applied.strategy === 'exact' ? '' : `（容差匹配：${applied.strategy}）`;
      return `已在 ${args.path} 中替换 ${applied.count} 处匹配${note}`;
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
    case 'codebase_search': {
      if (!rootPath) throw new Error('未打开工作区');
      const query = args.query as string;
      const limit = (args.limit as number) || 10;
      const res = await window.api.codebase.search(rootPath, query, limit);
      if (!res.hits.length) return `未找到与 "${query}" 相关的代码`;
      const modeLabel =
        res.mode === 'embedding'
          ? '向量语义检索'
          : res.mode === 'text'
          ? '全文检索（符号索引无命中）'
          : '符号检索';
      const header = `${modeLabel}命中 ${res.hits.length} 处（按相关度排序）：`;
      const body = res.hits
        .map((h: any) => `${h.file}:${h.line}  [${h.kind}] ${h.name}`)
        .join('\n');
      return `${header}\n${body}`;
    }
    case 'find_definition': {
      if (!rootPath) throw new Error('未打开工作区');
      const defs = await window.api.codeintel.definition(rootPath, args.name as string);
      if (!defs.length) return `未找到 "${args.name}" 的定义`;
      return `"${args.name}" 的定义（${defs.length} 处）：\n` +
        defs.map((d: any) => `${d.file}:${d.line}  [${d.kind}]`).join('\n');
    }
    case 'find_references': {
      if (!rootPath) throw new Error('未打开工作区');
      const refs = await window.api.codeintel.references(rootPath, args.name as string);
      if (!refs.length) return `未找到 "${args.name}" 的引用`;
      return `"${args.name}" 的引用（${refs.length} 处）：\n` +
        refs.map((r: any) => `${r.file}:${r.line}  ${r.preview}`).join('\n');
    }

    // ── Git ──
    case 'git_status': {
      const cwd = rootPath || '/';
      return await window.api.git.status(cwd);
    }
    case 'git_diff': {
      const cwd = rootPath || '/';
      const staged = args.staged as boolean;
      const filePath = args.path ? resolvePath(args.path as string) : undefined;
      return await window.api.git.diff(cwd, staged, filePath);
    }
    case 'git_log': {
      const cwd = rootPath || '/';
      return await window.api.git.log(cwd, (args.count as number) || 10);
    }
    case 'git_branch_list': {
      const cwd = rootPath || '/';
      return await window.api.git.branchList(cwd);
    }
    case 'git_create_branch': {
      const cwd = rootPath || '/';
      const name = args.name as string;
      const ok = await gateAction(tc.id, `创建并切换分支 ${name}`, 'command', '', `git checkout -b ${name}`, 'command', {
        dangerous: true,
        dangerReason: '切换工作区分支',
      });
      if (!ok) return '操作被用户拒绝';
      return await window.api.git.branchCreate(cwd, name);
    }
    case 'git_switch_branch': {
      const cwd = rootPath || '/';
      const name = args.name as string;
      const ok = await gateAction(tc.id, `切换分支 ${name}`, 'command', '', `git switch ${name}`, 'command', {
        dangerous: true,
        dangerReason: '切换工作区分支',
      });
      if (!ok) return '操作被用户拒绝';
      return await window.api.git.branchSwitch(cwd, name);
    }
    case 'git_commit': {
      const cwd = rootPath || '/';
      const message = args.message as string;
      const ok = await gateAction(tc.id, '暂存全部并提交', 'command', '', `git add -A && git commit -m "${message}"`, 'command', {
        dangerous: true,
        dangerReason: 'stageAll 会暂存全部改动（含用户未授权改动）并提交',
      });
      if (!ok) return '操作被用户拒绝';
      await window.api.git.stageAll(cwd);
      return await window.api.git.commit(cwd, message);
    }
    case 'git_push': {
      const cwd = rootPath || '/';
      const remote = (args.remote as string) || 'origin';
      // Pushing to a remote is irreversible-ish — always gated (dangerous).
      const ok = await gateAction(tc.id, `推送到 ${remote}`, 'command', '', `git push ${remote}`, 'command', {
        dangerous: true,
        dangerReason: '推送到远端',
      });
      if (!ok) return '操作被用户拒绝';
      return await window.api.git.push(cwd, remote);
    }
    case 'git_worktree_list': {
      const cwd = rootPath || '/';
      const trees = await window.api.git.worktreeList(cwd);
      return JSON.stringify(trees, null, 2);
    }
    case 'git_worktree_add': {
      const cwd = rootPath || '/';
      const branch = args.branch as string;
      const base = args.base as string | undefined;
      const wtPath = args.path as string | undefined;
      const parentDir = cwd.endsWith('/') ? cwd.slice(0, -1) : cwd;
      const path = wtPath || `${parentDir}_wt/${branch}`;
      const ok = await gateAction(tc.id, `创建 worktree 分支 ${branch}`, 'command', '', `git worktree add -b ${branch} ${path}`, 'command');
      if (!ok) return '操作被用户拒绝';
      const res = await window.api.git.worktreeAdd(cwd, path, branch, base);
      if (!res.success) throw new Error(res.message);
      return `已创建隔离 worktree: ${res.path}\n分支: ${branch}`;
    }
    case 'git_merge': {
      const cwd = rootPath || '/';
      const source = args.source as string;
      const method = (args.method as string) || 'merge';
      // Merging rewrites branch history — always gated (dangerous).
      const ok = await gateAction(tc.id, `合并分支 ${source}（${method}）`, 'command', '', `git merge ${source}`, 'command', {
        dangerous: true,
        dangerReason: '合并分支',
      });
      if (!ok) return '操作被用户拒绝';
      const res = await window.api.git.worktreeMerge(cwd, source, method as any);
      if (!res.success) throw new Error(res.message);
      return res.message;
    }
    case 'git_merge_diff': {
      const cwd = rootPath || '/';
      const base = args.base as string;
      const head = (args.head as string) || (await window.api.git.currentBranch(cwd));
      return await window.api.git.worktreeMergeDiff(cwd, base, head);
    }

    // ── Commands ──
    case 'run_command': {
      const cwd = rootPath || '/';
      const command = args.command as string;
      const risk = classifyCommand(command);
      const approved = await gateAction(tc.id, command, 'command', '', command, 'command', {
        dangerous: risk.dangerous,
        dangerReason: risk.reason,
      });
      if (!approved) return '命令执行被用户拒绝';
      const timeoutMs = (args.timeout_ms as number) ?? 60000;
      const result = await window.api.terminal.runCommand(cwd, command, timeoutMs);
      const output = (result.stdout + result.stderr).slice(0, 5000);
      return `退出码：${result.exitCode}\n${output}`;
    }
    case 'run_background_command': {
      const cwd = rootPath || '/';
      const command = args.command as string;
      const risk = classifyCommand(command);
      const approved = await gateAction(tc.id, command, 'command', '', command, 'command', {
        dangerous: risk.dangerous,
        dangerReason: risk.reason,
      });
      if (!approved) return '命令执行被用户拒绝';
      const id = await window.api.terminal.runBackgroundCommand(cwd, command);
      return `后台任务已启动，session ID: ${id}\n使用 get_background_output("${id}") 查看输出`;
    }
    case 'get_background_output': {
      const info = await window.api.terminal.getBackgroundOutput(args.session_id as string);
      if (!info) return 'session 不存在或已过期';
      const status = info.running ? '运行中' : `已退出 (退出码 ${info.exitCode})`;
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
      // Literal (non-regex) text replacement of `pattern` -> `replacement`.
      const pattern = args.pattern as string;
      const replacement = args.replacement as string;
      const dryRun = args.dry_run as boolean;
      if (!pattern) throw new Error('pattern 不能为空');

      // Use full-text search only to find candidate files, then replace the
      // exact literal pattern in each file's real content.
      const candidates = await window.api.fs.searchFiles(rootPath, pattern);
      const files = Array.from(new Set(candidates.map((r: any) => r.path as string)));
      if (files.length === 0) return '未找到匹配项';

      // Count exact literal occurrences per file.
      const perFile: { filePath: string; content: string; occ: number }[] = [];
      let totalOcc = 0;
      for (const filePath of files) {
        const content = await window.api.fs.readFile(filePath);
        const occ = content.split(pattern).length - 1;
        if (occ > 0) {
          perFile.push({ filePath, content, occ });
          totalOcc += occ;
        }
      }
      if (totalOcc === 0) {
        return `候选文件存在，但未找到精确字面匹配 "${pattern}"（注意：本工具按字面文本而非正则匹配，区分大小写）`;
      }
      if (dryRun) {
        return (
          `将替换 ${totalOcc} 处字面匹配（预览模式，未修改文件）：\n` +
          perFile.map((f) => `${f.filePath}：${f.occ} 处`).join('\n')
        );
      }

      let changed = 0;
      for (const { filePath, content, occ } of perFile) {
        const updated = content.split(pattern).join(replacement);
        const approved = await gateAction(tc.id, filePath, 'write', content, updated, 'edit');
        if (approved) {
          await writeFileTracked(filePath, updated);
          changed += occ;
        }
      }
      return `已替换 ${changed} 处字面匹配（共发现 ${totalOcc} 处）`;
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
      const approved = await gateAction(tc.id, `github issue: ${args.title}`, 'external', '', args.title as string, 'github');
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
      const approved = await gateAction(tc.id, `评论 issue`, 'external', '', args.body as string, 'github');
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
      const approved = await gateAction(tc.id, `创建 PR: ${title}`, 'external', '', `head: ${head} → base: ${base}\n${body}`, 'github');
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
      const ok = await gateAction(
        tc.id,
        `提交 PR #${number} 审查（${event}）`,
        'external',
        '',
        `${event}\n${body}`,
        'github',
        // Approving/requesting changes acts on the remote PR — flag APPROVE/REQUEST_CHANGES.
        event === 'COMMENT' ? undefined : { dangerous: true, dangerReason: `审查动作 ${event}` }
      );
      if (!ok) return 'GitHub 操作被用户拒绝';
      await window.api.github.createReview(token, info.owner, info.repo, number, event, body, comments);
      return event === 'APPROVE' ? `已批准 PR #${number}` : `已在 PR #${number} 上提交审查`;
    }
    case 'github_merge_pr': {
      const { token, info } = await getGitHubContext();
      if (!token || !info) throw new Error('未配置 GitHub token 或无法识别仓库');
      const number = args.number as number;
      const method = (args.method as string) || 'merge';
      const approved = await gateAction(tc.id, `合并 PR #${number}`, 'external', '', `${method} PR #${number}`, 'github');
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
      const approved = await gateAction(tc.id, `创建 release: ${tag}`, 'external', '', `tag: ${tag}\n${body}`, 'github');
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
      const exact = content.split(oldStr).length - 1;
      if (exact > 1) throw new Error(`oldString 在文件中出现 ${exact} 次，不唯一。`);
      const applied = applyEdit(content, oldStr, newStr, false);
      if (!applied.ok) throw new Error('文件中未找到 oldString');
      const approved = await gateAction(tc.id, filePath, 'write', content, applied.result, 'edit');
      if (!approved) return '文件编辑被用户拒绝';
      await writeFileTracked(filePath, applied.result);
      return `已编辑文件：${args.path}`;
    }

    default:
      throw new Error(`未知工具：${tc.name}`);
  }
}
