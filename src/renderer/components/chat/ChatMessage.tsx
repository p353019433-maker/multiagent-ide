import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import SyntaxHighlighter from 'react-syntax-highlighter/dist/esm/prism-async-light';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { ChatMessage as ChatMessageType } from '@shared/types';

interface Props {
  message: ChatMessageType;
}

export default function ChatMessage({ message }: Props) {
  if (message.role === 'tool') return null;

  const isUser = message.role === 'user';

  return (
    <div className={`fade-in ${isUser ? 'flex justify-end' : ''}`}>
      <div
        className={`max-w-[90%] rounded-lg px-3 py-2 text-sm ${
          isUser
            ? 'bg-editor-accent text-white'
            : 'bg-editor-active text-editor-text'
        }`}
      >
        {message.images?.length ? (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {message.images.map((img, i) => (
              <img
                key={i}
                src={img}
                alt="attachment"
                className="max-h-40 rounded border border-white/20"
              />
            ))}
          </div>
        ) : null}

        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <div className="prose prose-invert prose-sm max-w-none">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                code(props) {
                  const { className, children, ...rest } = props;
                  const match = /language-(\w+)/.exec(className || '');
                  if (match) {
                    return (
                      <SyntaxHighlighter
                        style={vscDarkPlus}
                        language={match[1]}
                        PreTag="div"
                        customStyle={{ fontSize: '12px', borderRadius: '6px', margin: '8px 0' }}
                      >
                        {String(children).replace(/\n$/, '')}
                      </SyntaxHighlighter>
                    );
                  }
                  return (
                    <code className="bg-black/30 px-1 py-0.5 rounded text-xs" {...rest}>
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
          <div className="mt-2 pt-2 border-t border-white/10">
            {message.toolCalls.map((tc) => (
              <div key={tc.id} className="text-xs text-gray-400 flex items-center gap-1">
                <span>🔧</span>
                <span className="font-mono">{tc.name}</span>
                <span className="text-gray-600">
                  ({Object.keys(tc.arguments).join(', ')})
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
