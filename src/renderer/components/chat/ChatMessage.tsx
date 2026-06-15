import React, { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import SyntaxHighlighter from 'react-syntax-highlighter/dist/esm/prism-async-light';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { ChatMessage as ChatMessageType } from '@shared/types';

interface Props {
  message: ChatMessageType;
}

// Cache the components object so ReactMarkdown doesn't see a new `components`
// prop on every render and re-parse the same markdown tree.
const MD_COMPONENTS = {
  code(props: any) {
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
};

const MD_PLUGINS = [remarkGfm];

/**
 * Memoize the message so that a sibling state change (e.g. streamContent,
 * sidebar toggle, agent status) does not re-parse the markdown of every
 * already-rendered message. With 30+ messages in a long agent session this
 * is the difference between "smooth" and "CPU pegged at 30%+".
 */
function ChatMessage({ message }: Props) {
  if (message.role === 'tool') return null;

  const isUser = message.role === 'user';
  // useMemo so a parent re-render with identical content skips the markdown
  // pipeline entirely. ReactMarkdown itself is not memoized; this is the
  // cheapest way to make re-renders cheap without rewriting the library.
  const renderedContent = useMemo(() => {
    if (isUser) return null;
    return (
      <div className="prose prose-invert prose-sm max-w-none">
        <ReactMarkdown remarkPlugins={MD_PLUGINS} components={MD_COMPONENTS}>
          {message.content}
        </ReactMarkdown>
      </div>
    );
    // We intentionally exclude `isUser` from deps — `isUser = message.role === 'user'`
    // is a pure derivation, and including it would defeat the memo for tool calls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message.content, message.role]);

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
            {message.images.map((img) => (
              <img
                key={img}
                src={img}
                alt="attachment"
                className="max-h-40 rounded border border-white/20"
              />
            ))}
          </div>
        ) : null}

        {isUser ? <p className="whitespace-pre-wrap">{message.content}</p> : renderedContent}

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

export default React.memo(ChatMessage);
