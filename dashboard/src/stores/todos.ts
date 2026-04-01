// dashboard/src/stores/todos.ts
import { create } from 'zustand';
import type { TodoItem, TodoStatus } from '@/lib/types';

interface TodosState {
  items: TodoItem[];
  addTodo: (text: string) => void;
  updateStatus: (id: string, status: TodoStatus) => void;
  removeTodo: (id: string) => void;
  reorderTodo: (id: string, direction: 'up' | 'down') => void;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function loadFromStorage(): TodoItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem('tentaclaw-todos');
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveToStorage(items: TodoItem[]) {
  localStorage.setItem('tentaclaw-todos', JSON.stringify(items));
}

export const useTodosStore = create<TodosState>((set, get) => ({
  items: loadFromStorage(),

  addTodo: (text) => {
    const item: TodoItem = {
      id: generateId(),
      text,
      status: 'pending',
      createdAt: Date.now(),
    };
    const updated = [...get().items, item];
    saveToStorage(updated);
    set({ items: updated });
  },

  updateStatus: (id, status) => {
    const updated = get().items.map((t) =>
      t.id === id
        ? { ...t, status, completedAt: status === 'completed' ? Date.now() : undefined }
        : t,
    );
    saveToStorage(updated);
    set({ items: updated });
  },

  removeTodo: (id) => {
    const updated = get().items.filter((t) => t.id !== id);
    saveToStorage(updated);
    set({ items: updated });
  },

  reorderTodo: (id, direction) => {
    const items = [...get().items];
    const idx = items.findIndex((t) => t.id === id);
    if (idx === -1) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= items.length) return;
    [items[idx], items[swapIdx]] = [items[swapIdx], items[idx]];
    saveToStorage(items);
    set({ items });
  },
}));
