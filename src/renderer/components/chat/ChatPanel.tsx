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

  const [pendingApproval, setPendingApproval] = useState<{
    toolCallId: string;
    filePath: string;
    action: 'write' | 'edit';
    before: string;
    after: string;
    resolve: (approved: boolean) => void;
  } | null>(null);

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
      case 'edit_file': {
        const filePath = resolvePath(args.path as string);
        const content = await window.api.fs.readFile(filePath);
        const oldStr = args.oldString as string;
        const newStr = args.newString as string;
        const occurrences = content.split(oldStr).length - 1;
        if (occurrences === 0) {
          throw new Error('文件中未找到 oldString');
        }
        if (occurrences > 1) {
          throw new Error(`oldString 在文件中出现 ${occurrences} 次，不唯一。请添加更多上下文以消除歧义。`);
        }
        const updated = content.replace(oldStr, newStr);
        const approved = await requestApproval(tc.id, filePath, 'edit', content, updated);
        if (!approved) return '文件编辑被用户拒绝';
        await window.api.fs.writeFile(filePath, updated);
        return `已编辑文件：${args.path}`;
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
      case 'run_command': {
        const cwd = rootPath || '/';
        const result = await window.api.terminal.runCommand(cwd, args.command as string);
        const output = (result.stdout + result.stderr).slice(0, 5000);
        return `退出码：${result.exitCode}\n${output}`;
      }
      default:
        throw new Error(`未知工具：${tc.name}`);
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
      <div className="flex items-center justify-between px-3 py-2 border-b border-editor-border">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
          AI 对话
        </span>
        <button
          onClick={() => newConversation()}
          className="text-xs px-1.5 py-0.5 rounded hover:bg-editor-active text-gray-400 hover:text-white"
          title="新建对话"
        >
          ＋
        </button>
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

      {pendingApproval && (
        <div className="px-3 py-2 border-t border-editor-border bg-yellow-900/20">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-yellow-400">
              ⚠️ {pendingApproval.action === 'write' ? '写入' : '编辑'}文件：{pendingApproval.filePath.split('/').pop()}
            </span>
          </div>
          <div className="bg-black/30 rounded p-2 mb-2 max-h-32 overflow-y-auto">
            <pre className="text-[11px] text-gray-300 whitespace-pre-wrap">
              {pendingApproval.action === 'edit'
                ? `--- 修改前\n+++ 修改后\n\n${pendingApproval.after.slice(0, 500)}`
                : pendingApproval.after.slice(0, 500)}
              {pendingApproval.after.length > 500 && '\n... （已截断）'}
            </pre>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleApprove}
              className="px-3 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700"
            >
              ✓ 批准
            </button>
            <button
              onClick={handleReject}
              className="px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700"
            >
              ✕ 拒绝
            </button>
          </div>
        </div>
      )}

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