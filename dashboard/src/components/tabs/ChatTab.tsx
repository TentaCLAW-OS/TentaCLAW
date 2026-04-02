import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useChatStore } from '@/stores/chat';
import { useClusterStore } from '@/stores/cluster';
import type { ChatMessage } from '@/stores/chat';

function ModelSelector() {
  const nodes = useClusterStore((s) => s.nodes);
  const model = useChatStore((s) => s.model);
  const setModel = useChatStore((s) => s.setModel);

  const models = useMemo(() => {
    const set = new Set<string>();
    for (const node of nodes) {
      const loaded = node.latest_stats?.inference?.loaded_models;
      if (loaded) {
        for (const m of loaded) set.add(m);
      }
    }
    return Array.from(set).sort();
  }, [nodes]);

  // Auto-select the first available model if none is set
  useEffect(() => {
    if (!model && models.length > 0) {
      setModel(models[0]);
    }
  }, [model, models, setModel]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <select
        value={model}
        onChange={(e) => setModel(e.target.value)}
        style={{
          background: 'rgba(0,0,0,0.3)',
          border: '1px solid rgba(0,255,255,0.15)',
          borderRadius: 6,
          color: 'var(--text-primary)',
          fontSize: 11,
          padding: '4px 8px',
          outline: 'none',
          cursor: 'pointer',
        }}
      >
        {models.length === 0 && (
          <option value="">No models loaded</option>
        )}
        {models.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      {model && (
        <span
          style={{
            background: 'rgba(0,255,255,0.1)',
            border: '1px solid rgba(0,255,255,0.2)',
            borderRadius: 9999,
            color: 'rgba(0,255,255,0.85)',
            fontSize: 10,
            padding: '2px 8px',
            whiteSpace: 'nowrap',
          }}
        >
          {model}
        </span>
      )}
    </div>
  );
}

function MessageBubble({ message, streaming }: { message: ChatMessage; streaming: boolean }) {
  const isUser = message.role === 'user';

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        marginBottom: 12,
      }}
    >
      <div
        style={{
          maxWidth: '80%',
          background: isUser
            ? 'rgba(0,255,255,0.06)'
            : 'rgba(140,0,200,0.05)',
          border: isUser
            ? '1px solid rgba(0,255,255,0.1)'
            : '1px solid rgba(140,0,200,0.08)',
          borderRadius: 12,
          ...(isUser
            ? { borderBottomRightRadius: 3 }
            : { borderBottomLeftRadius: 3 }),
          padding: '10px 14px',
        }}
      >
        {!isUser && (
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: 'rgba(140,0,200,0.7)',
              marginBottom: 4,
            }}
          >
            TentaCLAW
          </div>
        )}
        <div
          style={{
            fontSize: 13,
            lineHeight: 1.5,
            color: 'var(--text-primary)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontFamily: 'inherit',
          }}
        >
          {message.content}
          {streaming && !isUser && (
            <span
              style={{
                display: 'inline-block',
                width: 6,
                height: 14,
                background: 'rgba(0,255,255,0.6)',
                marginLeft: 2,
                verticalAlign: 'text-bottom',
                animation: 'blink 1s step-end infinite',
              }}
            />
          )}
        </div>
        {!isUser && !streaming && (message.latencyMs != null || message.tokens != null) && (
          <div
            style={{
              fontSize: 10,
              color: 'var(--text-tertiary, rgba(255,255,255,0.3))',
              marginTop: 6,
              display: 'flex',
              gap: 10,
            }}
          >
            {message.latencyMs != null && <span>{message.latencyMs}ms</span>}
            {message.tokens != null && <span>{message.tokens} tokens</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        gap: 12,
        opacity: 0.6,
      }}
    >
      <span style={{ fontSize: 48 }}>&#x1F419;</span>
      <span
        style={{
          fontSize: 13,
          color: 'var(--text-secondary)',
        }}
      >
        Ask me anything about your cluster
      </span>
    </div>
  );
}

function ChatInput() {
  const [text, setText] = useState('');
  const sendMessage = useChatStore((s) => s.sendMessage);
  const streaming = useChatStore((s) => s.streaming);
  const model = useChatStore((s) => s.model);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || streaming || !model) return;
    sendMessage(trimmed);
    setText('');
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [text, streaming, model, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  // Auto-resize textarea
  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 150) + 'px';
  }, []);

  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        padding: '12px 16px',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(0,0,0,0.15)',
      }}
    >
      <textarea
        ref={textareaRef}
        value={text}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder="Ask TentaCLAW anything..."
        disabled={streaming}
        rows={1}
        style={{
          flex: 1,
          background: 'rgba(0,0,0,0.3)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 8,
          color: 'var(--text-primary)',
          fontSize: 13,
          padding: '10px 12px',
          outline: 'none',
          resize: 'none',
          fontFamily: 'inherit',
          lineHeight: 1.5,
          transition: 'border-color 0.2s',
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = 'rgba(0,255,255,0.3)';
          e.currentTarget.style.boxShadow = '0 0 8px rgba(0,255,255,0.1)';
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)';
          e.currentTarget.style.boxShadow = 'none';
        }}
      />
      <button
        onClick={handleSend}
        disabled={streaming || !text.trim() || !model}
        style={{
          background:
            streaming || !text.trim() || !model
              ? 'rgba(255,255,255,0.05)'
              : 'linear-gradient(135deg, rgba(0,255,255,0.8), rgba(140,0,200,0.8))',
          border: 'none',
          borderRadius: 8,
          color: streaming || !text.trim() || !model ? 'rgba(255,255,255,0.2)' : '#fff',
          fontSize: 16,
          width: 42,
          cursor: streaming || !text.trim() || !model ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          transition: 'all 0.2s',
        }}
        aria-label="Send message"
      >
        &#x2192;
      </button>
    </div>
  );
}

export function ChatTab() {
  const messages = useChatStore((s) => s.messages);
  const streaming = useChatStore((s) => s.streaming);
  const clearMessages = useChatStore((s) => s.clearMessages);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        maxHeight: 'calc(100vh - 60px)',
      }}
    >
      {/* Blink animation for streaming cursor */}
      <style>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>

      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 16px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>&#x1F419;</span>
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--text-primary)',
            }}
          >
            TentaCLAW Chat
          </span>
          {messages.length > 0 && (
            <button
              onClick={clearMessages}
              style={{
                background: 'none',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 4,
                color: 'var(--text-tertiary, rgba(255,255,255,0.3))',
                fontSize: 10,
                padding: '2px 6px',
                cursor: 'pointer',
                marginLeft: 4,
              }}
            >
              Clear
            </button>
          )}
        </div>
        <ModelSelector />
      </div>

      {/* Messages area */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px 16px 8px',
        }}
      >
        {messages.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            {messages.map((msg, i) => (
              <MessageBubble
                key={msg.timestamp + '-' + i}
                message={msg}
                streaming={
                  streaming &&
                  msg.role === 'assistant' &&
                  i === messages.length - 1
                }
              />
            ))}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input area */}
      <ChatInput />
    </div>
  );
}
