import { create } from 'zustand';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  model?: string;
  latencyMs?: number;
  tokens?: number;
}

interface ChatState {
  messages: ChatMessage[];
  model: string;
  streaming: boolean;
  sendMessage: (content: string) => Promise<void>;
  setModel: (m: string) => void;
  clearMessages: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  model: '',
  streaming: false,

  setModel: (m) => set({ model: m }),

  clearMessages: () => set({ messages: [] }),

  sendMessage: async (content: string) => {
    const state = get();
    if (state.streaming) return;

    const model = state.model;
    if (!model) return;

    const userMessage: ChatMessage = {
      role: 'user',
      content,
      timestamp: Date.now(),
      model,
    };

    // Capture conversation history BEFORE state mutations to avoid stale closure
    const historyForApi = [
      ...state.messages.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content },
    ];

    set({ messages: [...state.messages, userMessage], streaming: true });

    const assistantMessage: ChatMessage = {
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      model,
    };

    set((s) => ({ messages: [...s.messages, assistantMessage] }));

    const startTime = Date.now();
    let accumulated = '';
    let tokenCount = 0;

    try {
      const token = localStorage.getItem('tentaclaw_token');
      const res = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          model,
          stream: true,
          messages: historyForApi,
        }),
      });

      if (!res.ok) {
        throw new Error(`API ${res.status}: ${res.statusText}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        // Keep the last potentially incomplete line in the buffer
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          const data = trimmed.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              accumulated += delta;
              tokenCount++;
              set((s) => {
                const msgs = [...s.messages];
                const last = msgs[msgs.length - 1];
                msgs[msgs.length - 1] = { ...last, content: accumulated };
                return { messages: msgs };
              });
            }
          } catch {
            // Skip malformed JSON chunks
          }
        }
      }

      const latencyMs = Date.now() - startTime;
      set((s) => {
        const msgs = [...s.messages];
        const last = msgs[msgs.length - 1];
        msgs[msgs.length - 1] = {
          ...last,
          content: accumulated,
          latencyMs,
          tokens: tokenCount,
        };
        return { messages: msgs, streaming: false };
      });
    } catch (err) {
      const errorContent =
        err instanceof Error ? err.message : 'Unknown error occurred';

      set((s) => {
        const msgs = [...s.messages];
        const last = msgs[msgs.length - 1];
        msgs[msgs.length - 1] = {
          ...last,
          content: `Error: ${errorContent}`,
        };
        return { messages: msgs, streaming: false };
      });
    }
  },
}));
