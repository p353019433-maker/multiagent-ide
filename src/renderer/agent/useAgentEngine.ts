/**
 * Agent engine hook — owns the multi-turn agent loop, tool execution, retry,
 * self-heal, checkpoints, and streaming state. Extracted from ChatPanel
 * (behavior-preserving). Host-specific decisions (approval) are injected via
 * deps so this hook stays focused on orchestration.
 */

import { useRef, useState } from 'react';
import { v4 as uuid } from 'uuid';
import type {
  ChatMessage as ChatMessageType,
  ToolCall,
  AgentToolExecution,
  Checkpoint,
  Artifact,
} from '@shared/types';
import { BUILTIN_TOOLS } from '@shared/tools';
import { executeSingleTool, type ToolContext } from './toolExecutor';
import { resolveWorkspacePath, classifyToolError, compactMessages } from './agentUtils';
import type { GateActionFn } from './useApproval';

export interface AgentEngineDeps {
  activeProviderId: string | null;
  activeModel: string | null;
  rootPath: string | null;
  addMessage: (conversationId: string, message: ChatMessageType) => void;
  buildSystemPrompt: () => string;
  gateAction: GateActionFn;
  onFileChanged?: (path: string, content?: string) => Promise<void> | void;
}

const MAX_ITERATIONS = 25;

export function useAgentEngine(deps: AgentEngineDeps) {
  const { activeProviderId, activeModel, rootPath, addMessage, buildSystemPrompt, gateAction, onFileChanged } = deps;

  const [isStreaming, setIsStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState('');
  const [toolExecutions, setToolExecutions] = useState<AgentToolExecution[]>([]);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);

  // Snapshots of files captured before the current turn modifies them, so a
  // checkpoint can be created when the turn finishes. Keyed by path.
  const turnSnapshots = useRef<Map<string, string | null>>(new Map());
  // Files edited during the current turn — drives the auto-lint self-heal pass.
  const turnEditedFiles = useRef<Set<string>>(new Set());

  const resolvePath = (p: string): string => resolveWorkspacePath(rootPath, p);

  /**
   * Write a file while recording a checkpoint snapshot. The first time a path is
   * touched in a turn we capture its prior content (or null if it didn't exist)
   * so the turn can be reverted later, and we mark it for the auto-lint pass.
   */
  const writeFileTracked = async (filePath: string, content: string) => {
    if (!turnSnapshots.current.has(filePath)) {
      let before: string | null = null;
      try {
        before = await window.api.fs.readFile(filePath);
      } catch {
        before = null; // new file
      }
      turnSnapshots.current.set(filePath, before);
    }
    await window.api.fs.writeFile(filePath, content);
    await onFileChanged?.(filePath, content);
    turnEditedFiles.current.add(filePath);
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

  const toolCtx: ToolContext = {
    rootPath,
    resolvePath,
    gateAction,
    writeFileTracked,
    getGitHubContext,
  };

  /** Run a tool, retrying transient failures with exponential backoff. */
  const executeToolWithRetry = async (tc: ToolCall, maxAttempts = 3): Promise<string> => {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await executeSingleTool(tc, toolCtx);
      } catch (err) {
        lastErr = err;
        const { retriable } = classifyToolError(err);
        // Approval rejections and logic errors should fail fast.
        if (!retriable || attempt === maxAttempts) throw err;
        await new Promise((r) => setTimeout(r, 2 ** (attempt - 1) * 500));
      }
    }
    throw lastErr;
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
        const result = await executeToolWithRetry(tc);
        setToolExecutions((prev) =>
          prev.map((e) => (e.id === tc.id ? { ...e, status: 'success', result } : e))
        );
        results.push({ toolCallId: tc.id, content: result });
      } catch (err) {
        const { message, retriable } = classifyToolError(err);
        setToolExecutions((prev) =>
          prev.map((e) => (e.id === tc.id ? { ...e, status: 'error', error: message } : e))
        );
        // Give the model a structured, actionable error rather than a raw string.
        results.push({
          toolCallId: tc.id,
          content: `错误（${retriable ? '可重试' : '不可重试'}）：${message}`,
          isError: true,
        });
      }
    }

    return results;
  };

  /**
   * Run one user turn: the streaming agent loop with tool execution, stuck-loop
   * detection, auto-lint self-heal, and end-of-turn checkpoint creation.
   */
  const runTurn = async (convId: string, apiMessages: ChatMessageType[], turnLabel = '') => {
    setIsStreaming(true);
    setStreamContent('');
    setToolExecutions([]);
    // Begin a new turn: reset checkpoint/edit trackers.
    turnSnapshots.current = new Map();
    turnEditedFiles.current = new Set();

    let loopMessages = compactMessages([...apiMessages]);
    let iterations = 0;
    // Track repeated identical tool calls to detect a stuck agent.
    let lastToolSignature = '';
    let repeatCount = 0;
    // Auto-lint self-heal runs at most once per turn.
    let selfHealAttempted = false;

    while (iterations < MAX_ITERATIONS) {
      iterations++;
      setStreamContent('');
      loopMessages = compactMessages(loopMessages);

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
            systemPrompt: buildSystemPrompt(),
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
          // The agent thinks it's done. Before stopping, run a self-heal lint
          // pass on the files it edited and, if there are errors, feed them back
          // once so the agent can fix them automatically.
          if (!selfHealAttempted && turnEditedFiles.current.size > 0 && rootPath) {
            selfHealAttempted = true;
            const edited = Array.from(turnEditedFiles.current);
            const check = await window.api.lint.check(rootPath, edited).catch(() => null);
            if (check?.hasErrors && check.output) {
              const healMsg: ChatMessageType = {
                id: uuid(),
                role: 'user',
                content:
                  '你刚才的改动引入了以下 lint/类型错误，请修复它们（不要重复无效操作）：\n\n```\n' +
                  check.output.slice(0, 4000) +
                  '\n```',
                timestamp: Date.now(),
              };
              addMessage(convId, healMsg);
              loopMessages = [...loopMessages, assistantMsg, healMsg];
              continue;
            }
          }
          break;
        }

        // Detect a stuck loop: the same tool calls repeated with no change.
        const signature = JSON.stringify(
          result.toolCalls.map((tc: ToolCall) => [tc.name, tc.arguments])
        );
        if (signature === lastToolSignature) {
          repeatCount++;
        } else {
          repeatCount = 0;
          lastToolSignature = signature;
        }
        if (repeatCount >= 2) {
          addMessage(convId, {
            id: uuid(),
            role: 'assistant',
            content: '⚠️ 检测到 Agent 重复执行相同操作且无进展，已自动停止。',
            timestamp: Date.now(),
          });
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

    if (iterations >= MAX_ITERATIONS) {
      addMessage(convId, {
        id: uuid(),
        role: 'assistant',
        content: `⚠️ 已达到最大 ${MAX_ITERATIONS} 轮工具调用上限，自动停止。如需继续可再发一条消息。`,
        timestamp: Date.now(),
      });
    }

    // Create a checkpoint from this turn's snapshots so the user can revert all
    // file changes in one click.
    if (turnSnapshots.current.size > 0) {
      const cp: Checkpoint = {
        id: uuid(),
        label: turnLabel || '未命名改动',
        createdAt: Date.now(),
        files: Array.from(turnSnapshots.current.entries()).map(([path, before]) => ({
          path,
          before,
        })),
      };
      setCheckpoints((prev) => [cp, ...prev].slice(0, 20));

      // Produce a verifiable artifact: what changed + verification result.
      await generateArtifact(turnLabel || '未命名改动', Array.from(turnSnapshots.current.keys()));
    }

    setIsStreaming(false);
  };

  /**
   * Build an Antigravity-style verifiable deliverable for a turn that changed
   * files: a markdown report listing the changed files, the post-change lint /
   * type verification result, and a git diff stat. Persisted under
   * .ide/artifacts/ so it survives and can be opened in the editor.
   */
  const generateArtifact = async (label: string, files: string[]) => {
    let verified = true;
    let lintSection = '';
    if (rootPath) {
      const check = await window.api.lint.check(rootPath, files).catch(() => null);
      if (check) {
        verified = !check.hasErrors;
        lintSection = check.hasErrors
          ? '❌ **验证未通过**\n\n```\n' + check.output.slice(0, 2000) + '\n```'
          : '✅ **验证通过**（ESLint + tsc 无错误）';
      }
    }

    let diffStat = '';
    if (rootPath) {
      try {
        const out = await window.api.terminal.runCommand(rootPath, 'git diff --stat', 8000);
        diffStat = (out.stdout || '').trim();
      } catch {
        // ignore
      }
    }

    const rel = (p: string) => (rootPath && p.startsWith(rootPath) ? p.slice(rootPath.length + 1) : p);
    const ts = new Date();
    const report =
      `# 改动交付报告：${label}\n\n` +
      `> 生成时间：${ts.toLocaleString()}\n\n` +
      `## 改动文件（${files.length}）\n` +
      files.map((f) => `- \`${rel(f)}\``).join('\n') +
      `\n\n## 验证\n${lintSection || '（未运行验证）'}\n` +
      (diffStat ? `\n## Diff 统计\n\`\`\`\n${diffStat}\n\`\`\`\n` : '');

    const artifact: Artifact = {
      id: uuid(),
      label,
      createdAt: ts.getTime(),
      files: files.map(rel),
      verified,
      report,
    };

    // Persist under .ide/artifacts/.
    if (rootPath) {
      try {
        const fname = `${ts.toISOString().replace(/[:.]/g, '-')}.md`;
        const apath = `${rootPath}/.ide/artifacts/${fname}`;
        await window.api.fs.writeFile(apath, report);
        artifact.path = apath;
      } catch {
        // best-effort
      }
    }

    setArtifacts((prev) => [artifact, ...prev].slice(0, 20));
  };

  const abort = () => {
    window.api.ai.abort();
    setIsStreaming(false);
  };

  /** Revert all file changes captured in a checkpoint. */
  const revertCheckpoint = async (cp: Checkpoint) => {
    if (!confirm(`回滚 ${cp.files.length} 个文件到「${cp.label}」之前的状态？`)) return;
    for (const f of cp.files) {
      try {
        if (f.before === null) {
          await window.api.fs.delete(f.path); // file was created in the turn
          await onFileChanged?.(f.path);
        } else {
          await window.api.fs.writeFile(f.path, f.before);
          await onFileChanged?.(f.path, f.before);
        }
      } catch {
        // best-effort; continue reverting the rest
      }
    }
    setCheckpoints((prev) => prev.filter((c) => c.id !== cp.id));
    window.dispatchEvent(new CustomEvent('files-reverted'));
    alert(`已回滚 ${cp.files.length} 个文件`);
  };

  return {
    isStreaming,
    streamContent,
    toolExecutions,
    checkpoints,
    artifacts,
    runTurn,
    abort,
    revertCheckpoint,
  };
}
