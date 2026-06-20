import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatMessage as ChatMessageType } from '@shared/types';
import { Check, Copy } from 'lucide-react';

interface Props {
  message: ChatMessageType;
}

function CodeBlock({ children, language }: { children: string; language?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="group relative my-3">
      <div className="flex items-center justify-between border-b border-editor-border bg-editor-bg px-3 py-1.5">
        <span className="font-mono text-10 uppercase tracking-wide text-muted-foreground">
          {language || 'code'}
        </span>
        <button
          onClick={handleCopy}
          className="flex h-6 items-center gap-1.5 px-2 text-10 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
          title={copied ? '已复制' : '复制代码'}
        >
          {copied ? (
            <>
              <Check size={12} strokeWidth={2} />
              <span>已复制</span>
            </>
          ) : (
            <>
              <Copy size={12} strokeWidth={1.5} />
              <span>复制</span>
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto border border-editor-border bg-editor-bg px-3 py-3 text-xs leading-relaxed">
        <code className={language ? `language-${language}` : ''}>
          {children.replace(/\n$/, '')}
        </code>
      </pre>
    </div>
  );
}

export default function TaskMessage({ message }: Props) {
  if (message.role === 'tool') return null;

  const isUser = message.role === 'user';
  const roleLabel = isUser ? 'TASK' : 'RESULT';
  const timeLabel = new Date(message.timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="grid grid-cols-[64px_minmax(0,1fr)] border-b border-editor-border text-sm">
      <div className="border-r border-editor-border bg-editor-bg px-2 py-3 font-mono text-10 leading-5 text-muted-foreground">
        <div className={isUser ? 'text-editor-accent' : 'text-muted-foreground'}>{roleLabel}</div>
        <div>{timeLabel}</div>
      </div>

      <div className={`min-w-0 px-4 py-3 ${isUser ? 'bg-editor-bg' : 'bg-editor-sidebar'}`}>
        {message.images?.length ? (
          <div className="mb-3 flex flex-wrap gap-2">
            {message.images.map((img, i) => (
              <img
                key={i}
                src={img}
                alt="attachment"
                className="max-h-40 border border-editor-border"
              />
            ))}
          </div>
        ) : null}

        {isUser ? (
          <p className="whitespace-pre-wrap leading-relaxed text-editor-text">{message.content}</p>
        ) : (
          <div className="max-w-none text-foreground prose-sm">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                p({ children }) {
                  return <p className="mb-3 leading-relaxed last:mb-0">{children}</p>;
                },
                ul({ children }) {
                  return <ul className="my-3 list-disc space-y-1 pl-5">{children}</ul>;
                },
                ol({ children }) {
                  return <ol className="my-3 list-decimal space-y-1 pl-5">{children}</ol>;
                },
                li({ children }) {
                  return <li className="leading-relaxed">{children}</li>;
                },
                a({ children, href }) {
                  return (
                    <a href={href} className="text-editor-accent underline-offset-2 hover:underline">
                      {children}
                    </a>
                  );
                },
                code(props) {
                  const { className, children, ...rest } = props;
                  const match = /language-(\w+)/.exec(className || '');
                  if (match) {
                    return <CodeBlock language={match[1]}>{String(children)}</CodeBlock>;
                  }
                  return (
                    <code
                      className="border border-editor-border bg-editor-bg px-1.5 py-0.5 font-mono text-xs text-foreground"
                      {...rest}
                    >
                      {children}
                    </code>
                  );
                },
              }}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        )}

        {message.toolCalls?.length ? (
          <div className="mt-3 space-y-1 border-t border-editor-border pt-2">
            {message.toolCalls.map((tc) => (
              <div key={tc.id} className="flex min-h-5 items-center gap-2 text-11 text-muted-foreground">
                <span className="w-9 font-mono text-10 text-muted-foreground">STEP</span>
                <span className="truncate font-mono text-editor-accent">{tc.name}</span>
                <span className="min-w-0 truncate text-muted-foreground">
                  {Object.keys(tc.arguments).join(', ')}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
