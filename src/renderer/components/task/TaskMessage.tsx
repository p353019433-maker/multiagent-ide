import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatMessage as ChatMessageType } from '@shared/types';

interface Props {
  message: ChatMessageType;
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
      <div className="border-r border-editor-border bg-editor-bg px-2 py-2 font-mono text-10 leading-5 text-muted-foreground">
        <div className={isUser ? 'text-editor-accent' : 'text-muted-foreground'}>{roleLabel}</div>
        <div>{timeLabel}</div>
      </div>

      <div className={`min-w-0 px-3 py-2 ${isUser ? 'bg-editor-bg' : 'bg-editor-sidebar'}`}>
        {message.images?.length ? (
          <div className="mb-2 flex flex-wrap gap-1.5">
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
          <p className="whitespace-pre-wrap text-editor-text">{message.content}</p>
        ) : (
          <div className="max-w-none text-foreground">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                p({ children }) {
                  return <p className="mb-2 last:mb-0">{children}</p>;
                },
                ul({ children }) {
                  return <ul className="my-2 list-disc pl-5">{children}</ul>;
                },
                ol({ children }) {
                  return <ol className="my-2 list-decimal pl-5">{children}</ol>;
                },
                li({ children }) {
                  return <li className="my-0.5">{children}</li>;
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
                    return (
                      <pre className="my-2 overflow-x-auto border border-editor-border bg-editor-bg p-2 text-xs">
                        <code className={`language-${match[1]}`}>
                          {String(children).replace(/\n$/, '')}
                        </code>
                      </pre>
                    );
                  }
                  return (
                    <code
                      className="border border-editor-border bg-editor-bg px-1 py-0.5 font-mono text-xs text-foreground"
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
          <div className="mt-2 border-t border-editor-border pt-1">
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
