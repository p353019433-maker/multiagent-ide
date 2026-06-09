import React, { useState, useRef, useEffect, useCallback } from 'react';
import { v4 as uuid } from 'uuid';
import { useTaskWorkspace } from '../../context/TaskContext';
import { useWorkspace } from '../../context/WorkspaceContext';
import { useEditor } from '../../context/EditorContext';
import TaskMessage from './TaskMessage';
import ToolExecutionRow from './ToolExecutionRow';
import type { ChatMessage as ChatMessageType } from '@shared/types';
import { TASK_SYSTEM_PROMPT } from '@shared/tools';
import { setInlineCompletionSource, updateInlineCompletionConfig } from '../editor/inlineCompletion';
import { resolveWorkspacePath } from '../../task-engine/taskUtils';
import { useApproval } from '../../task-engine/useApproval';
import { useTaskEngine } from '../../task-engine/useTaskEngine';
import TaskSessionTabs from './TaskSessionTabs';
import { GitBranch, Paperclip, Play, Plus, Square } from 'lucide-react';
import {
  ApprovalModeStrip,
  ArtifactList,
  CheckpointList,
  PendingApprovalView,
} from './TaskPanelSections';

export default function TaskPanel() {
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
  } = useTaskWorkspace();
  const { rootPath } = useWorkspace();
  const { activeFilePath, openFiles, openFile, reloadFileFromDisk } = useEditor();

  const [input, setInput] = useState('');
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [worktreeNotice, setWorktreeNotice] = useState<{
    tone: 'success' | 'error';
    text: string;
  } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Project rules (AGENTS.md / .cursorrules), appended to the system prompt.
  const projectRules = useRef<{ file: string; content: string } | null>(null);

  // Approval gate (mode + pending-approval state + decision logic).
  const { approvalMode, changeApprovalMode, pendingApproval, gateAction, handleApprove, handleReject } =
    useApproval();

  // Active conversation + its effective workspace root (worktree path when the
  // session runs in an isolated worktree, else the open folder). Declared before
  // the task engine so it can be passed in.
  const activeConversation = conversations.find((c) => c.id === activeConversationId);
  const effectiveRootPath = activeConversation?.worktree?.path ?? rootPath;
  const messages = activeConversation?.messages || [];
  const activeProvider = providers.find((p) => p.id === activeProviderId);
  const activeWorktree = activeConversation?.worktree;

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

  // Build the effective system prompt: base task prompt + project rules.
  const buildSystemPrompt = (): string => {
    if (projectRules.current?.content) {
      return (
        TASK_SYSTEM_PROMPT +
        `\n\n## Project Rules (from ${projectRules.current.file})\n` +
        'The user has defined project-specific rules. Follow them strictly:\n\n' +
        projectRules.current.content
      );
    }
    return TASK_SYSTEM_PROMPT;
  };

  // Task engine: the multi-turn loop, tool execution, checkpoints, streaming.
  const { isStreaming, streamContent, toolExecutions, checkpoints, artifacts, runTurn, abort, revertCheckpoint } =
    useTaskEngine({
      activeProviderId,
      activeModel,
      rootPath: effectiveRootPath,
      addMessage,
      buildSystemPrompt,
      gateAction,
      onFileChanged: reloadFileFromDisk,
    });
  const handleAbort = abort;
  const hasRuntimeRows = messages.length > 0 || toolExecutions.length > 0 || isStreaming;

  const resolvePath = (p: string): string => resolveWorkspacePath(effectiveRootPath, p);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamContent, toolExecutions]);

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
    setInput('');
    setPendingImages([]);

    const apiMessages: ChatMessageType[] = [
      ...messages,
      { ...userMsg, content: contextPrefix + userMsg.content, images: turnImages.length ? turnImages : undefined },
    ];

    await runTurn(convId, apiMessages, turnLabel);
  }, [input, activeProviderId, activeModel, activeConversationId, messages, activeFilePath, openFiles, pendingImages, effectiveRootPath]);

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
      const wtPath = `${parentDir}_wt/${branchName}`;

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
    <div className="flex h-full flex-col bg-editor-sidebar border-l border-editor-border">
      <div className="flex h-8 flex-shrink-0 items-center justify-between gap-2 border-b border-editor-border px-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            任务工作台
          </span>
          <span className="font-mono text-[10px] text-gray-600">
            {messages.length} 记录
          </span>
          {activeWorktree && (
            <span
              className="min-w-0 truncate font-mono text-[10px] text-yellow-500"
              title={activeWorktree.path}
            >
              WT {activeWorktree.branch}
            </span>
          )}
        </div>
        <div className="flex min-w-0 items-center gap-1">
          {providers.length > 0 && (
            <>
              <select
                className="h-6 max-w-[110px] border border-editor-border bg-editor-active px-1.5 text-[11px] text-editor-text outline-none"
                value={activeProviderId || ''}
                onChange={(e) => setActiveProvider(e.target.value)}
                title="模型服务"
                aria-label="模型服务"
              >
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              {activeProvider && (
                <select
                  className="h-6 max-w-[140px] border border-editor-border bg-editor-active px-1.5 text-[11px] text-editor-text outline-none"
                  value={activeModel || ''}
                  onChange={(e) => setActiveModel(e.target.value)}
                  title="模型"
                  aria-label="模型"
                >
                  {activeProvider.models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              )}
            </>
          )}
          <button
            onClick={() => newConversation()}
            className="flex h-6 w-6 items-center justify-center text-gray-400 hover:bg-editor-active hover:text-white"
            title="新建任务"
            aria-label="新建任务"
          >
            <Plus size={14} strokeWidth={1.8} />
          </button>
          <button
            onClick={handleNewWorktreeSession}
            className="flex h-6 w-6 items-center justify-center text-gray-400 hover:bg-editor-active hover:text-white"
            title="新建隔离工作树任务"
            aria-label="新建隔离工作树任务"
          >
            <GitBranch size={14} strokeWidth={1.8} />
          </button>
        </div>
      </div>

      {conversations.length > 1 && (
        <TaskSessionTabs
          conversations={conversations}
          activeId={activeConversationId}
          onSelect={setActiveConversation}
          onDelete={deleteConversation}
          onRename={renameConversation}
          workspaceRoot={rootPath}
        />
      )}

      <ApprovalModeStrip mode={approvalMode} onChange={changeApprovalMode} />

      <div className="flex-1 overflow-y-auto selectable">
        {!hasRuntimeRows && (
          <div className="grid grid-cols-[64px_minmax(0,1fr)] border-b border-editor-border text-sm">
            <div className="border-r border-editor-border bg-editor-bg px-2 py-2 font-mono text-[10px] leading-5 text-gray-600">
              READY
            </div>
            <div className="bg-editor-sidebar px-3 py-2 text-xs text-gray-500">
              无活动任务
            </div>
          </div>
        )}
        {messages.map((msg) => (
          <TaskMessage key={msg.id} message={msg} />
        ))}

        {toolExecutions.length > 0 && (
          <div>
            {toolExecutions.map((exec) => (
              <ToolExecutionRow key={exec.id} execution={exec} />
            ))}
          </div>
        )}

        {isStreaming && streamContent && (
          <div className="grid grid-cols-[64px_minmax(0,1fr)] border-b border-editor-border text-sm">
            <div className="border-r border-editor-border bg-editor-bg px-2 py-2 font-mono text-[10px] leading-5 text-editor-accent">
              RUN
            </div>
            <div className="whitespace-pre-wrap bg-editor-sidebar px-3 py-2 text-editor-text">
              {streamContent}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <CheckpointList checkpoints={checkpoints} onRevert={revertCheckpoint} />
      <ArtifactList artifacts={artifacts} onOpen={openFile} />
      <PendingApprovalView
        pendingApproval={pendingApproval}
        onAccept={handleApprove}
        onReject={handleReject}
      />

      <div className="border-t border-editor-border bg-editor-bg">
        <div className="flex min-h-7 items-center justify-between border-b border-editor-border px-3">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            运行请求
          </span>
          {pendingImages.length > 0 && (
            <span className="font-mono text-[10px] text-gray-600">
              {pendingImages.length} IMG
            </span>
          )}
        </div>
        {worktreeNotice && (
          <div
            className={`border-b px-3 py-1.5 text-xs ${
              worktreeNotice.tone === 'success'
                ? 'border-emerald-800/70 text-emerald-300'
                : 'border-red-900/80 text-red-300'
            }`}
          >
            {worktreeNotice.text}
          </div>
        )}
        {!activeProviderId ? (
          <div className="px-3 py-2 text-xs text-gray-500">
            未配置模型服务
          </div>
        ) : (
          <div className="px-3 py-2">
            {pendingImages.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5 border-b border-editor-border pb-2">
                {pendingImages.map((img, i) => (
                  <div key={i} className="relative group">
                    <img
                      src={img}
                      alt="attachment"
                      className="h-12 w-12 object-cover border border-editor-border"
                    />
                    <button
                      onClick={() => setPendingImages((prev) => prev.filter((_, j) => j !== i))}
                      className="absolute -right-px -top-px h-4 w-4 bg-red-600 text-[10px] leading-none text-white opacity-0 group-hover:opacity-100"
                      title="移除附件"
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
              placeholder="任务说明或 @文件引用"
              className="h-20 w-full resize-none border border-editor-border bg-editor-sidebar px-2 py-2 text-sm text-editor-text outline-none hover:bg-editor-active focus:border-editor-accent"
              disabled={isStreaming}
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <label
                className="flex h-7 w-8 cursor-pointer items-center justify-center text-gray-400 hover:bg-editor-active hover:text-white"
                title="附加图片"
                aria-label="附加图片"
              >
                <Paperclip size={14} strokeWidth={1.8} />
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
                  className="flex h-7 w-8 items-center justify-center bg-red-600 text-white hover:bg-red-700"
                  title="停止"
                  aria-label="停止任务"
                >
                  <Square size={13} strokeWidth={1.8} />
                </button>
              ) : (
                <button
                  onClick={handleRunTask}
                  disabled={!input.trim() && pendingImages.length === 0}
                  className="flex h-7 w-8 items-center justify-center bg-editor-accent text-white hover:opacity-90 disabled:opacity-40"
                  title="运行任务"
                  aria-label="运行任务"
                >
                  <Play size={13} strokeWidth={1.8} />
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
