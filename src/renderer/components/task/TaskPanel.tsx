import React, { useState, useRef, useEffect, useCallback } from 'react';
import { v4 as uuid } from 'uuid';
import { useTaskWorkspace, type RunDebateTaskResult } from '../../context/TaskContext';
import { useWorkspace } from '../../context/WorkspaceContext';
import { useEditor } from '../../context/EditorContext';
import TaskMessage from './TaskMessage';
import type { ChatMessage as ChatMessageType } from '@shared/types';
import { TASK_SYSTEM_PROMPT } from '@shared/tools';
import { setInlineCompletionSource, updateInlineCompletionConfig } from '../editor/inlineCompletion';
import { resolveWorkspacePath, worktreePathFor } from '../../task-engine/taskUtils';
import { loadSkillsMenu } from '../../task-engine/skills';
import { useApproval } from '../../task-engine/useApproval';
import { useTaskEngine } from '../../task-engine/useTaskEngine';
import TaskSessionTabs from './TaskSessionTabs';
import ModelPicker from './ModelPicker';
import RunInspector from '../workbench/RunInspector';
import { APPROVAL_MODE_META, type ApprovalMode } from '@shared/command-policy';
import { ArrowUp, CheckCircle2, CircleAlert, CircleDot, GitBranch, Paperclip, Plus, Sparkles, Square } from 'lucide-react';
import { AgentPlan, AgentRunBar, PendingApprovalView } from './TaskPanelSections';
import type { AgentReadiness, ReadinessActionId, ReadinessStatus } from '../../readiness/agentReadiness';

interface Props {
  readiness: AgentReadiness;
  onReadinessAction: (actionId: ReadinessActionId) => void;
}

const STATUS_LABEL: Record<ReadinessStatus, string> = {
  done: '完成',
  ready: '就绪',
  blocked: '需要处理',
  optional: '可选',
};

const DEBATE_STAGE_LABEL: Record<string, string> = {
  analyst: '解析',
  proposer: '方案',
  critic: '异议',
  synthesizer: '综合',
  executor: '执行',
};

function ReadinessIcon({ status }: { status: ReadinessStatus }) {
  if (status === 'done' || status === 'ready') {
    return <CheckCircle2 size={13} strokeWidth={1.8} className="text-emerald-400" />;
  }
  if (status === 'blocked') {
    return <CircleAlert size={13} strokeWidth={1.8} className="text-yellow-400" />;
  }
  return <CircleDot size={13} strokeWidth={1.8} className="text-muted-foreground" />;
}

export default function TaskPanel({ readiness, onReadinessAction }: Props) {
  const {
    activeProviderId,
    activeModel,
    providers,
    conversations,
    activeConversationId,
    setActiveProvider,
    setActiveModel,
    newConversation,
    newWorktreeConversation,
    setActiveConversation,
    deleteConversation,
    addMessage,
    renameConversation,
    runDebateTask,
    currentDebate,
    stopDebate,
  } = useTaskWorkspace();
  const { rootPath } = useWorkspace();
  const { activeFilePath, openFiles, openFile, reloadFileFromDisk } = useEditor();

  const [input, setInput] = useState('');
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [multiRoleMode, setMultiRoleMode] = useState(false);
  const [multiRoleRunning, setMultiRoleRunning] = useState(false);
  const [multiRoleResult, setMultiRoleResult] = useState<{
    ok: boolean;
    error?: string;
    editedFiles?: string[];
    note?: string;
    worktreePath?: string;
    worktreeBranch?: string;
  } | null>(null);
  const [worktreeNotice, setWorktreeNotice] = useState<{
    tone: 'success' | 'error';
    text: string;
  } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Project rules (AGENTS.md / .cursorrules), appended to the system prompt.
  const projectRules = useRef<{ file: string; content: string } | null>(null);
  // Installed-skills menu (.claude/skills), appended so the agent can use_skill.
  const skillsMenu = useRef('');

  // Approval gate (mode + pending-approval state + decision logic).
  const {
    approvalMode,
    changeApprovalMode,
    allowExternalInFull,
    changeAllowExternalInFull,
    pendingApproval,
    gateAction,
    handleApprove,
    handleReject,
  } =
    useApproval();

  // Active conversation + its effective workspace root (worktree path when the
  // session runs in an isolated worktree, else the open folder). Declared before
  // the task engine so it can be passed in.
  const activeConversation = conversations.find((c) => c.id === activeConversationId);
  const effectiveRootPath = activeConversation?.worktree?.path ?? rootPath;
  const messages = activeConversation?.messages || [];
  const activeWorktree = activeConversation?.worktree;

  // Load project rules (AGENTS.md / .cursorrules) for the current workspace.
  useEffect(() => {
    if (!rootPath) {
      projectRules.current = null;
      skillsMenu.current = '';
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
    loadSkillsMenu(rootPath)
      .then((m) => {
        skillsMenu.current = m;
      })
      .catch(() => {
        skillsMenu.current = '';
      });
  }, [rootPath]);

  // Build the effective system prompt: base task prompt + project rules + skills.
  const buildSystemPrompt = (): string => {
    let prompt = TASK_SYSTEM_PROMPT;
    if (projectRules.current?.content) {
      prompt +=
        `\n\n## Project Rules (from ${projectRules.current.file})\n` +
        'The user has defined project-specific rules. Follow them strictly:\n\n' +
        projectRules.current.content;
    }
    if (skillsMenu.current) prompt += skillsMenu.current;
    return prompt;
  };

  // Task engine: the multi-turn loop, tool execution, checkpoints, streaming.
  const { isStreaming, streamContent, toolExecutions, checkpoints, artifacts, turnTokens, plan, runTurn, abort, revertCheckpoint } =
    useTaskEngine({
      activeProviderId,
      activeModel,
      rootPath: effectiveRootPath,
      addMessage,
      buildSystemPrompt,
      gateAction,
      onFileChanged: reloadFileFromDisk,
    });
  const handleAbort = () => {
    abort();
    if (multiRoleRunning) {
      stopDebate();
      setMultiRoleRunning(false);
    }
  };
  const hasRuntimeRows = messages.length > 0 || toolExecutions.length > 0 || isStreaming || multiRoleRunning;
  const [inspectorDismissed, setInspectorDismissed] = useState(false);
  const hasInspectorContent =
    toolExecutions.length > 0 ||
    checkpoints.length > 0 ||
    artifacts.length > 0 ||
    !!pendingApproval ||
    multiRoleRunning ||
    !!multiRoleResult ||
    !!currentDebate;
  const showInspector = hasInspectorContent && !inspectorDismissed;

  useEffect(() => {
    if (isStreaming || multiRoleRunning || pendingApproval || toolExecutions.some((e) => e.status === 'running')) {
      setInspectorDismissed(false);
    }
  }, [isStreaming, multiRoleRunning, pendingApproval, toolExecutions]);

  const resolvePath = (p: string): string => resolveWorkspacePath(effectiveRootPath, p);

  // Auto-scroll to the latest message/tool/stream chunk, but throttle: streaming
  // fires many updates per second and scrollIntoView on each one janks the main
  // thread. Only scroll when the set of messages grows or a new tool execution
  // starts — not on every stream token.
  const prevMsgCount = useRef(0);
  const prevToolCount = useRef(0);
  useEffect(() => {
    const msgGrew = messages.length > prevMsgCount.current;
    const toolGrew = toolExecutions.length > prevToolCount.current;
    prevMsgCount.current = messages.length;
    prevToolCount.current = toolExecutions.length;
    // Always follow streaming text, but the streamContent dependency alone is
    // cheap enough (text diff) — the real cost was re-running on every tool
    // array identity change. Gate the heavy scroll to real growth.
    if (msgGrew || toolGrew || streamContent) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length, toolExecutions.length, streamContent]);

  // ── Inline completion setup ──
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

    setInlineCompletionSource(async ({ prefix, suffix, language, recentEdits }) => {
      // Recent edits steer the model toward the *next* edit (Cursor-Tab style).
      const editsCtx = recentEdits.length
        ? `\n\n=== RECENT EDITS (predict the natural next change) ===\n${recentEdits.join('\n---\n')}`
        : '';
      // Prefer a real FIM transport when the active model is a dedicated code
      // model (DeepSeek V3/V4, Codestral, Qwen-Coder, etc.). FIM uses both
      // prefix and suffix natively, giving faster and more accurate inline
      // suggestions. Request/response models (Claude/GPT/Gemini) fall back below.
      try {
        const fim = await window.api.ai.fimComplete({
          providerId: activeProviderId,
          model: activeModel || 'default',
          // FIM models handle large context; give them a generous window.
          // Recent edits are prepended as a comment to bias the next edit.
          prefix: (editsCtx ? `/* recent edits:\n${recentEdits.join('\n')}\n*/\n` : '') + prefix.slice(-4000),
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
        // fall through to request/response completion
      }

      const prompt = `You are an expert code completion engine. Complete the code exactly where the cursor is placed.
Return ONLY the raw code to insert. No explanations, no markdown formatting, no code fences.
The completion MUST follow naturally from the prefix and connect smoothly to the suffix.
If you need to replace or overwrite parts of the suffix (e.g. replacing a whole block), output the replacement text including the parts of the suffix you want to "consume". The editor will automatically handle the overlap.

Language: ${language}

=== PREFIX (before cursor) ===
${prefix.slice(-2000)}

=== SUFFIX (after cursor) ===
${suffix.slice(0, 500)}${editsCtx}

=== EXACT COMPLETION ===`;

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
          // Clean up common model-output artifacts.
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
      setInlineCompletionSource(() => Promise.resolve(null));
    };
  }, [activeProviderId, activeModel]);

  const handleRunTask = useCallback(async () => {
    if ((!input.trim() && pendingImages.length === 0) || !activeProviderId || !activeModel) return;
    if (isStreaming) return;

    let convId = activeConversationId;
    if (!convId) {
      convId = newConversation();
    }

    let contextPrefix = '';
    if (activeFilePath && (!effectiveRootPath || activeFilePath.startsWith(effectiveRootPath + '/'))) {
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
    const requestText = contextPrefix + userMsg.content;
    setInput('');
    setPendingImages([]);

    if (multiRoleMode) {
      if (!effectiveRootPath) {
        addMessage(convId, {
          id: uuid(),
          role: 'assistant',
          content: '多角色流程需要先打开一个项目工作区。请先打开文件夹后再运行。',
          timestamp: Date.now(),
        });
        return;
      }
      setMultiRoleRunning(true);
      setMultiRoleResult(null);
      const result: RunDebateTaskResult = await runDebateTask(convId, requestText, effectiveRootPath).catch((error) => ({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }));
      setMultiRoleRunning(false);
      setMultiRoleResult(result);
      const details = result.ok
        ? [
            result.editedFiles?.length ? `改动文件：${result.editedFiles.length} 个` : null,
            result.worktreeBranch ? `隔离分支：${result.worktreeBranch}` : null,
            result.note ? `提示：${result.note}` : null,
          ].filter(Boolean).join('\n')
        : `失败原因：${result.error || '未知错误'}`;
      const assistantMsg: ChatMessageType = {
        id: uuid(),
        role: 'assistant',
        content: result.ok
          ? `多角色流程已完成：解析、方案、异议、综合和执行阶段已运行。\n${details}`.trim()
          : `多角色流程未完成。\n${details}`,
        timestamp: Date.now(),
      };
      addMessage(convId, assistantMsg);
      return;
    }

    const apiMessages: ChatMessageType[] = [
      ...messages,
      { ...userMsg, content: requestText, images: turnImages.length ? turnImages : undefined },
    ];

    await runTurn(convId, apiMessages, turnLabel);
  }, [input, activeProviderId, activeModel, activeConversationId, messages, activeFilePath, openFiles, pendingImages, effectiveRootPath, runTurn, newConversation, multiRoleMode, runDebateTask, addMessage]);

  /** Create a new isolated worktree session */
  const handleNewWorktreeSession = async () => {
    setWorktreeNotice(null);
    if (!rootPath) {
      setWorktreeNotice({ tone: 'error', text: '需要先打开一个 Git 项目才能创建隔离工作树' });
      return;
    }
    try {
      // Check current branch
      const currentBranch = await window.api.git.currentBranch(rootPath);
      const branchName = `task-${Date.now().toString(36)}`;
      const parentDir = (window as Window & { __WORKTREE_PARENT__?: string }).__WORKTREE_PARENT__ || rootPath;
      const wtPath = worktreePathFor(parentDir, branchName);

      const result = await window.api.git.worktreeAdd(rootPath, wtPath, branchName, currentBranch);
      if (!result.success) {
        setWorktreeNotice({ tone: 'error', text: `创建 worktree 失败：${result.message}` });
        return;
      }

      await newWorktreeConversation(wtPath, branchName, currentBranch);
      setWorktreeNotice({ tone: 'success', text: `已创建隔离任务：${branchName}` });

      // Open the worktree directory in FileService (requires update)
      console.log(`Worktree created: ${wtPath}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setWorktreeNotice({ tone: 'error', text: `创建隔离会话失败：${message}` });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleRunTask();
    }
  };

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 200)}px`;
    }
  }, [input]);

  // ── Attachments ──
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
    <div className="flex h-full min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col bg-background">
      <div className="flex h-[68px] flex-shrink-0 items-center justify-between gap-2 border-b border-border bg-surface-1 px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 flex-none items-center justify-center rounded-2xl bg-primary text-sm font-semibold text-primary-foreground shadow-ambient">AI</div>
          <div className="min-w-0">
            <div className="text-10 font-bold uppercase tracking-[0.08em] text-foreground/35">Agent Run</div>
            <div className="min-w-0 truncate text-[15px] font-semibold text-foreground">
              {activeConversation?.title || '新任务'}
            </div>
          </div>
          {activeWorktree && (
            <span className="flex-none rounded-md bg-warn-surface px-1.5 py-0.5 font-mono text-10 text-warn" title={activeWorktree.path}>
              WT {activeWorktree.branch}
            </span>
          )}
        </div>
        <div className="flex min-w-0 items-center gap-1.5">
          {providers.length > 0 && (
            <ModelPicker
              providers={providers}
              activeProviderId={activeProviderId}
              activeModel={activeModel}
              onSelect={(providerId, model) => {
                if (providerId !== activeProviderId) setActiveProvider(providerId);
                setActiveModel(model);
              }}
            />
          )}
          <button
            onClick={() => newConversation()}
            className="flex h-7 w-7 items-center justify-center rounded-md text-foreground/50 transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
            title="新建 Agent 任务"
            aria-label="新建 Agent 任务"
          >
            <Plus size={15} strokeWidth={1.8} />
          </button>
          <button
            onClick={handleNewWorktreeSession}
            className="flex h-7 w-7 items-center justify-center rounded-md text-foreground/50 transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
            title="新建隔离工作树任务"
            aria-label="新建隔离工作树任务"
          >
            <GitBranch size={15} strokeWidth={1.7} />
          </button>
        </div>
      </div>

      {(conversations.length > 1 || !!activeWorktree) && (
        <TaskSessionTabs
          conversations={conversations}
          activeId={activeConversationId}
          onSelect={setActiveConversation}
          onDelete={deleteConversation}
          onRename={renameConversation}
          workspaceRoot={rootPath}
        />
      )}

      {(isStreaming || multiRoleRunning || toolExecutions.length > 0 || !!pendingApproval) && (
        <AgentRunBar
          isStreaming={isStreaming || multiRoleRunning}
          awaitingApproval={!!pendingApproval}
          toolCount={toolExecutions.length}
          runningCount={toolExecutions.filter((e) => e.status === 'running').length}
          tokens={turnTokens}
        />
      )}

      {currentDebate && (
        <div className="border-b border-border bg-surface-1 px-6 py-2">
          <div className="mx-auto flex max-w-[760px] items-center gap-2 text-[11px] text-foreground/55">
            <span className="font-semibold text-foreground">多角色流程</span>
            {(() => {
              const active = currentDebate.stages.find((s) => s.status === 'running');
              const lastDone = [...currentDebate.stages].reverse().find((s) => s.status === 'done');
              const label = active
                ? `进行中：${DEBATE_STAGE_LABEL[active.name] || active.name}`
                : lastDone
                ? `已完成：${DEBATE_STAGE_LABEL[lastDone.name] || lastDone.name}`
                : '准备中';
              return <span>{label}</span>;
            })()}
            <span className="text-foreground/35">· 阶段详情见右侧运行详情</span>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-5 selectable">
        <div className="mx-auto w-full max-w-[760px]">
        <AgentPlan steps={plan} />
        {!hasRuntimeRows && (
          <div className="py-16 text-center">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-surface-2 text-lg">⌘</div>
            <div className="text-[17px] font-semibold text-foreground">把任务交给 Agent</div>
            <div className="mx-auto mt-2 max-w-[420px] text-[13px] leading-relaxed text-foreground/45">
              {readiness.canRunAgent
                ? '在下方描述你想完成的事。这里会保留你和 Agent 的完整对话、执行过程和结果。'
                : '等待模型服务就绪后，就可以让 Agent 读写文件、运行命令并完成任务。'}
            </div>
          </div>
        )}
        {messages.map((msg) => (
          <TaskMessage key={msg.id} message={msg} />
        ))}

        {isStreaming && streamContent && (
          <div className="grid grid-cols-[48px_minmax(0,1fr)] gap-4 py-4 text-sm">
            <div className="font-mono text-[9.5px] leading-[1.7] text-foreground/35">RUN</div>
            <div className="min-w-0 whitespace-pre-wrap leading-relaxed text-foreground/90">{streamContent}</div>
          </div>
        )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      <PendingApprovalView
        pendingApproval={pendingApproval}
        onAccept={handleApprove}
        onReject={handleReject}
      />

      {/* composer — floating card */}
      <div className="flex-none bg-background px-6 pb-5 pt-3">
        <div className="mx-auto max-w-[760px]">
          {worktreeNotice && (
            <div className={`mb-2 rounded-lg px-3 py-1.5 text-11 ${worktreeNotice.tone === 'success' ? 'text-diffadd' : 'text-diffdel'}`}>
              {worktreeNotice.text}
            </div>
          )}
          {!activeProviderId || !activeModel ? (
            <div className="rounded-[14px] border border-border-strong bg-background p-3 shadow-card">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">模型服务未就绪</span>
                <button onClick={() => onReadinessAction('openSettings')} className="btn-codex h-7 text-xs">
                  配置模型
                </button>
              </div>
              <div className="overflow-hidden rounded-lg border border-border">
                {readiness.items.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => onReadinessAction(item.actionId)}
                    className="grid min-h-8 w-full grid-cols-[18px_minmax(0,1fr)_52px] items-center gap-2 border-b border-border py-1 pl-2 pr-3 text-left text-11 text-muted-foreground transition-colors last:border-b-0 hover:bg-foreground/[0.04]"
                  >
                    <ReadinessIcon status={item.status} />
                    <span className="min-w-0 truncate">{item.label}</span>
                    <span className="text-right font-mono text-10 text-muted-foreground">{STATUS_LABEL[item.status]}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-[10.5px] text-foreground/40">
                  {activeFilePath ? `@${activeFilePath.split('/').slice(-1)[0]}` : '描述任务，Agent 会自己查看代码并执行'}
                </span>
              </div>
              <div className="rounded-[14px] border border-border-strong bg-background shadow-float focus-within:border-foreground/25">
                {pendingImages.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 px-3 pt-3">
                    {pendingImages.map((img, i) => (
                      <div key={i} className="group relative">
                        <img src={img} alt="attachment" className="h-12 w-12 rounded-md border border-border object-cover" />
                        <button
                          onClick={() => setPendingImages((prev) => prev.filter((_, j) => j !== i))}
                          className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full text-10 leading-none text-white opacity-0 transition-opacity group-hover:opacity-100"
                          style={{ background: '#c1374a' }}
                          title="移除附件"
                          aria-label="移除附件"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  placeholder="告诉 Agent 你想完成什么…  (Shift+Enter 换行)"
                  aria-label="告诉 Agent 你想完成什么"
                  className="max-h-[160px] w-full resize-none bg-transparent px-4 pb-1 pt-3.5 text-sm leading-relaxed text-foreground outline-none"
                  style={{ minHeight: '52px' }}
                  disabled={isStreaming}
                />
                <div className="flex items-center gap-2 px-3 pb-2.5 pr-2.5">
                  <label className="flex h-7 w-7 flex-none cursor-pointer items-center justify-center rounded-md text-foreground/45 transition-colors hover:bg-foreground/[0.05] hover:text-foreground" title="附加图片" aria-label="附加图片">
                    <Paperclip size={17} strokeWidth={1.7} />
                    <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { if (e.target.files) addImageFiles(e.target.files); e.target.value = ''; }} />
                  </label>
                  <div className="inline-flex rounded-lg p-0.5" style={{ background: '#f1f1ef' }}>
                    {(['readonly', 'auto', 'full'] as ApprovalMode[]).map((m) => {
                      const meta = APPROVAL_MODE_META[m];
                      const active = approvalMode === m;
                      const danger = m === 'full';
                      return (
                        <button
                          key={m}
                          onClick={() => changeApprovalMode(m)}
                          title={meta.hint}
                          className="rounded-md px-2.5 py-1 text-[11px] font-semibold transition-all"
                          style={
                            active
                              ? danger
                                ? { color: '#9a4a00', background: '#fdeccd', boxShadow: '0 1px 2px rgba(154,74,0,.22)' }
                                : { color: '#0d0d0d', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.12)' }
                              : { color: 'rgba(13,13,13,.5)' }
                          }
                        >
                          {meta.label}
                        </button>
                      );
                    })}
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold text-foreground/60" style={{ background: '#f1f1ef' }}>
                    安全：{APPROVAL_MODE_META[approvalMode].label}
                  </span>
                  <span className="inline-flex items-center rounded-lg px-2.5 py-1 text-[11px] font-semibold text-foreground/50" style={{ background: '#f1f1ef' }}>
                    当前任务设置
                  </span>
                  <button
                    type="button"
                    onClick={() => setMultiRoleMode((v) => !v)}
                    className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-all"
                    style={multiRoleMode ? { color: '#0d0d0d', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.12)' } : { color: 'rgba(13,13,13,.5)', background: '#f1f1ef' }}
                    title="按解析、方案、异议、综合、执行分阶段运行"
                  >
                    <Sparkles size={12} strokeWidth={1.8} />
                    多角色
                  </button>
                  {isStreaming ? (
                    <button onClick={handleAbort} className="ml-auto flex h-8 w-8 flex-none items-center justify-center rounded-full text-white" style={{ background: '#c1374a' }} title="停止" aria-label="停止任务">
                      <Square size={14} strokeWidth={2} />
                    </button>
                  ) : (
                    <button
                      onClick={handleRunTask}
                      disabled={!input.trim() && pendingImages.length === 0}
                      className="ml-auto flex h-8 w-8 flex-none items-center justify-center rounded-full text-white transition-colors hover:bg-[#262626] disabled:opacity-30"
                      style={{ background: '#0d0d0d' }}
                      title={multiRoleMode ? '启动多角色任务' : '运行任务'}
                      aria-label={multiRoleMode ? '启动多角色任务' : '运行任务'}
                    >
                      <ArrowUp size={16} strokeWidth={2} />
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      </div>

      {showInspector && (
        <aside className="w-[360px] flex-none border-l border-border">
          <div className="flex h-full flex-col">
            <button
              type="button"
              onClick={() => setInspectorDismissed(true)}
              className="self-end px-3 py-2 text-11 text-foreground/45 hover:text-foreground"
              aria-label="关闭运行详情"
              title="关闭运行详情"
            >
              关闭
            </button>
            <div className="min-h-0 flex-1">
              <RunInspector
                toolExecutions={toolExecutions}
                checkpoints={checkpoints}
                artifacts={artifacts}
                multiRoleResult={multiRoleResult}
                multiRoleRunning={multiRoleRunning}
                currentDebate={currentDebate}
                onRevert={revertCheckpoint}
                onOpen={openFile}
              />
            </div>
          </div>
        </aside>
      )}
    </div>
  );
}
