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

/** Inline unified-diff block: per-line +add (green) / −del (red) tinting. */
function DiffBlock({ children }: { children: string }) {
  const lines = children.replace(/\n$/, '').split('\n');
  return (
    <pre className="my-3 overflow-x-auto rounded-lg border border-editor-border font-mono text-xs leading-relaxed">
      {lines.map((ln, i) => {
        const add = ln.startsWith('+') && !ln.startsWith('+++');
        const del = ln.startsWith('-') && !ln.startsWith('---');
        const style = add
          ? { background: '#eaf6e3', color: '#1f6b27' }
          : del
            ? { background: '#fdeef0', color: '#9a2533' }
            : { color: 'rgba(13,13,13,.7)' };
        return (
          <div key={i} className="px-3" style={style}>
            {ln || ' '}
          </div>
        );
      })}
    </pre>
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
    <div className="grid grid-cols-[48px_minmax(0,1fr)] gap-4 border-b border-border/50 py-4 text-sm">
      <div className="font-mono text-[9.5px] leading-[1.7]">
        <div style={{ color: isUser ? '#3f8a2e' : 'rgba(13,13,13,.35)', fontWeight: isUser ? 600 : 400 }}>{roleLabel}</div>
        <div className="text-foreground/35">{timeLabel}</div>
      </div>

      <div className="min-w-0">
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
                    if (match[1] === 'diff') return <DiffBlock>{String(children)}</DiffBlock>;
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
