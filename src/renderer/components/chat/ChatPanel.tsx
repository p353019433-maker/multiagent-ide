import React, { useState, useRef, useEffect, useCallback } from 'react';
import { v4 as uuid } from 'uuid';
import { useAI } from '../../context/AIContext';
import { useWorkspace } from '../../context/WorkspaceContext';
import { useEditor } from '../../context/EditorContext';
import ChatMessage from './ChatMessage';
import AgentToolView from './AgentToolView';
import DiffPreview from '../editor/DiffPreview';
import type { ChatMessage as ChatMessageType, ToolCall, AgentToolExecution, Checkpoint } from '@shared/types';
import { BUILTIN_TOOLS, AGENT_SYSTEM_PROMPT } from '@shared/tools';
import {
  type ApprovalMode,
  DEFAULT_APPROVAL_MODE,
  APPROVAL_MODE_META,
  classifyCommand,
  decideApproval,
} from '@shared/command-policy';
import { setAiCompleteFn, updateInlineCompletionConfig } from '../editor/aiInlineCompletion';
import { executeSingleTool as executeSingleTool_impl, type ToolContext } from '../../agent/toolExecutor';
import { resolveWorkspacePath, classifyToolError, compactMessages } from '../../agent/agentUtils';
import SessionTabs from './SessionTabs';

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
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>(DEFAULT_APPROVAL_MODE);
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Snapshots of files captured before the current turn modifies them, so a
  // checkpoint can be created when the turn finishes. Keyed by path.
  const turnSnapshots = useRef<Map<string, string | null>>(new Map());
  // Files edited during the current turn — drives the auto-lint self-heal pass.
  const turnEditedFiles = useRef<Set<string>>(new Set());
  // Project rules (AGENTS.md / .cursorrules), appended to the system prompt.
  const projectRules = useRef<{ file: string; content: string } | null>(null);

  // Keep a ref so tool execution (which runs outside React render) reads the
  // current mode without stale-closure issues.
  const approvalModeRef = useRef<ApprovalMode>(DEFAULT_APPROVAL_MODE);
  approvalModeRef.current = approvalMode;

  // Load persisted approval mode once.
  useEffect(() => {
    window.api.store.get('approvalMode').then((m) => {
      if (m === 'readonly' || m === 'auto' || m === 'full') setApprovalMode(m);
    });
  }, []);

  const changeApprovalMode = (m: ApprovalMode) => {
    setApprovalMode(m);
    window.api.store.set('approvalMode', m);
  };

  // Load project rules (AGENTS.md / .cursorrules) for the current workspace.
  useEffect(() => {
    if (!rootPath) {
      projectRules.current = null;
      return;
    }
    window.api.rules
      .load(rootPath)
      .then((r) => {
        projectRules.current = r;
      })
      .catch(() => {
        projectRules.current = null;
      });
  }, [rootPath]);

  // Build the effective system prompt: base agent prompt + project rules.
  const buildSystemPrompt = (): string => {
    if (projectRules.current?.content) {
      return (
        AGENT_SYSTEM_PROMPT +
        `\n\n## Project Rules (from ${projectRules.current.file})\n` +
        'The user has defined project-specific rules. Follow them strictly:\n\n' +
        projectRules.current.content
      );
    }
    return AGENT_SYSTEM_PROMPT;
  };

  const activeConversation = conversations.find((c) => c.id === activeConversationId);
  const messages = activeConversation?.messages || [];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamContent, toolExecutions]);

  // ── AI Inline Completion setup ──
  useEffect(() => {
    if (!activeProviderId) {
      updateInlineCompletionConfig({ providerId: activeProviderId, model: activeModel });
      return;
    }

    // Detect FIM support so the provider can tune debounce/cooldown.
    window.api.ai
      .supportsFim(activeProviderId, activeModel || 'default')
      .then((fim) =>
        updateInlineCompletionConfig({ providerId: activeProviderId, model: activeModel, fim })
      )
      .catch(() =>
        updateInlineCompletionConfig({ providerId: activeProviderId, model: activeModel })
      );

    setAiCompleteFn(async ({ prefix, suffix, language }) => {
      // Prefer a real FIM transport when the active model is a dedicated code
      // model (DeepSeek V3/V4, Codestral, Qwen-Coder, etc.). FIM uses both
      // prefix and suffix natively, giving faster and more accurate inline
      // suggestions. Chat-only models (Claude/GPT/Gemini) fall back below.
      try {
        const fim = await window.api.ai.fimComplete({
          providerId: activeProviderId,
          model: activeModel || 'default',
          // FIM models handle large context; give them a generous window.
          prefix: prefix.slice(-4000),
          suffix: suffix.slice(0, 2000),
          maxTokens: 256,
        });
        if (fim !== null) {
          // FIM returns raw middle text; trim a trailing newline burst but keep
          // intentional whitespace.
          return fim.replace(/\n{3,}$/g, '\n') || null;
        }
        // fim === null means the model has no FIM transport — fall through.
      } catch {
        // fall through to chat-based completion
      }

      const prompt = `Complete the code at the cursor. Return ONLY the code to insert — no explanations, no markdown, no code fences. The completion should follow naturally from the prefix and suffix.

Language: ${language}

=== PREFIX (before cursor) ===
${prefix.slice(-2000)}

=== SUFFIX (after cursor) ===
${suffix.slice(0, 500)}

=== COMPLETION ===`;

      try {
        const result = await window.api.ai.chat(
          activeProviderId,
          [{ role: 'user', content: prompt }],
          {
            model: activeModel || 'default',
            systemPrompt:
              'You are a code completion engine. Return ONLY raw code. No backticks. No markdown. No explanations. Just the code that should appear at the cursor position.',
            maxTokens: 200,
            temperature: 0.1,
          }
        );

        if (result?.content) {
          // Clean up common AI artifacts
          let text = result.content.trim();
          // Remove markdown code fences if present
          text = text.replace(/^```[\s\S]*?\n?/g, '').replace(/```$/g, '');
          return text || null;
        }
        return null;
      } catch {
        return null;
      }
    });

    return () => {
      setAiCompleteFn(() => Promise.resolve(null));
    };
  }, [activeProviderId, activeModel]);

  const handleSend = useCallback(async () => {
    if ((!input.trim() && pendingImages.length === 0) || !activeProviderId || !activeModel) return;
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

    // Inject any @-referenced files (e.g. "@src/main/index.ts") so the model
    // gets their full content up front, like Cursor's @file mentions.
    const mentioned = Array.from(input.matchAll(/@([^\s@]+)/g)).map((m) => m[1]);
    for (const ref of mentioned) {
      try {
        const refPath = resolvePath(ref);
        const content = await window.api.fs.readFile(refPath);
        contextPrefix += `[引用文件: ${ref}]\n\`\`\`\n${content.slice(0, 4000)}\n\`\`\`\n\n`;
      } catch {
        // Not a resolvable file path — leave the @mention as plain text.
      }
    }

    const userMsg: ChatMessageType = {
      id: uuid(),
      role: 'user',
      content: input,
      images: pendingImages.length ? pendingImages : undefined,
      timestamp: Date.now(),
    };
    addMessage(convId, userMsg);
    const turnImages = pendingImages;
    const turnLabel = input.slice(0, 60);
    setInput('');
    setPendingImages([]);
    setIsStreaming(true);
    setStreamContent('');
    setToolExecutions([]);

    // Begin a new turn: reset checkpoint/edit trackers.
    turnSnapshots.current = new Map();
    turnEditedFiles.current = new Set();

    const apiMessages: ChatMessageType[] = [
      ...messages,
      { ...userMsg, content: contextPrefix + userMsg.content, images: turnImages.length ? turnImages : undefined },
    ];

    await runAgentLoop(convId, apiMessages, turnLabel);
  }, [input, activeProviderId, activeModel, activeConversationId, messages, activeFilePath, openFiles, pendingImages]);

  const runAgentLoop = async (convId: string, apiMessages: ChatMessageType[], turnLabel = '') => {
    let loopMessages = compactMessages([...apiMessages]);
    let iterations = 0;
    const maxIterations = 25;
    // Track repeated identical tool calls to detect a stuck agent.
    let lastToolSignature = '';
    let repeatCount = 0;
    // Auto-lint self-heal runs at most once per turn.
    let selfHealAttempted = false;

    while (iterations < maxIterations) {
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

    if (iterations >= maxIterations) {
      addMessage(convId, {
        id: uuid(),
        role: 'assistant',
        content: `⚠️ 已达到最大 ${maxIterations} 轮工具调用上限，自动停止。如需继续可再发一条消息。`,
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
    }

    setIsStreaming(false);
  };

  /** Revert all file changes captured in a checkpoint. */
  const revertCheckpoint = async (cp: Checkpoint) => {
    if (!confirm(`回滚 ${cp.files.length} 个文件到「${cp.label}」之前的状态？`)) return;
    for (const f of cp.files) {
      try {
        if (f.before === null) {
          await window.api.fs.delete(f.path); // file was created in the turn
        } else {
          await window.api.fs.writeFile(f.path, f.before);
        }
      } catch {
        // best-effort; continue reverting the rest
      }
    }
    setCheckpoints((prev) => prev.filter((c) => c.id !== cp.id));
    window.dispatchEvent(new CustomEvent('files-reverted'));
    alert(`已回滚 ${cp.files.length} 个文件`);
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
      } catch (err: any) {
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

  /** Run a tool, retrying transient failures with exponential backoff. */
  const executeToolWithRetry = async (tc: ToolCall, maxAttempts = 3): Promise<string> => {
    let lastErr: any;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await executeSingleTool(tc);
      } catch (err: any) {
        lastErr = err;
        const { retriable } = classifyToolError(err);
        // Approval rejections and logic errors should fail fast.
        if (!retriable || attempt === maxAttempts) throw err;
        await new Promise((r) => setTimeout(r, 2 ** (attempt - 1) * 500));
      }
    }
    throw lastErr;
  };

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

  // ── Approval system (mode-aware) ──
  // In `auto` mode workspace writes auto-accept after a countdown; in
  // `readonly` mode (or for dangerous commands) approval is manual with no
  // countdown; in `full` mode the gate is skipped entirely upstream.
  const AUTO_ACCEPT_MS = 5000;
  const autoApproveTimeout = useRef<NodeJS.Timeout | null>(null);

  const [pendingApproval, setPendingApproval] = useState<{
    toolCallId: string;
    filePath: string;
    action: 'write' | 'edit' | 'replace_in_file' | 'search_and_replace' | 'github' | 'command';
    before: string;
    after: string;
    /** When true the approval auto-accepts after AUTO_ACCEPT_MS; otherwise manual. */
    countdown: boolean;
    /** Optional danger reason shown to the user (dangerous commands). */
    dangerReason?: string;
    resolve: (approved: boolean) => void;
  } | null>(null);

  const requestApproval = (
    toolCallId: string,
    filePath: string,
    action: 'write' | 'edit' | 'replace_in_file' | 'search_and_replace' | 'github' | 'command',
    before: string,
    after: string,
    opts?: { countdown?: boolean; dangerReason?: string }
  ): Promise<boolean> => {
    const countdown = opts?.countdown ?? true;
    return new Promise((resolve) => {
      setPendingApproval({
        toolCallId,
        filePath,
        action,
        before,
        after,
        countdown,
        dangerReason: opts?.dangerReason,
        resolve,
      });
      if (countdown) {
        // Auto-accept after the countdown — user can reject before that.
        autoApproveTimeout.current = setTimeout(() => {
          setPendingApproval((prev) => {
            if (prev?.toolCallId === toolCallId) {
              prev.resolve(true);
              return null;
            }
            return prev;
          });
        }, AUTO_ACCEPT_MS);
      }
    });
  };

  /**
   * Central gate for a write/command/external action. Resolves the policy for
   * the current mode and either runs immediately, shows a countdown preview, or
   * blocks for manual approval. Returns true if the action may proceed.
   */
  const gateAction = (
    toolCallId: string,
    label: string,
    kind: 'write' | 'command' | 'external',
    before: string,
    after: string,
    action: 'write' | 'edit' | 'replace_in_file' | 'search_and_replace' | 'github' | 'command',
    opts?: { dangerous?: boolean; dangerReason?: string }
  ): Promise<boolean> => {
    const decision = decideApproval(approvalModeRef.current, kind, { dangerous: opts?.dangerous });
    if (decision === 'allow') return Promise.resolve(true);
    return requestApproval(toolCallId, label, action, before, after, {
      countdown: decision === 'auto',
      dangerReason: opts?.dangerReason,
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

  // Memoized tool context: injects all host capabilities the executor needs.
  const toolCtx: ToolContext = {
    rootPath,
    resolvePath,
    gateAction,
    writeFileTracked,
    getGitHubContext,
  };

  const executeSingleTool = (tc: ToolCall): Promise<string> => executeSingleTool_impl(tc, toolCtx);

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

  // ── Image attachments (multimodal input) ──
  const addImageFiles = (files: FileList | File[]) => {
    Array.from(files)
      .filter((f) => f.type.startsWith('image/'))
      .forEach((file) => {
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === 'string') {
            setPendingImages((prev) => [...prev, reader.result as string].slice(0, 6));
          }
        };
        reader.readAsDataURL(file);
      });
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items);
    const imgs = items.filter((i) => i.type.startsWith('image/'));
    if (imgs.length) {
      e.preventDefault();
      addImageFiles(imgs.map((i) => i.getAsFile()).filter(Boolean) as File[]);
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

      {/* Approval mode selector */}
      <div className="flex items-center gap-1 px-3 py-1 border-b border-editor-border flex-shrink-0">
        <span className="text-[10px] text-gray-500 mr-1">审批</span>
        {(['readonly', 'auto', 'full'] as ApprovalMode[]).map((m) => {
          const meta = APPROVAL_MODE_META[m];
          const active = approvalMode === m;
          return (
            <button
              key={m}
              onClick={() => changeApprovalMode(m)}
              title={meta.hint}
              className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                active
                  ? m === 'full'
                    ? 'bg-red-600/80 text-white'
                    : m === 'readonly'
                    ? 'bg-blue-600/80 text-white'
                    : 'bg-editor-accent text-white'
                  : 'text-gray-400 hover:bg-editor-hover'
              }`}
            >
              {meta.icon} {meta.label}
            </button>
          );
        })}
      </div>

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

      {/* Checkpoints — revert all file changes from a past turn */}
      {checkpoints.length > 0 && (
        <div className="px-3 py-1.5 border-t border-editor-border flex-shrink-0 max-h-24 overflow-y-auto">
          <div className="text-[10px] text-gray-500 mb-1">⏱ 检查点（可回滚）</div>
          <div className="space-y-1">
            {checkpoints.slice(0, 5).map((cp) => (
              <div key={cp.id} className="flex items-center justify-between gap-2 text-[11px]">
                <span className="text-gray-400 truncate" title={cp.label}>
                  {cp.label || '改动'}（{cp.files.length} 文件）
                </span>
                <button
                  onClick={() => revertCheckpoint(cp)}
                  className="flex-shrink-0 px-1.5 py-0.5 rounded bg-editor-hover text-gray-300 hover:bg-red-600 hover:text-white"
                  title="回滚此检查点的所有文件改动"
                >
                  ↩ 回滚
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {pendingApproval && pendingApproval.action !== 'edit' && pendingApproval.action !== 'write' && pendingApproval.action !== 'replace_in_file' && pendingApproval.action !== 'search_and_replace' ? (
        <div className={`px-3 py-2 border-t border-editor-border flex-shrink-0 ${pendingApproval.dangerReason ? 'bg-red-900/20' : 'bg-yellow-900/10'}`}>
          <div className="flex items-center justify-between">
            <span className={`text-xs font-semibold ${pendingApproval.dangerReason ? 'text-red-400' : 'text-yellow-400'}`}>
              {pendingApproval.action === 'command' ? '🖥 执行命令' : '⚡ GitHub 操作'}：{pendingApproval.filePath.slice(0, 60)}
            </span>
            <span className={`text-[11px] animate-pulse ${pendingApproval.dangerReason ? 'text-red-400' : 'text-yellow-400'}`}>
              {pendingApproval.countdown ? '5 秒后自动接受' : '需手动批准'}
            </span>
          </div>
          {pendingApproval.dangerReason && (
            <div className="text-[11px] text-red-300 mt-1">
              ⚠️ 高风险操作：{pendingApproval.dangerReason}
            </div>
          )}
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
              {pendingApproval.countdown ? '5 秒后自动接受' : '需手动批准'}
            </span>
            <button
              onClick={handleApprove}
              className="px-1.5 py-0.5 text-[11px] bg-green-600 text-white rounded hover:bg-green-700"
            >
              接受
            </button>
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
          <>
            {/* Pending image thumbnails */}
            {pendingImages.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {pendingImages.map((img, i) => (
                  <div key={i} className="relative group">
                    <img
                      src={img}
                      alt="attachment"
                      className="h-12 w-12 object-cover rounded border border-editor-border"
                    />
                    <button
                      onClick={() => setPendingImages((prev) => prev.filter((_, j) => j !== i))}
                      className="absolute -top-1 -right-1 bg-red-600 text-white rounded-full w-4 h-4 text-[10px] leading-none opacity-0 group-hover:opacity-100"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder="跟 AI 说点什么...（可粘贴/附加图片）"
                className="flex-1 bg-editor-bg border border-editor-border rounded px-3 py-2 text-sm text-editor-text resize-none outline-none focus:border-editor-accent transition-colors"
                rows={2}
                disabled={isStreaming}
              />
              <div className="flex flex-col gap-1">
                <label
                  className="px-3 py-1 bg-editor-hover text-gray-300 text-xs rounded hover:bg-editor-active transition-colors cursor-pointer text-center"
                  title="附加图片"
                >
                  🖼
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files) addImageFiles(e.target.files);
                      e.target.value = '';
                    }}
                  />
                </label>
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
                    disabled={!input.trim() && pendingImages.length === 0}
                    className="px-3 py-1 bg-editor-accent text-white text-xs rounded hover:opacity-90 transition-opacity disabled:opacity-40"
                  >
                    发送
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
