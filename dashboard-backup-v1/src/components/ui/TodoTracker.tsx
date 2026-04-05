// dashboard/src/components/ui/TodoTracker.tsx
import { useState, useRef } from 'react';
import { useTodosStore } from '@/stores/todos';
import type { TodoItem, TodoStatus } from '@/lib/types';

const STATUS_ICONS: Record<TodoStatus, string> = {
  pending: '○',
  in_progress: '◐',
  completed: '●',
};

const STATUS_COLORS: Record<TodoStatus, string> = {
  pending: 'var(--text-muted)',
  in_progress: 'var(--yellow)',
  completed: 'var(--green)',
};

const NEXT_STATUS: Record<TodoStatus, TodoStatus> = {
  pending: 'in_progress',
  in_progress: 'completed',
  completed: 'pending',
};

function TodoItemRow({ item }: { item: TodoItem }) {
  const updateStatus = useTodosStore((s) => s.updateStatus);
  const removeTodo = useTodosStore((s) => s.removeTodo);
  const [showDelete, setShowDelete] = useState(false);

  return (
    <div
      className="flex items-start gap-1.5 py-1 group"
      onMouseEnter={() => setShowDelete(true)}
      onMouseLeave={() => setShowDelete(false)}
      onFocus={() => setShowDelete(true)}
      onBlur={() => setShowDelete(false)}
    >
      <button
        onClick={() => updateStatus(item.id, NEXT_STATUS[item.status])}
        className="text-[11px] shrink-0 mt-px cursor-pointer"
        style={{ color: STATUS_COLORS[item.status] }}
        title={`Status: ${item.status} — click to cycle`}
      >
        {STATUS_ICONS[item.status]}
      </button>
      <span
        className="text-[10px] flex-1 leading-tight"
        style={{
          color: item.status === 'completed' ? 'var(--text-dim)' : 'var(--text-secondary)',
          textDecoration: item.status === 'completed' ? 'line-through' : 'none',
        }}
      >
        {item.text}
      </span>
      {showDelete && (
        <button
          onClick={() => removeTodo(item.id)}
          className="text-[9px] shrink-0 cursor-pointer px-1 rounded"
          style={{ color: 'var(--red)', opacity: 0.6 }}
          title="Remove"
        >
          ✕
        </button>
      )}
    </div>
  );
}

export function TodoTracker() {
  const items = useTodosStore((s) => s.items);
  const addTodo = useTodosStore((s) => s.addTodo);
  const [inputValue, setInputValue] = useState('');
  const [showCompleted, setShowCompleted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const pending = items.filter((t) => t.status !== 'completed');
  const completed = items.filter((t) => t.status === 'completed');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = inputValue.trim();
    if (!text) return;
    addTodo(text);
    setInputValue('');
    inputRef.current?.focus();
  }

  return (
    <div className="flex flex-col gap-1">
      {/* Input */}
      <form onSubmit={handleSubmit} className="flex gap-1">
        <input
          ref={inputRef}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Add task..."
          className="flex-1 text-[10px] px-2 py-1 rounded outline-none"
          style={{
            background: 'var(--bg-input)',
            border: '1px solid var(--border)',
            color: 'var(--text-primary)',
          }}
        />
        <button
          type="submit"
          aria-label="Add task"
          className="text-[9px] px-2 py-1 rounded cursor-pointer"
          style={{
            background: 'rgba(0,255,255,0.08)',
            border: '1px solid rgba(0,255,255,0.15)',
            color: 'var(--cyan)',
          }}
        >
          +
        </button>
      </form>

      {/* Pending items */}
      {pending.length === 0 && completed.length === 0 ? (
        <span className="text-[10px] py-2 text-center" style={{ color: 'var(--text-dim)' }}>
          No tasks yet
        </span>
      ) : (
        <div className="flex flex-col">
          {pending.map((item) => (
            <TodoItemRow key={item.id} item={item} />
          ))}
        </div>
      )}

      {/* Completed toggle */}
      {completed.length > 0 && (
        <div>
          <button
            onClick={() => setShowCompleted(!showCompleted)}
            className="text-[9px] cursor-pointer"
            style={{ color: 'var(--text-dim)' }}
          >
            {showCompleted ? '▾' : '▸'} {completed.length} completed
          </button>
          {showCompleted && (
            <div className="flex flex-col mt-0.5">
              {completed.map((item) => (
                <TodoItemRow key={item.id} item={item} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
