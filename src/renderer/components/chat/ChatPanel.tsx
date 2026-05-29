import React, { useState, useRef, useEffect, useCallback } from 'react';
import { v4 as uuid } from 'uuid';
import { useAI } from '../../context/AIContext';
import { useWorkspace } from '../../context/WorkspaceContext';
import { useEditor } from '../../context/EditorContext';
import ChatMessage from './ChatMessage';
import AgentToolView from './AgentToolView';
import type { ChatMessage as ChatMessageType, ToolCall, AgentToolExecution } from '@shared/types';
import { BUILTIN_TOOLS, AGENT_SYSTEM_PROMPT } from '@shared/tools';

export default function ChatPanel() {
  const {
    activeProviderId,
    activeModel,
    conversations,
    activeConversationId,
    newConversation,
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

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamContent, toolExecutions]);

  // Handle send
  const handleSend = useCallback(async () => {
    if (!input.trim() || !activeProviderId || !activeModel) return;
    if (isStreaming) return;

    let convId = activeConversationId;
    if (!convId) {
      convId = newConversation();
    }

    // Build context from active file
    let contextPrefix = '';
    if (activeFilePath) {
      const file = openFiles.find((f) => f.path === activeFilePath);
      if (file) {
        contextPrefix = `[Current file: ${activeFilePath}]\n\`\`\`${file.language}\n${file.content.slice(0, 3000)}\n\`\`\`\n\n`;
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

    // Prepare messages for API
    const apiMessages: ChatMessageType[] = [
      ...messages,
      { ...userMsg, content: contextPrefix + userMsg.content },
    ];

    await runAgentLoop(convId, apiMessages);
  }, [input, activeProviderId, activeModel, activeConversationId, messages, activeFilePath, openFiles]);

  // Agent loop: send → get response → if tool_calls, execute tools → send results → repeat
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

        // Add assistant message
        const assistantMsg: ChatMessageType = {
          id: uuid(),
          role: 'assistant',
          content: result.content || '',
          toolCalls: result.toolCalls,
          timestamp: Date.now(),
        };
        addMessage(convId, assistantMsg);
        setStreamContent('');

        // If no tool calls, we're done
        if (!result.toolCalls?.length || result.finishReason !== 'tool_calls') {
          break;
        }

        // Execute tools
        const toolResults = await executeTools(result.toolCalls);

        // Add tool results message
        const toolMsg: ChatMessageType = {
          id: uuid(),
          role: 'tool',
          content: '',
          toolResults,
          timestamp: Date.now(),
        };
        addMessage(convId, toolMsg);

        // Continue loop
        loopMessages = [...loopMessages, assistantMsg, toolMsg];
      } catch (err: any) {
        const errorMsg: ChatMessageType = {
          id: uuid(),
          role: 'assistant',
          content: `❌ Error: ${err.message}`,
          timestamp: Date.now(),
        };
        addMessage(convId, errorMsg);
        break;
      }
    }

    setIsStreaming(false);
  };

  // Execute agent tools
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
        results.push({ toolCallId: tc.id, content: `Error: ${err.message}`, isError: true });
      }
    }

    return results;
  };

  /** Resolve a path relative to workspace root. Prevents path traversal. */
  const resolvePath = (p: string): string => {
    if (!rootPath) throw new Error('No workspace open');
    // If already absolute and within workspace, allow it
    if (p.startsWith(rootPath + '/') || p === rootPath) return p;
    // If absolute but outside workspace, reject
    if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) throw new Error('Access denied: path outside workspace');
    // Relative path: join with rootPath
    // Normalize: remove ../ segments that would escape
    const segments = p.split(/[/\\]/);
    const resolved: string[] = [];
    for (const seg of segments) {
      if (seg === '..') {
        if (resolved.length === 0) throw new Error('Access denied: path traversal detected');
        resolved.pop();
      } else if (seg !== '.' && seg !== '') {
        resolved.push(seg);
      }
    }
    return rootPath + '/' + resolved.join('/');
  };

  /** State for pending file approvals */
  const [pendingApproval, setPendingApproval] = useState<{
    toolCallId: string;
    filePath: string;
    action: 'write' | 'edit';
    before: string;
    after: string;
    resolve: (approved: boolean) => void;
  } | null>(null);

  /** Request user approval for file modifications */
  const requestApproval = (
    toolCallId: string,
    filePath: string,
    action: 'write' | 'edit',
    before: string,
    after: string
  ): Promise<boolean> => {
    return new Promise((resolve) => {
      setPendingApproval({ toolCallId, filePath, action, before, after, resolve });
    });
  };

  const handleApprove = () => {
    pendingApproval?.resolve(true);
    setPendingApproval(null);
  };

  const handleReject = () => {
    pendingApproval?.resolve(false);
    setPendingApproval(null);
  };

  const executeSingleTool = async (tc: ToolCall): Promise<string> => {
    const args = tc.arguments;

    switch (tc.name) {
      case 'read_file': {
        const filePath = resolvePath(args.path as string);
        const content = await window.api.fs.readFile(filePath);
        return content.slice(0, 10000); // cap output
      }
      case 'write_file': {
        const filePath = resolvePath(args.path as string);
        const newContent = args.content as string;
        // Get existing content for diff (empty if new file)
        let existingContent = '';
        try {
          existingContent = await window.api.fs.readFile(filePath);
        } catch {
          // File doesn't exist yet, that's fine
        }
        // Request approval
        const approved = await requestApproval(tc.id, filePath, 'write', existingContent, newContent);
        if (!approved) return 'File write rejected by user';
        await window.api.fs.writeFile(filePath, newContent);
        return `File written: ${args.path}`;
      }
      case 'edit_file': {
        const filePath = resolvePath(args.path as string);
        const content = await window.api.fs.readFile(filePath);
        const oldStr = args.oldString as string;
        const newStr = args.newString as string;
        // Validate: oldString must appear exactly once
        const occurrences = content.split(oldStr).length - 1;
        if (occurrences === 0) {
          throw new Error('oldString not found in file');
        }
        if (occurrences > 1) {
          throw new Error(`oldString found ${occurrences} times — must be unique. Add more context to disambiguate.`);
        }
        const updated = content.replace(oldStr, newStr);
        // Request approval
        const approved = await requestApproval(tc.id, filePath, 'edit', content, updated);
        if (!approved) return 'File edit rejected by user';
        await window.api.fs.writeFile(filePath, updated);
        return `File edited: ${args.path}`;
      }
      case 'list_directory': {
        const dirPath = resolvePath(args.path as string);
        const nodes = await window.api.fs.readDirectory(dirPath);
        return nodes.map((n: any) => `${n.isDirectory ? '📁' : '📄'} ${n.name}`).join('\n');
      }
      case 'search_files': {
        if (!rootPath) throw new Error('No workspace open');
        const results = await window.api.fs.searchFiles(rootPath, args.query as string);
        return results
          .slice(0, 20)
          .map((r: any) => `${r.path}:${r.line} ${r.preview}`)
          .join('\n');
      }
      case 'run_command': {
        const cwd = rootPath || '/';
        const result = await window.api.terminal.runCommand(cwd, args.command as string);
        const output = (result.stdout + result.stderr).slice(0, 5000);
        return `Exit code: ${result.exitCode}\n${output}`;
      }
      default:
        throw new Error(`Unknown tool: ${tc.name}`);
    }
  };

  const handleAbort = () => {
    window.api.ai.abort();
    setIsStreaming(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full bg-editor-sidebar border-l border-editor-border">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-editor-border">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
          Agent Chat
        </span>
        <button
          onClick={() => newConversation()}
          className="text-xs px-1.5 py-0.5 rounded hover:bg-editor-active text-gray-400 hover:text-white"
          title="New conversation"
        >
          ＋
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3 selectable">
        {messages.map((msg) => (
          <ChatMessage key={msg.id} message={msg} />
        ))}

        {/* Tool executions */}
        {toolExecutions.length > 0 && (
          <div className="space-y-1">
            {toolExecutions.map((exec) => (
              <AgentToolView key={exec.id} execution={exec} />
            ))}
          </div>
        )}

        {/* Streaming content */}
        {isStreaming && streamContent && (
          <div className="text-sm text-editor-text whitespace-pre-wrap streaming-cursor">
            {streamContent}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Approval dialog */}
      {pendingApproval && (
        <div className="px-3 py-2 border-t border-editor-border bg-yellow-900/20">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-yellow-400">
              ⚠️ {pendingApproval.action === 'write' ? 'Write' : 'Edit'} file: {pendingApproval.filePath.split('/').pop()}
            </span>
          </div>
          <div className="bg-black/30 rounded p-2 mb-2 max-h-32 overflow-y-auto">
            <pre className="text-[11px] text-gray-300 whitespace-pre-wrap">
              {pendingApproval.action === 'edit'
                ? `--- Before\n+++ After\n\n${pendingApproval.after.slice(0, 500)}`
                : pendingApproval.after.slice(0, 500)}
              {pendingApproval.after.length > 500 && '\n... (truncated)'}
            </pre>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleApprove}
              className="px-3 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700"
            >
              ✓ Approve
            </button>
            <button
              onClick={handleReject}
              className="px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700"
            >
              ✕ Reject
            </button>
          </div>
        </div>
      )}

      {/* Input */}
      <div className="p-3 border-t border-editor-border">
        {!activeProviderId ? (
          <p className="text-xs text-gray-500 text-center">
            Configure an AI provider in Settings to start chatting
          </p>
        ) : (
          <div className="flex gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask the AI agent..."
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
                  Stop
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={!input.trim()}
                  className="px-3 py-1 bg-editor-accent text-white text-xs rounded hover:opacity-90 transition-opacity disabled:opacity-40"
                >
                  Send
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
