// ─── TentaCLAW Dashboard — Chat Interface ───────────────────────────────────

import React, { useState, useRef, useEffect } from 'react';
import { useStore } from '../store';
import { Badge } from '../components/ui';
import {
  Send, Plus, ChevronDown, Copy, RotateCcw,
  Sparkles, Bot, User, Settings, Loader2,
} from 'lucide-react';
import { OctopusLogo } from '../components/ui';
import type { ChatMessage } from '../types';

// Simulated streaming response
async function* simulateStream(prompt: string): AsyncGenerator<string> {
  const responses: Record<string, string> = {
    default: `I'm running on the TentaCLAW cluster. Here's what I can help with:\n\n**Cluster Management**\n- Check node status and health\n- Deploy or swap models on GPUs\n- Monitor VRAM, power, and temperatures\n\n**Code Assistance**\n- Write and debug code\n- Explain complex algorithms\n- Generate tests and documentation\n\n**General AI Tasks**\n- Research and summarization\n- Creative writing and brainstorming\n- Data analysis and visualization\n\nWhat would you like to work on?`,
  };

  const text = responses.default;
  const words = text.split(' ');
  for (let i = 0; i < words.length; i++) {
    yield words[i] + (i < words.length - 1 ? ' ' : '');
    await new Promise(r => setTimeout(r, 20 + Math.random() * 40));
  }
}

export function ChatPage() {
  const { models, sessions, activeSession, addMessage, setActiveModel } = useStore();
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [showModelSelect, setShowModelSelect] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const session = sessions.find(s => s.id === activeSession);
  const loadedModels = models.filter(m => m.status === 'loaded');
  const currentModel = models.find(m => m.id === session?.model);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [session?.messages]);

  const handleSend = async () => {
    if (!input.trim() || streaming) return;

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: input.trim(),
      timestamp: Date.now(),
    };
    addMessage(userMsg);
    setInput('');

    // Simulate assistant response via streaming
    setStreaming(true);
    const assistantId = `msg-${Date.now() + 1}`;
    let fullContent = '';
    const startTime = Date.now();

    for await (const chunk of simulateStream(input)) {
      fullContent += chunk;
      // We update the store with the full content each time
      // In a real implementation, this would be optimized
    }

    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: fullContent,
      timestamp: Date.now(),
      model: session?.model,
      tokensUsed: Math.round(fullContent.length / 4),
      latencyMs: Date.now() - startTime,
      nodeId: 'octopod-1',
    };
    addMessage(assistantMsg);
    setStreaming(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] animate-fade-in">
      {/* Chat Header */}
      <div className="flex items-center justify-between pb-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center text-accent">
            <Sparkles size={18} />
          </div>
          <div>
            <h2 className="text-sm font-semibold">Fleet Chat</h2>
            <div className="text-xs text-text-muted">Talk to your AI cluster</div>
          </div>
        </div>

        {/* Model Selector */}
        <div className="relative">
          <button
            onClick={() => setShowModelSelect(!showModelSelect)}
            className="flex items-center gap-2 px-3 py-1.5 bg-bg-card border border-border rounded-lg text-xs hover:border-border-focus transition-colors"
          >
            <span className="w-2 h-2 rounded-full bg-success" />
            <span className="text-text-primary font-medium">{currentModel?.name || session?.model}</span>
            <ChevronDown size={12} className="text-text-muted" />
          </button>
          {showModelSelect && (
            <div className="absolute right-0 top-full mt-1 w-64 bg-bg-card border border-border rounded-xl shadow-xl z-50 overflow-hidden animate-slide-in">
              {loadedModels.map(m => (
                <button
                  key={m.id}
                  onClick={() => { setActiveModel(m.id); setShowModelSelect(false); }}
                  className={`w-full text-left px-4 py-2.5 text-sm hover:bg-bg-card-hover transition-colors flex items-center justify-between ${m.id === session?.model ? 'bg-accent/5 text-accent' : 'text-text-primary'}`}
                >
                  <div>
                    <div className="font-medium text-xs">{m.name}</div>
                    <div className="text-[10px] text-text-muted">{m.parameters} · {m.quantization}</div>
                  </div>
                  {m.id === session?.model && <span className="text-accent">✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto py-4 space-y-4">
        {(!session?.messages || session.messages.length === 0) && !streaming && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <OctopusLogo size={64} className="mb-4" />
            <h3 className="text-lg font-semibold gradient-text mb-2">TentaCLAW Fleet Chat</h3>
            <p className="text-sm text-text-muted max-w-md">
              Talk to your AI cluster. Messages are routed to the best available model
              across your Octopod fleet.
            </p>
            <div className="flex flex-wrap gap-2 mt-6 max-w-lg">
              {[
                'What models are loaded?',
                'Show cluster status',
                'Help me write a Python script',
                'Explain GPU utilization',
              ].map(prompt => (
                <button
                  key={prompt}
                  onClick={() => setInput(prompt)}
                  className="px-3 py-1.5 bg-bg-card border border-border rounded-lg text-xs text-text-secondary hover:text-text-primary hover:border-accent/30 transition-colors"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {session?.messages.map(msg => (
          <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}>
            {msg.role === 'assistant' && (
              <div className="w-7 h-7 rounded-lg bg-accent/10 flex items-center justify-center text-accent shrink-0 mt-1">
                <Bot size={14} />
              </div>
            )}
            <div className={`max-w-2xl ${msg.role === 'user' ? 'bg-accent/10 border border-accent/20' : 'bg-bg-card border border-border'} rounded-xl px-4 py-3`}>
              <div className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</div>
              {msg.role === 'assistant' && (
                <div className="flex items-center gap-3 mt-2 pt-2 border-t border-border/30">
                  <span className="text-[10px] text-text-muted">{msg.model}</span>
                  {msg.tokensUsed && <span className="text-[10px] text-text-muted">{msg.tokensUsed} tokens</span>}
                  {msg.latencyMs && <span className="text-[10px] text-text-muted">{msg.latencyMs}ms</span>}
                  <button className="ml-auto text-text-muted hover:text-text-primary"><Copy size={12} /></button>
                  <button className="text-text-muted hover:text-text-primary"><RotateCcw size={12} /></button>
                </div>
              )}
            </div>
            {msg.role === 'user' && (
              <div className="w-7 h-7 rounded-lg bg-accent-2/10 flex items-center justify-center text-accent-2 shrink-0 mt-1">
                <User size={14} />
              </div>
            )}
          </div>
        ))}

        {streaming && (
          <div className="flex gap-3">
            <div className="w-7 h-7 rounded-lg bg-accent/10 flex items-center justify-center text-accent shrink-0 mt-1">
              <Loader2 size={14} className="animate-spin" />
            </div>
            <div className="bg-bg-card border border-border rounded-xl px-4 py-3">
              <div className="flex items-center gap-2 text-sm text-text-muted">
                <span className="animate-pulse">Generating response...</span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="pt-4 border-t border-border">
        <div className="flex items-end gap-2">
          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message your cluster..."
              rows={1}
              className="w-full px-4 py-3 bg-bg-card border border-border rounded-xl text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-focus resize-none transition-colors"
              style={{ minHeight: '44px', maxHeight: '200px' }}
            />
          </div>
          <button
            onClick={handleSend}
            disabled={!input.trim() || streaming}
            className={`p-3 rounded-xl transition-colors ${input.trim() && !streaming ? 'bg-accent text-white hover:bg-accent/90' : 'bg-bg-card text-text-muted'}`}
          >
            <Send size={18} />
          </button>
        </div>
        <div className="flex items-center justify-between mt-2 text-[10px] text-text-muted px-1">
          <span>Enter to send · Shift+Enter for new line</span>
          <span>Routed via {currentModel?.name || 'auto'} on {currentModel?.loadedOn?.[0] || 'best available'}</span>
        </div>
      </div>
    </div>
  );
}
