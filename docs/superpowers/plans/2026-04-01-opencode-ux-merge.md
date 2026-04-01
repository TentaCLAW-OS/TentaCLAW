# OpenCode UX Feature Merge into TentaCLAW OS — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port OpenCode's best terminal-style UX patterns — the right-side context sidebar, persistent TODO/task tracker, enhanced command palette, keyboard-driven navigation, resizable panels, status bar, and theme system — into TentaCLAW OS's React web dashboard, creating a power-user-grade ops experience.

**Architecture:** The dashboard currently uses a fixed layout: Header → Sidebar(ResourceTree) | VerticalTabs | ContentPane | TaskLog. We will restructure into a 3-column layout with resizable panels, add a persistent right-side context/TODO sidebar (inspired by OpenCode), upgrade the command palette to support leader-key sequences and fuzzy search, add a proper status bar footer, and introduce a theme engine. All new state lives in Zustand stores. All panels are keyboard-navigable.

**Tech Stack:** React 19, Zustand, Tailwind CSS 4.0, Vite 6.0, xterm.js 6.0, lucide-react. No new major dependencies — we build the resize/keybind/theme systems from scratch to keep the bundle lean and match TentaCLAW's zero-dependency CLI philosophy.

---

## Table of Contents

1. [Task 1: Resizable Panel Infrastructure](#task-1-resizable-panel-infrastructure)
2. [Task 2: UI Store Expansion](#task-2-ui-store-expansion)
3. [Task 3: Right-Side Context Sidebar](#task-3-right-side-context-sidebar)
4. [Task 4: TODO / Operations Tracker](#task-4-todo--operations-tracker)
5. [Task 5: Enhanced Status Bar (Footer)](#task-5-enhanced-status-bar-footer)
6. [Task 6: Keyboard Navigation System](#task-6-keyboard-navigation-system)
7. [Task 7: Upgraded Command Palette](#task-7-upgraded-command-palette)
8. [Task 8: Resizable TaskLog Bottom Panel](#task-8-resizable-tasklog-bottom-panel)
9. [Task 9: Theme Engine](#task-9-theme-engine)
10. [Task 10: Layout Composition — Wire Everything Together](#task-10-layout-composition--wire-everything-together)
11. [Task 11: Keyboard Shortcut Help Overlay](#task-11-keyboard-shortcut-help-overlay)
12. [Task 12: Responsive Breakpoints](#task-12-responsive-breakpoints)

---

## File Map

### New Files

| File | Responsibility |
|------|----------------|
| `dashboard/src/components/layout/ResizeHandle.tsx` | Reusable drag handle for panel resizing (horizontal + vertical) |
| `dashboard/src/components/layout/RightSidebar.tsx` | Right-side context panel (session info, TODO list, context files, cluster health) |
| `dashboard/src/components/layout/StatusBar.tsx` | Bottom status bar showing cluster vitals, connection, active tab, keybind hints |
| `dashboard/src/components/layout/PanelLayout.tsx` | 3-column resizable layout orchestrator replacing the inline flex in App.tsx |
| `dashboard/src/components/ui/TodoTracker.tsx` | Persistent TODO / ops task tracker component with add/check/remove |
| `dashboard/src/components/ui/KeybindHelp.tsx` | `?` overlay showing all keyboard shortcuts grouped by category |
| `dashboard/src/components/ui/FuzzySearch.tsx` | Fuzzy string matching utility (no dependency, simple scored match) |
| `dashboard/src/stores/panels.ts` | Zustand store for panel widths, collapse states, resize constraints |
| `dashboard/src/stores/todos.ts` | Zustand store for TODO items (persisted to localStorage) |
| `dashboard/src/stores/theme.ts` | Zustand store for theme selection and custom theme loading |
| `dashboard/src/hooks/useKeybinds.ts` | Global keyboard shortcut registry with leader-key support |
| `dashboard/src/hooks/useResizable.ts` | Hook encapsulating mouse-drag resize logic for panels |
| `dashboard/src/lib/themes.ts` | Theme definitions (8 built-in themes: tentaclaw-dark, dracula, nord, catppuccin-mocha, gruvbox-dark, tokyo-night, solarized-dark, light) |
| `dashboard/src/lib/fuzzy.ts` | Fuzzy matching algorithm (score-based, case-insensitive, position-weighted) |

### Modified Files

| File | Changes |
|------|---------|
| `dashboard/src/App.tsx` | Replace inline layout with `<PanelLayout>`, add `<StatusBar>`, wire keybind provider |
| `dashboard/src/stores/ui.ts` | Add `rightSidebarCollapsed`, `bottomPanelCollapsed`, focus tracking, keybind state |
| `dashboard/src/components/layout/TaskLog.tsx` | Make height resizable via drag handle, add collapse/expand toggle |
| `dashboard/src/components/layout/VerticalTabs.tsx` | Add keyboard nav (j/k or arrow keys), active highlight animation |
| `dashboard/src/components/layout/Sidebar.tsx` | Integrate with panel resize system, min/max width constraints |
| `dashboard/src/components/layout/Header.tsx` | Slim down to 40px, move search trigger to command palette (Ctrl+K), add right-sidebar toggle button |
| `dashboard/src/components/ui/CommandPalette.tsx` | Add fuzzy search, keyboard shortcut hints per command, slash commands, leader-key sequences, category grouping |
| `dashboard/src/styles/index.css` | Add CSS custom properties for theme variables, resize handle styles, panel transition animations |
| `dashboard/src/lib/types.ts` | Add `TodoItem`, `Theme`, `PanelConfig`, `KeybindAction` type definitions |

---

## Detailed Tasks

---

### Task 1: Resizable Panel Infrastructure

**Files:**
- Create: `dashboard/src/hooks/useResizable.ts`
- Create: `dashboard/src/components/layout/ResizeHandle.tsx`

This is the foundation — every panel (left sidebar, right sidebar, bottom TaskLog) uses this.

- [ ] **Step 1: Create the useResizable hook**

```typescript
// dashboard/src/hooks/useResizable.ts
import { useState, useCallback, useEffect, useRef } from 'react';

interface UseResizableOptions {
  direction: 'horizontal' | 'vertical';
  initialSize: number;
  minSize: number;
  maxSize: number;
  onResize?: (size: number) => void;
}

interface UseResizableReturn {
  size: number;
  isResizing: boolean;
  handleMouseDown: (e: React.MouseEvent) => void;
}

export function useResizable({
  direction,
  initialSize,
  minSize,
  maxSize,
  onResize,
}: UseResizableOptions): UseResizableReturn {
  const [size, setSize] = useState(initialSize);
  const [isResizing, setIsResizing] = useState(false);
  const startPos = useRef(0);
  const startSize = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizing(true);
      startPos.current = direction === 'horizontal' ? e.clientX : e.clientY;
      startSize.current = size;
    },
    [direction, size],
  );

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const currentPos = direction === 'horizontal' ? e.clientX : e.clientY;
      const delta = currentPos - startPos.current;
      const newSize = Math.min(maxSize, Math.max(minSize, startSize.current + delta));
      setSize(newSize);
      onResize?.(newSize);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    // Prevent text selection while dragging
    document.body.style.userSelect = 'none';
    document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [isResizing, direction, minSize, maxSize, onResize]);

  return { size, isResizing, handleMouseDown };
}
```

- [ ] **Step 2: Create the ResizeHandle component**

```tsx
// dashboard/src/components/layout/ResizeHandle.tsx
interface ResizeHandleProps {
  direction: 'horizontal' | 'vertical';
  onMouseDown: (e: React.MouseEvent) => void;
  isResizing: boolean;
}

export function ResizeHandle({ direction, onMouseDown, isResizing }: ResizeHandleProps) {
  const isHorizontal = direction === 'horizontal';

  return (
    <div
      onMouseDown={onMouseDown}
      className="shrink-0 relative group"
      style={{
        width: isHorizontal ? 4 : '100%',
        height: isHorizontal ? '100%' : 4,
        cursor: isHorizontal ? 'col-resize' : 'row-resize',
        zIndex: 10,
      }}
    >
      {/* Visible line on hover/drag */}
      <div
        className="absolute transition-opacity duration-150"
        style={{
          ...(isHorizontal
            ? { top: 0, bottom: 0, left: 1, width: 2 }
            : { left: 0, right: 0, top: 1, height: 2 }),
          background: isResizing ? 'var(--cyan)' : 'transparent',
          opacity: isResizing ? 1 : 0,
        }}
      />
      {/* Wider hit area */}
      <div
        className="absolute"
        style={{
          ...(isHorizontal
            ? { top: 0, bottom: 0, left: -3, width: 10 }
            : { left: 0, right: 0, top: -3, height: 10 }),
        }}
      />
      <style>{`
        .group:hover > div:first-child {
          background: rgba(0, 255, 255, 0.3) !important;
          opacity: 1 !important;
        }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 3: Verify both files compile**

Run: `cd F:/tentaclaw-os && npx tsc --noEmit --project dashboard/tsconfig.json 2>&1 | head -20`
Expected: No errors related to these two files.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/hooks/useResizable.ts dashboard/src/components/layout/ResizeHandle.tsx
git commit -m "feat(dashboard): add resizable panel hook and drag handle component"
```

---

### Task 2: UI Store Expansion

**Files:**
- Modify: `dashboard/src/lib/types.ts`
- Create: `dashboard/src/stores/panels.ts`
- Create: `dashboard/src/stores/todos.ts`

Add all new types and state stores before building UI.

- [ ] **Step 1: Add new types to types.ts**

Append to the end of `dashboard/src/lib/types.ts`:

```typescript
// ── Panel & Layout ──
export interface PanelConfig {
  width: number;
  minWidth: number;
  maxWidth: number;
  collapsed: boolean;
}

// ── TODO Tracker ──
export type TodoStatus = 'pending' | 'in_progress' | 'completed';

export interface TodoItem {
  id: string;
  text: string;
  status: TodoStatus;
  createdAt: number;
  completedAt?: number;
  /** Optional: link to a node or model */
  resourceRef?: { type: ResourceType; id: string };
}

// ── Theme ──
export interface ThemeDefinition {
  id: string;
  name: string;
  type: 'dark' | 'light';
  colors: Record<string, string>;
}

// ── Keybinds ──
export interface KeybindAction {
  id: string;
  label: string;
  keys: string; // e.g. "ctrl+k", "g then s" (leader sequence)
  category: 'navigation' | 'panels' | 'actions' | 'tabs';
  action: () => void;
}
```

- [ ] **Step 2: Create panels store**

```typescript
// dashboard/src/stores/panels.ts
import { create } from 'zustand';

interface PanelsState {
  leftSidebarWidth: number;
  rightSidebarWidth: number;
  bottomPanelHeight: number;
  leftSidebarCollapsed: boolean;
  rightSidebarCollapsed: boolean;
  bottomPanelCollapsed: boolean;

  setLeftSidebarWidth: (w: number) => void;
  setRightSidebarWidth: (w: number) => void;
  setBottomPanelHeight: (h: number) => void;
  toggleLeftSidebar: () => void;
  toggleRightSidebar: () => void;
  toggleBottomPanel: () => void;
}

export const usePanelsStore = create<PanelsState>((set) => ({
  leftSidebarWidth: 240,
  rightSidebarWidth: 280,
  bottomPanelHeight: 140,
  leftSidebarCollapsed: false,
  rightSidebarCollapsed: true, // starts collapsed, user opens it
  bottomPanelCollapsed: false,

  setLeftSidebarWidth: (w) => set({ leftSidebarWidth: w }),
  setRightSidebarWidth: (w) => set({ rightSidebarWidth: w }),
  setBottomPanelHeight: (h) => set({ bottomPanelHeight: h }),
  toggleLeftSidebar: () => set((s) => ({ leftSidebarCollapsed: !s.leftSidebarCollapsed })),
  toggleRightSidebar: () => set((s) => ({ rightSidebarCollapsed: !s.rightSidebarCollapsed })),
  toggleBottomPanel: () => set((s) => ({ bottomPanelCollapsed: !s.bottomPanelCollapsed })),
}));
```

- [ ] **Step 3: Create todos store with localStorage persistence**

```typescript
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
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function loadFromStorage(): TodoItem[] {
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
```

- [ ] **Step 4: Verify stores compile**

Run: `cd F:/tentaclaw-os && npx tsc --noEmit --project dashboard/tsconfig.json 2>&1 | head -20`
Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/lib/types.ts dashboard/src/stores/panels.ts dashboard/src/stores/todos.ts
git commit -m "feat(dashboard): add panel layout and todo tracker state stores"
```

---

### Task 3: Right-Side Context Sidebar

**Files:**
- Create: `dashboard/src/components/layout/RightSidebar.tsx`

This is the marquee feature from OpenCode — a context panel on the right showing session info, TODO list, cluster health snapshot, and active model context. Inspired by OpenCode's 42-char sidebar with collapsible sections.

- [ ] **Step 1: Create the RightSidebar component**

```tsx
// dashboard/src/components/layout/RightSidebar.tsx
import { useState } from 'react';
import { usePanelsStore } from '@/stores/panels';
import { useClusterStore } from '@/stores/cluster';
import { TodoTracker } from '@/components/ui/TodoTracker';

function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-1.5 text-[9px] uppercase tracking-[2px] cursor-pointer"
        style={{ color: 'var(--text-muted)' }}
      >
        <span>{title}</span>
        <span
          className="text-[8px] transition-transform duration-200"
          style={{ transform: open ? 'rotate(0)' : 'rotate(-90deg)' }}
        >
          ▾
        </span>
      </button>
      {open && <div className="px-3 pb-2">{children}</div>}
    </div>
  );
}

function HealthSnapshot() {
  const nodes = useClusterStore((s) => s.nodes);
  const alerts = useClusterStore((s) => s.alerts);
  const online = nodes.filter((n) => n.status === 'online').length;
  const totalGpus = nodes.reduce((sum, n) => sum + n.gpu_count, 0);
  const activeAlerts = alerts.filter((a) => !a.acknowledged).length;

  const stats = [
    { label: 'Nodes', value: `${online}/${nodes.length}`, color: online === nodes.length ? 'var(--green)' : 'var(--yellow)' },
    { label: 'GPUs', value: String(totalGpus), color: 'var(--cyan)' },
    { label: 'Alerts', value: String(activeAlerts), color: activeAlerts > 0 ? 'var(--red)' : 'var(--green)' },
  ];

  return (
    <div className="grid grid-cols-3 gap-1.5">
      {stats.map((s) => (
        <div
          key={s.label}
          className="flex flex-col items-center py-1.5 rounded"
          style={{ background: 'var(--bg-elevated)' }}
        >
          <span className="text-[11px] font-mono font-bold" style={{ color: s.color }}>
            {s.value}
          </span>
          <span className="text-[8px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>
            {s.label}
          </span>
        </div>
      ))}
    </div>
  );
}

function ActiveModels() {
  const nodes = useClusterStore((s) => s.nodes);
  const models = new Set<string>();
  for (const node of nodes) {
    if (node.latest_stats?.inference.loaded_models) {
      for (const m of node.latest_stats.inference.loaded_models) {
        models.add(m);
      }
    }
  }
  const modelList = [...models].slice(0, 8);

  if (modelList.length === 0) {
    return (
      <span className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
        No models loaded
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      {modelList.map((m) => (
        <div
          key={m}
          className="flex items-center gap-1.5 py-0.5"
        >
          <div
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ background: 'var(--green)', boxShadow: '0 0 4px rgba(0,255,136,0.4)' }}
          />
          <span
            className="text-[10px] font-mono truncate"
            style={{ color: 'var(--text-secondary)' }}
          >
            {m}
          </span>
        </div>
      ))}
    </div>
  );
}

export function RightSidebar() {
  const collapsed = usePanelsStore((s) => s.rightSidebarCollapsed);
  const width = usePanelsStore((s) => s.rightSidebarWidth);

  if (collapsed) return null;

  return (
    <aside
      className="shrink-0 flex flex-col overflow-hidden"
      style={{
        width,
        background: 'var(--bg-sidebar)',
        backdropFilter: 'blur(12px)',
        borderLeft: '1px solid var(--border)',
      }}
    >
      {/* Sidebar title */}
      <div
        className="flex items-center justify-between px-3 py-2 shrink-0"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <span className="text-[9px] uppercase tracking-[2px] text-[var(--text-muted)] font-medium">
          Context
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Health Snapshot */}
        <CollapsibleSection title="Cluster Health">
          <HealthSnapshot />
        </CollapsibleSection>

        <div style={{ height: 1, background: 'linear-gradient(90deg, transparent, rgba(0,255,255,0.06), transparent)' }} />

        {/* TODO Tracker — the star feature */}
        <CollapsibleSection title="Operations TODO">
          <TodoTracker />
        </CollapsibleSection>

        <div style={{ height: 1, background: 'linear-gradient(90deg, transparent, rgba(0,255,255,0.06), transparent)' }} />

        {/* Active Models */}
        <CollapsibleSection title="Loaded Models" defaultOpen={false}>
          <ActiveModels />
        </CollapsibleSection>
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Verify it compiles (will fail until TodoTracker exists)**

This step intentionally fails — confirms the dependency on Task 4. Move to Task 4.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/components/layout/RightSidebar.tsx
git commit -m "feat(dashboard): add right-side context sidebar with health snapshot and model list"
```

---

### Task 4: TODO / Operations Tracker

**Files:**
- Create: `dashboard/src/components/ui/TodoTracker.tsx`

Directly inspired by OpenCode's `todo.tsx` — but adapted for cluster ops instead of coding tasks. Users can add items like "Migrate model X to node Y", "Investigate GPU 3 thermal throttling", etc.

- [ ] **Step 1: Create the TodoTracker component**

```tsx
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
```

- [ ] **Step 2: Verify RightSidebar + TodoTracker both compile**

Run: `cd F:/tentaclaw-os && npx tsc --noEmit --project dashboard/tsconfig.json 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/components/ui/TodoTracker.tsx
git commit -m "feat(dashboard): add operations TODO tracker with status cycling and localStorage persistence"
```

---

### Task 5: Enhanced Status Bar (Footer)

**Files:**
- Create: `dashboard/src/components/layout/StatusBar.tsx`

Inspired by OpenCode's footer — shows cluster vitals, active connections, current tab, and keyboard shortcut hints. Sits below the TaskLog at the very bottom of the viewport.

- [ ] **Step 1: Create the StatusBar component**

```tsx
// dashboard/src/components/layout/StatusBar.tsx
import { useClusterStore } from '@/stores/cluster';
import { useUIStore } from '@/stores/ui';
import { usePanelsStore } from '@/stores/panels';

export function StatusBar() {
  const nodes = useClusterStore((s) => s.nodes);
  const connected = useClusterStore((s) => s.connected);
  const activeTab = useUIStore((s) => s.activeTab);
  const alerts = useClusterStore((s) => s.alerts);
  const rightCollapsed = usePanelsStore((s) => s.rightSidebarCollapsed);

  const onlineNodes = nodes.filter((n) => n.status === 'online').length;
  const totalGpus = nodes.reduce((sum, n) => sum + n.gpu_count, 0);
  const activeAlerts = alerts.filter((a) => !a.acknowledged).length;

  // Aggregate tok/s across all online nodes
  const totalToksPerSec = nodes.reduce((sum, n) => {
    return sum + (n.latest_stats?.toks_per_sec ?? 0);
  }, 0);

  return (
    <footer
      className="flex items-center justify-between px-3 shrink-0 z-20"
      style={{
        height: 24,
        background: 'rgba(8,10,16,0.95)',
        borderTop: '1px solid var(--border)',
        fontSize: 10,
        fontFamily: "'JetBrains Mono', 'Geist Mono', monospace",
      }}
    >
      {/* Left section: connection + cluster stats */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1">
          <div
            className="w-1.5 h-1.5 rounded-full"
            style={{
              background: connected ? 'var(--green)' : 'var(--red)',
              boxShadow: connected ? '0 0 4px rgba(0,255,136,0.4)' : '0 0 4px rgba(255,70,70,0.4)',
            }}
          />
          <span style={{ color: connected ? 'var(--green)' : 'var(--red)' }}>
            {connected ? 'connected' : 'disconnected'}
          </span>
        </div>
        <span style={{ color: 'var(--text-dim)' }}>│</span>
        <span style={{ color: 'var(--cyan)' }}>{onlineNodes} nodes</span>
        <span style={{ color: 'var(--text-dim)' }}>│</span>
        <span style={{ color: 'var(--text-muted)' }}>{totalGpus} GPUs</span>
        <span style={{ color: 'var(--text-dim)' }}>│</span>
        <span style={{ color: 'var(--text-muted)' }}>{totalToksPerSec.toFixed(1)} tok/s</span>
        {activeAlerts > 0 && (
          <>
            <span style={{ color: 'var(--text-dim)' }}>│</span>
            <span style={{ color: 'var(--red)' }}>{activeAlerts} alert{activeAlerts !== 1 ? 's' : ''}</span>
          </>
        )}
      </div>

      {/* Center: active tab */}
      <div style={{ color: 'var(--text-dim)' }}>
        {activeTab.replace(/-/g, ' ').toUpperCase()}
      </div>

      {/* Right: keybind hints */}
      <div className="flex items-center gap-3" style={{ color: 'var(--text-dim)' }}>
        <span>Ctrl+K search</span>
        <span>Ctrl+B sidebar</span>
        <span>Ctrl+J context</span>
        <span>? help</span>
      </div>
    </footer>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd F:/tentaclaw-os && npx tsc --noEmit --project dashboard/tsconfig.json 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/components/layout/StatusBar.tsx
git commit -m "feat(dashboard): add status bar footer with cluster vitals and keybind hints"
```

---

### Task 6: Keyboard Navigation System

**Files:**
- Create: `dashboard/src/hooks/useKeybinds.ts`

A global keyboard shortcut system inspired by OpenCode's leader-key pattern. Supports direct shortcuts (Ctrl+K), leader sequences (g→s = go to summary), and context-aware bindings.

- [ ] **Step 1: Create the useKeybinds hook**

```typescript
// dashboard/src/hooks/useKeybinds.ts
import { useEffect, useCallback, useRef } from 'react';

interface Keybind {
  id: string;
  keys: string; // "ctrl+k", "g s" (sequence), "shift+?"
  label: string;
  category: 'navigation' | 'panels' | 'actions' | 'tabs';
  action: () => void;
}

function parseKeyCombo(keys: string): string[][] {
  // "g s" → [["g"], ["s"]] (sequence)
  // "ctrl+k" → [["ctrl+k"]] (chord)
  return keys.split(' ').map((part) => [part.toLowerCase()]);
}

function eventToKey(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('ctrl');
  if (e.shiftKey) parts.push('shift');
  if (e.altKey) parts.push('alt');

  let key = e.key.toLowerCase();
  if (key === ' ') key = 'space';
  if (key === 'escape') key = 'esc';

  // Don't double-add modifier keys
  if (!['control', 'shift', 'alt', 'meta'].includes(key)) {
    parts.push(key);
  }

  return parts.join('+');
}

export function useKeybinds(keybinds: Keybind[]) {
  const sequenceBuffer = useRef<string[]>([]);
  const sequenceTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Don't capture when typing in inputs
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      const pressed = eventToKey(e);

      // Check direct (single-chord) keybinds first
      for (const bind of keybinds) {
        const parsed = parseKeyCombo(bind.keys);
        if (parsed.length === 1 && parsed[0][0] === pressed) {
          e.preventDefault();
          bind.action();
          sequenceBuffer.current = [];
          return;
        }
      }

      // Sequence handling
      sequenceBuffer.current.push(pressed);
      if (sequenceTimeout.current) clearTimeout(sequenceTimeout.current);
      sequenceTimeout.current = setTimeout(() => {
        sequenceBuffer.current = [];
      }, 800); // 800ms to complete sequence

      // Check sequence keybinds
      const bufferStr = sequenceBuffer.current.join(' ');
      for (const bind of keybinds) {
        const parsed = parseKeyCombo(bind.keys);
        if (parsed.length > 1) {
          const bindStr = parsed.map((p) => p[0]).join(' ');
          if (bindStr === bufferStr) {
            e.preventDefault();
            bind.action();
            sequenceBuffer.current = [];
            if (sequenceTimeout.current) clearTimeout(sequenceTimeout.current);
            return;
          }
        }
      }
    },
    [keybinds],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}

export type { Keybind };
```

- [ ] **Step 2: Verify it compiles**

Run: `cd F:/tentaclaw-os && npx tsc --noEmit --project dashboard/tsconfig.json 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/hooks/useKeybinds.ts
git commit -m "feat(dashboard): add keyboard navigation system with leader-key sequence support"
```

---

### Task 7: Upgraded Command Palette

**Files:**
- Create: `dashboard/src/lib/fuzzy.ts`
- Modify: `dashboard/src/components/ui/CommandPalette.tsx`

Upgrade the existing command palette with fuzzy search, shortcut hints per command, category grouping, and slash commands. Inspired by OpenCode's `dialog-command.tsx`.

- [ ] **Step 1: Create fuzzy search utility**

```typescript
// dashboard/src/lib/fuzzy.ts

interface FuzzyResult<T> {
  item: T;
  score: number;
  matches: number[]; // indices of matched characters
}

/**
 * Score-based fuzzy match. Higher score = better match.
 * Rewards: consecutive matches, match at word boundary, match at start.
 * Returns null if no match.
 */
export function fuzzyMatch(query: string, target: string): { score: number; matches: number[] } | null {
  const q = query.toLowerCase();
  const t = target.toLowerCase();

  if (q.length === 0) return { score: 1, matches: [] };
  if (q.length > t.length) return null;

  const matches: number[] = [];
  let score = 0;
  let qi = 0;
  let lastMatchIdx = -2;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      matches.push(ti);

      // Consecutive bonus
      if (ti === lastMatchIdx + 1) {
        score += 8;
      }

      // Word boundary bonus (after space, hyphen, underscore, or start)
      if (ti === 0 || ' -_'.includes(t[ti - 1])) {
        score += 10;
      }

      // Position bonus (earlier matches score higher)
      score += Math.max(0, 5 - ti * 0.5);

      lastMatchIdx = ti;
      qi++;
    }
  }

  // All query chars must match
  if (qi < q.length) return null;

  // Length penalty — prefer shorter targets for same match quality
  score -= t.length * 0.1;

  return { score, matches };
}

export function fuzzyFilter<T>(
  query: string,
  items: T[],
  getText: (item: T) => string,
): FuzzyResult<T>[] {
  if (!query) return items.map((item) => ({ item, score: 0, matches: [] }));

  const results: FuzzyResult<T>[] = [];
  for (const item of items) {
    const match = fuzzyMatch(query, getText(item));
    if (match) {
      results.push({ item, ...match });
    }
  }

  return results.sort((a, b) => b.score - a.score);
}
```

- [ ] **Step 2: Rewrite CommandPalette with fuzzy search and shortcut hints**

Replace the full contents of `dashboard/src/components/ui/CommandPalette.tsx` with the upgraded version. The key changes from the existing implementation:
- Replace `.includes()` filtering with `fuzzyFilter()` from `@/lib/fuzzy`
- Add `shortcut` display per command row
- Group commands by category with section headers
- Add slash command support (`/models`, `/nodes`, `/alerts`)
- Highlight matched characters in results
- Keep existing easter egg system and confetti

The new file is large (~350 lines). Core structural changes:

```tsx
// In the command building section, add shortcuts to commands:
const cmds: Command[] = tabs.map((t) => ({
  id: `tab:${t.id}`,
  label: `Go to ${t.label}`,
  category: 'tab' as const,
  action: () => setActiveTab(t.id),
  shortcut: `g ${t.id[0]}`, // leader sequence hint
}));

// In the filter section, replace includes() with fuzzyFilter():
import { fuzzyFilter } from '@/lib/fuzzy';

const filtered = useMemo(() => {
  const base = query
    ? commands
    : commands.filter((c) => c.category !== 'easter-egg');

  if (!query) return base.map((c) => ({ item: c, score: 0, matches: [] }));

  return fuzzyFilter(query, base, (c) => c.label);
}, [query, commands]);

// In the result rendering, add shortcut badge:
{cmd.shortcut && (
  <span
    className="text-[8px] font-mono px-1 py-0.5 rounded ml-auto"
    style={{
      background: 'rgba(255,255,255,0.04)',
      color: 'var(--text-dim)',
      border: '1px solid rgba(255,255,255,0.06)',
    }}
  >
    {cmd.shortcut}
  </span>
)}

// Add slash commands:
if (query.startsWith('/')) {
  // /models → go to models tab
  // /nodes → go to nodes/summary
  // /alerts → go to alerts
  // /flight → go to flight-sheets
}
```

- [ ] **Step 3: Verify compile**

Run: `cd F:/tentaclaw-os && npx tsc --noEmit --project dashboard/tsconfig.json 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/lib/fuzzy.ts dashboard/src/components/ui/CommandPalette.tsx
git commit -m "feat(dashboard): upgrade command palette with fuzzy search, shortcut hints, and slash commands"
```

---

### Task 8: Resizable TaskLog Bottom Panel

**Files:**
- Modify: `dashboard/src/components/layout/TaskLog.tsx`

Make the bottom TaskLog panel resizable by adding a drag handle at the top edge, and add a collapse/expand toggle. Uses the resize infrastructure from Task 1.

- [ ] **Step 1: Update TaskLog to support resize and collapse**

At the top of the `TaskLog` component, add:

```tsx
import { usePanelsStore } from '@/stores/panels';
import { useResizable } from '@/hooks/useResizable';
import { ResizeHandle } from '@/components/layout/ResizeHandle';
```

Replace the fixed `h-[140px]` with dynamic height from the panels store. Add a `ResizeHandle` at the top of the component. Add a collapse toggle button in the tab bar.

Key changes to the existing `TaskLog` component:

```tsx
export function TaskLog() {
  const bottomHeight = usePanelsStore((s) => s.bottomPanelHeight);
  const collapsed = usePanelsStore((s) => s.bottomPanelCollapsed);
  const toggleBottom = usePanelsStore((s) => s.toggleBottomPanel);
  const setHeight = usePanelsStore((s) => s.setBottomPanelHeight);

  // Resize uses negative direction (dragging up increases height)
  const { size, isResizing, handleMouseDown } = useResizable({
    direction: 'vertical',
    initialSize: bottomHeight,
    minSize: 80,
    maxSize: 400,
    onResize: setHeight,
  });

  // ... existing state (activeLogTab, tasks, etc.) stays the same ...

  if (collapsed) {
    return (
      <div
        className="flex items-center px-3 shrink-0 cursor-pointer"
        style={{
          height: 28,
          background: 'rgba(8,10,16,0.8)',
          borderTop: '1px solid var(--border)',
        }}
        onClick={toggleBottom}
      >
        <span className="text-[9px] text-[var(--text-dim)]">▲ Tasks / Cluster Log / Alerts</span>
      </div>
    );
  }

  return (
    <>
      {/* Drag handle at top edge — dragging UP increases height */}
      <ResizeHandle direction="vertical" onMouseDown={handleMouseDown} isResizing={isResizing} />
      <div
        className="shrink-0 flex flex-col"
        style={{
          height: size,
          background: 'rgba(8,10,16,0.8)',
          backdropFilter: 'blur(12px)',
          borderTop: '1px solid var(--border)',
        }}
      >
        {/* Tab bar — add collapse toggle at the end */}
        <div className="flex gap-0 px-3 shrink-0 items-center" style={{ borderBottom: '1px solid var(--border)' }}>
          {/* ... existing tabs ... */}
          <button
            onClick={toggleBottom}
            className="ml-auto text-[9px] cursor-pointer px-1.5"
            style={{ color: 'var(--text-dim)' }}
            title="Collapse panel"
          >
            ▼
          </button>
        </div>
        {/* ... rest of existing content unchanged ... */}
      </div>
    </>
  );
}
```

**Note for implementer:** The vertical resize needs special handling — the `useResizable` hook as written measures delta from mousedown position. For a bottom panel that grows upward, you'll need to invert the delta calculation. When implementing, update the `useResizable` hook to accept an `invert` option, or compute `startSize.current - delta` instead of `+ delta` for the bottom panel case.

- [ ] **Step 2: Verify compile**

Run: `cd F:/tentaclaw-os && npx tsc --noEmit --project dashboard/tsconfig.json 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/components/layout/TaskLog.tsx
git commit -m "feat(dashboard): make TaskLog bottom panel resizable and collapsible"
```

---

### Task 9: Theme Engine

**Files:**
- Create: `dashboard/src/lib/themes.ts`
- Create: `dashboard/src/stores/theme.ts`

8 built-in themes inspired by OpenCode's 30+ theme system. Each theme defines CSS custom properties that override the defaults in `index.css`. Themes are applied by setting CSS variables on `<html>`.

- [ ] **Step 1: Create theme definitions**

```typescript
// dashboard/src/lib/themes.ts
import type { ThemeDefinition } from '@/lib/types';

export const THEMES: ThemeDefinition[] = [
  {
    id: 'tentaclaw-dark',
    name: 'TentaCLAW Dark',
    type: 'dark',
    colors: {
      '--bg-base': '#060910',
      '--bg-sidebar': 'rgba(8,10,16,0.7)',
      '--bg-card': 'rgba(14,18,28,0.65)',
      '--bg-elevated': 'rgba(17,22,32,0.5)',
      '--bg-input': 'rgba(255,255,255,0.04)',
      '--cyan': '#00ffff',
      '--purple': '#8c00c8',
      '--teal': '#008c8c',
      '--green': '#00ff88',
      '--yellow': '#ffdc00',
      '--red': '#ff4646',
      '--border': 'rgba(255,255,255,0.05)',
      '--border-hover': 'rgba(0,255,255,0.12)',
      '--text-primary': '#f0f0f0',
      '--text-secondary': 'rgba(255,255,255,0.5)',
      '--text-muted': 'rgba(255,255,255,0.25)',
      '--text-dim': 'rgba(255,255,255,0.15)',
    },
  },
  {
    id: 'dracula',
    name: 'Dracula',
    type: 'dark',
    colors: {
      '--bg-base': '#282a36',
      '--bg-sidebar': 'rgba(40,42,54,0.85)',
      '--bg-card': 'rgba(68,71,90,0.6)',
      '--bg-elevated': 'rgba(68,71,90,0.4)',
      '--bg-input': 'rgba(255,255,255,0.05)',
      '--cyan': '#8be9fd',
      '--purple': '#bd93f9',
      '--teal': '#6272a4',
      '--green': '#50fa7b',
      '--yellow': '#f1fa8c',
      '--red': '#ff5555',
      '--border': 'rgba(255,255,255,0.08)',
      '--border-hover': 'rgba(139,233,253,0.15)',
      '--text-primary': '#f8f8f2',
      '--text-secondary': 'rgba(248,248,242,0.6)',
      '--text-muted': 'rgba(248,248,242,0.35)',
      '--text-dim': 'rgba(248,248,242,0.2)',
    },
  },
  {
    id: 'nord',
    name: 'Nord',
    type: 'dark',
    colors: {
      '--bg-base': '#2e3440',
      '--bg-sidebar': 'rgba(46,52,64,0.85)',
      '--bg-card': 'rgba(59,66,82,0.6)',
      '--bg-elevated': 'rgba(67,76,94,0.4)',
      '--bg-input': 'rgba(255,255,255,0.04)',
      '--cyan': '#88c0d0',
      '--purple': '#b48ead',
      '--teal': '#5e81ac',
      '--green': '#a3be8c',
      '--yellow': '#ebcb8b',
      '--red': '#bf616a',
      '--border': 'rgba(255,255,255,0.06)',
      '--border-hover': 'rgba(136,192,208,0.15)',
      '--text-primary': '#eceff4',
      '--text-secondary': 'rgba(236,239,244,0.6)',
      '--text-muted': 'rgba(236,239,244,0.35)',
      '--text-dim': 'rgba(236,239,244,0.2)',
    },
  },
  {
    id: 'catppuccin-mocha',
    name: 'Catppuccin Mocha',
    type: 'dark',
    colors: {
      '--bg-base': '#1e1e2e',
      '--bg-sidebar': 'rgba(30,30,46,0.85)',
      '--bg-card': 'rgba(49,50,68,0.6)',
      '--bg-elevated': 'rgba(69,71,90,0.4)',
      '--bg-input': 'rgba(255,255,255,0.04)',
      '--cyan': '#89dceb',
      '--purple': '#cba6f7',
      '--teal': '#94e2d5',
      '--green': '#a6e3a1',
      '--yellow': '#f9e2af',
      '--red': '#f38ba8',
      '--border': 'rgba(255,255,255,0.06)',
      '--border-hover': 'rgba(137,220,235,0.15)',
      '--text-primary': '#cdd6f4',
      '--text-secondary': 'rgba(205,214,244,0.6)',
      '--text-muted': 'rgba(205,214,244,0.35)',
      '--text-dim': 'rgba(205,214,244,0.2)',
    },
  },
  {
    id: 'gruvbox-dark',
    name: 'Gruvbox Dark',
    type: 'dark',
    colors: {
      '--bg-base': '#282828',
      '--bg-sidebar': 'rgba(40,40,40,0.85)',
      '--bg-card': 'rgba(60,56,54,0.6)',
      '--bg-elevated': 'rgba(80,73,69,0.4)',
      '--bg-input': 'rgba(255,255,255,0.05)',
      '--cyan': '#83a598',
      '--purple': '#d3869b',
      '--teal': '#8ec07c',
      '--green': '#b8bb26',
      '--yellow': '#fabd2f',
      '--red': '#fb4934',
      '--border': 'rgba(255,255,255,0.07)',
      '--border-hover': 'rgba(131,165,152,0.15)',
      '--text-primary': '#ebdbb2',
      '--text-secondary': 'rgba(235,219,178,0.6)',
      '--text-muted': 'rgba(235,219,178,0.35)',
      '--text-dim': 'rgba(235,219,178,0.2)',
    },
  },
  {
    id: 'tokyo-night',
    name: 'Tokyo Night',
    type: 'dark',
    colors: {
      '--bg-base': '#1a1b26',
      '--bg-sidebar': 'rgba(26,27,38,0.85)',
      '--bg-card': 'rgba(36,40,59,0.6)',
      '--bg-elevated': 'rgba(52,59,88,0.4)',
      '--bg-input': 'rgba(255,255,255,0.04)',
      '--cyan': '#7dcfff',
      '--purple': '#bb9af7',
      '--teal': '#2ac3de',
      '--green': '#9ece6a',
      '--yellow': '#e0af68',
      '--red': '#f7768e',
      '--border': 'rgba(255,255,255,0.06)',
      '--border-hover': 'rgba(125,207,255,0.15)',
      '--text-primary': '#c0caf5',
      '--text-secondary': 'rgba(192,202,245,0.6)',
      '--text-muted': 'rgba(192,202,245,0.35)',
      '--text-dim': 'rgba(192,202,245,0.2)',
    },
  },
  {
    id: 'solarized-dark',
    name: 'Solarized Dark',
    type: 'dark',
    colors: {
      '--bg-base': '#002b36',
      '--bg-sidebar': 'rgba(0,43,54,0.85)',
      '--bg-card': 'rgba(7,54,66,0.6)',
      '--bg-elevated': 'rgba(88,110,117,0.3)',
      '--bg-input': 'rgba(255,255,255,0.04)',
      '--cyan': '#2aa198',
      '--purple': '#6c71c4',
      '--teal': '#268bd2',
      '--green': '#859900',
      '--yellow': '#b58900',
      '--red': '#dc322f',
      '--border': 'rgba(255,255,255,0.06)',
      '--border-hover': 'rgba(42,161,152,0.15)',
      '--text-primary': '#839496',
      '--text-secondary': 'rgba(131,148,150,0.7)',
      '--text-muted': 'rgba(131,148,150,0.4)',
      '--text-dim': 'rgba(131,148,150,0.25)',
    },
  },
  {
    id: 'light',
    name: 'TentaCLAW Light',
    type: 'light',
    colors: {
      '--bg-base': '#f8f9fa',
      '--bg-sidebar': 'rgba(248,249,250,0.95)',
      '--bg-card': 'rgba(233,236,239,0.7)',
      '--bg-elevated': 'rgba(222,226,230,0.5)',
      '--bg-input': 'rgba(0,0,0,0.03)',
      '--cyan': '#0891b2',
      '--purple': '#7c3aed',
      '--teal': '#0d9488',
      '--green': '#16a34a',
      '--yellow': '#ca8a04',
      '--red': '#dc2626',
      '--border': 'rgba(0,0,0,0.08)',
      '--border-hover': 'rgba(8,145,178,0.2)',
      '--text-primary': '#1a1a2e',
      '--text-secondary': 'rgba(26,26,46,0.6)',
      '--text-muted': 'rgba(26,26,46,0.35)',
      '--text-dim': 'rgba(26,26,46,0.2)',
    },
  },
];
```

- [ ] **Step 2: Create theme store**

```typescript
// dashboard/src/stores/theme.ts
import { create } from 'zustand';
import { THEMES } from '@/lib/themes';
import type { ThemeDefinition } from '@/lib/types';

interface ThemeState {
  activeThemeId: string;
  activeTheme: ThemeDefinition;
  setTheme: (id: string) => void;
}

function loadSavedTheme(): string {
  try {
    return localStorage.getItem('tentaclaw-theme') || 'tentaclaw-dark';
  } catch {
    return 'tentaclaw-dark';
  }
}

function applyTheme(theme: ThemeDefinition) {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(theme.colors)) {
    root.style.setProperty(key, value);
  }
  localStorage.setItem('tentaclaw-theme', theme.id);
}

const savedId = loadSavedTheme();
const initialTheme = THEMES.find((t) => t.id === savedId) || THEMES[0];
// Apply immediately on load
applyTheme(initialTheme);

export const useThemeStore = create<ThemeState>((set) => ({
  activeThemeId: initialTheme.id,
  activeTheme: initialTheme,

  setTheme: (id) => {
    const theme = THEMES.find((t) => t.id === id);
    if (!theme) return;
    applyTheme(theme);
    set({ activeThemeId: id, activeTheme: theme });
  },
}));
```

- [ ] **Step 3: Verify compile**

Run: `cd F:/tentaclaw-os && npx tsc --noEmit --project dashboard/tsconfig.json 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/lib/themes.ts dashboard/src/stores/theme.ts
git commit -m "feat(dashboard): add theme engine with 8 built-in themes and localStorage persistence"
```

---

### Task 10: Layout Composition — Wire Everything Together

**Files:**
- Create: `dashboard/src/components/layout/PanelLayout.tsx`
- Modify: `dashboard/src/App.tsx`
- Modify: `dashboard/src/components/layout/Sidebar.tsx`
- Modify: `dashboard/src/components/layout/Header.tsx`

This is the integration task. Replace the inline flex layout in `App.tsx` with a proper `PanelLayout` that manages all 3 columns + bottom panel + status bar, and wire up all keyboard shortcuts.

- [ ] **Step 1: Create PanelLayout component**

```tsx
// dashboard/src/components/layout/PanelLayout.tsx
import { Sidebar } from '@/components/layout/Sidebar';
import { VerticalTabs } from '@/components/layout/VerticalTabs';
import { ContentPane } from '@/components/layout/ContentPane';
import { RightSidebar } from '@/components/layout/RightSidebar';
import { TaskLog } from '@/components/layout/TaskLog';
import { ResizeHandle } from '@/components/layout/ResizeHandle';
import { usePanelsStore } from '@/stores/panels';
import { useResizable } from '@/hooks/useResizable';

export function PanelLayout() {
  const leftWidth = usePanelsStore((s) => s.leftSidebarWidth);
  const leftCollapsed = usePanelsStore((s) => s.leftSidebarCollapsed);
  const rightCollapsed = usePanelsStore((s) => s.rightSidebarCollapsed);
  const setLeftWidth = usePanelsStore((s) => s.setLeftSidebarWidth);
  const setRightWidth = usePanelsStore((s) => s.setRightSidebarWidth);

  const leftResize = useResizable({
    direction: 'horizontal',
    initialSize: leftWidth,
    minSize: 160,
    maxSize: 400,
    onResize: setLeftWidth,
  });

  const rightResize = useResizable({
    direction: 'horizontal',
    initialSize: usePanelsStore.getState().rightSidebarWidth,
    minSize: 200,
    maxSize: 450,
    onResize: setRightWidth,
  });

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar (resource tree) */}
        {!leftCollapsed && (
          <>
            <Sidebar width={leftResize.size} />
            <ResizeHandle
              direction="horizontal"
              onMouseDown={leftResize.handleMouseDown}
              isResizing={leftResize.isResizing}
            />
          </>
        )}

        {/* Center: tabs + content */}
        <div className="flex-1 flex overflow-hidden">
          <VerticalTabs />
          <ContentPane />
        </div>

        {/* Right sidebar (context panel) */}
        {!rightCollapsed && (
          <>
            <ResizeHandle
              direction="horizontal"
              onMouseDown={rightResize.handleMouseDown}
              isResizing={rightResize.isResizing}
            />
            <RightSidebar />
          </>
        )}
      </div>

      {/* Bottom panel */}
      <TaskLog />
    </div>
  );
}
```

- [ ] **Step 2: Update Sidebar to accept width prop**

Modify `dashboard/src/components/layout/Sidebar.tsx`:
- Remove the internal `collapsed` state from `useUIStore` (now managed by `usePanelsStore`)
- Accept a `width` prop instead of using the fixed 240px / 0px toggle
- Remove the internal width logic — the parent `PanelLayout` controls visibility

```tsx
// Updated Sidebar signature:
export function Sidebar({ width }: { width: number }) {
  return (
    <aside
      className="shrink-0 flex flex-col overflow-hidden"
      style={{
        width,
        background: 'var(--bg-sidebar)',
        backdropFilter: 'blur(12px)',
        borderRight: '1px solid var(--border)',
      }}
    >
      {/* ... existing content stays the same ... */}
    </aside>
  );
}
```

- [ ] **Step 3: Add toggle buttons to Header**

Modify `dashboard/src/components/layout/Header.tsx`:
- Import `usePanelsStore`
- Add toggle buttons for left sidebar (Ctrl+B) and right sidebar (Ctrl+J)
- Reduce header height from 48px to 40px for more content space

In the right section of the header, before the connection dot, add:

```tsx
const toggleLeft = usePanelsStore((s) => s.toggleLeftSidebar);
const toggleRight = usePanelsStore((s) => s.toggleRightSidebar);

// In JSX, add two icon buttons:
<button
  onClick={toggleLeft}
  className="text-[10px] cursor-pointer px-1.5 py-0.5 rounded transition-colors"
  style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }}
  title="Toggle sidebar (Ctrl+B)"
>
  ☰
</button>
<button
  onClick={toggleRight}
  className="text-[10px] cursor-pointer px-1.5 py-0.5 rounded transition-colors"
  style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }}
  title="Toggle context panel (Ctrl+J)"
>
  ◫
</button>
```

- [ ] **Step 4: Rewrite App.tsx to use PanelLayout + StatusBar + keybinds**

Replace the `Dashboard` component in `App.tsx`:

```tsx
import { useEffect, useMemo } from 'react';
import { Header } from '@/components/layout/Header';
import { PanelLayout } from '@/components/layout/PanelLayout';
import { StatusBar } from '@/components/layout/StatusBar';
import { CommandPalette } from '@/components/ui/CommandPalette';
import { LoginPage } from '@/components/LoginPage';
import { useAuthStore } from '@/stores/auth';
import { usePanelsStore } from '@/stores/panels';
import { useUIStore } from '@/stores/ui';
import { useSSE } from '@/hooks/useSSE';
import { useKeybinds } from '@/hooks/useKeybinds';
import type { Keybind } from '@/hooks/useKeybinds';
import type { TabId } from '@/lib/types';

function Dashboard() {
  useSSE();

  const setActiveTab = useUIStore((s) => s.setActiveTab);
  const toggleLeft = usePanelsStore((s) => s.toggleLeftSidebar);
  const toggleRight = usePanelsStore((s) => s.toggleRightSidebar);
  const toggleBottom = usePanelsStore((s) => s.toggleBottomPanel);

  const keybinds = useMemo<Keybind[]>(
    () => [
      { id: 'toggle-left', keys: 'ctrl+b', label: 'Toggle sidebar', category: 'panels', action: toggleLeft },
      { id: 'toggle-right', keys: 'ctrl+j', label: 'Toggle context', category: 'panels', action: toggleRight },
      { id: 'toggle-bottom', keys: 'ctrl+`', label: 'Toggle log', category: 'panels', action: toggleBottom },
      // Tab navigation via leader sequences: g then first letter
      { id: 'go-summary', keys: 'g s', label: 'Go to Summary', category: 'tabs', action: () => setActiveTab('summary') },
      { id: 'go-gpus', keys: 'g g', label: 'Go to GPUs', category: 'tabs', action: () => setActiveTab('gpus') },
      { id: 'go-models', keys: 'g m', label: 'Go to Models', category: 'tabs', action: () => setActiveTab('models') },
      { id: 'go-inference', keys: 'g i', label: 'Go to Inference', category: 'tabs', action: () => setActiveTab('inference') },
      { id: 'go-terminal', keys: 'g t', label: 'Go to Terminal', category: 'tabs', action: () => setActiveTab('terminal') },
      { id: 'go-chat', keys: 'g c', label: 'Go to Chat', category: 'tabs', action: () => setActiveTab('chat') },
      { id: 'go-alerts', keys: 'g a', label: 'Go to Alerts', category: 'tabs', action: () => setActiveTab('alerts') },
      { id: 'go-settings', keys: 'g x', label: 'Go to Settings', category: 'tabs', action: () => setActiveTab('settings') },
    ],
    [setActiveTab, toggleLeft, toggleRight, toggleBottom],
  );

  useKeybinds(keybinds);

  return (
    <div className="flex flex-col h-screen relative z-[1]">
      {/* Scanline */}
      <div
        className="fixed top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[var(--cyan)]/10 to-transparent pointer-events-none z-50"
        style={{ animation: 'scanline 8s linear infinite' }}
      />
      <CommandPalette />
      <Header />
      <PanelLayout />
      <StatusBar />
    </div>
  );
}

// LoadingScreen and App stay the same
```

- [ ] **Step 5: Verify full compile**

Run: `cd F:/tentaclaw-os && npx tsc --noEmit --project dashboard/tsconfig.json 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 6: Test in dev server**

Run: `cd F:/tentaclaw-os/dashboard && npx vite --host 0.0.0.0 --port 3001`
Expected: Dashboard loads with resizable panels, right sidebar toggle, status bar at bottom.

- [ ] **Step 7: Commit**

```bash
git add dashboard/src/components/layout/PanelLayout.tsx dashboard/src/App.tsx dashboard/src/components/layout/Sidebar.tsx dashboard/src/components/layout/Header.tsx
git commit -m "feat(dashboard): integrate 3-column resizable layout with keybind navigation"
```

---

### Task 11: Keyboard Shortcut Help Overlay

**Files:**
- Create: `dashboard/src/components/ui/KeybindHelp.tsx`

A `?` key overlay showing all available shortcuts, grouped by category. Inspired by OpenCode's keybind display system.

- [ ] **Step 1: Create the KeybindHelp overlay**

```tsx
// dashboard/src/components/ui/KeybindHelp.tsx
import { useState, useEffect } from 'react';

interface ShortcutGroup {
  category: string;
  shortcuts: Array<{ keys: string; label: string }>;
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    category: 'Panels',
    shortcuts: [
      { keys: 'Ctrl+B', label: 'Toggle left sidebar' },
      { keys: 'Ctrl+J', label: 'Toggle context panel' },
      { keys: 'Ctrl+`', label: 'Toggle bottom log' },
    ],
  },
  {
    category: 'Navigation',
    shortcuts: [
      { keys: 'Ctrl+K', label: 'Command palette' },
      { keys: 'g s', label: 'Go to Summary' },
      { keys: 'g g', label: 'Go to GPUs' },
      { keys: 'g m', label: 'Go to Models' },
      { keys: 'g i', label: 'Go to Inference' },
      { keys: 'g t', label: 'Go to Terminal' },
      { keys: 'g c', label: 'Go to Chat' },
      { keys: 'g a', label: 'Go to Alerts' },
      { keys: 'g x', label: 'Go to Settings' },
    ],
  },
  {
    category: 'Slash Commands',
    shortcuts: [
      { keys: '/models', label: 'Jump to models' },
      { keys: '/nodes', label: 'Jump to summary' },
      { keys: '/alerts', label: 'Jump to alerts' },
      { keys: '/flight', label: 'Jump to flight sheets' },
      { keys: '/theme', label: 'Open theme picker' },
    ],
  },
];

export function KeybindHelp() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={() => setOpen(false)}
    >
      <div
        className="w-[560px] max-h-[70vh] rounded-xl overflow-hidden"
        style={{
          background: 'rgba(14,18,28,0.95)',
          border: '1px solid rgba(0,255,255,0.12)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-5 py-3"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
            Keyboard Shortcuts
          </span>
          <span className="text-[9px] font-mono" style={{ color: 'var(--text-dim)' }}>
            press ? or Esc to close
          </span>
        </div>

        <div className="overflow-y-auto px-5 py-3" style={{ maxHeight: 'calc(70vh - 48px)' }}>
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.category} className="mb-4">
              <div
                className="text-[9px] uppercase tracking-[2px] mb-2"
                style={{ color: 'var(--cyan)' }}
              >
                {group.category}
              </div>
              <div className="flex flex-col gap-1">
                {group.shortcuts.map((s) => (
                  <div key={s.keys} className="flex items-center justify-between py-0.5">
                    <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                      {s.label}
                    </span>
                    <kbd
                      className="text-[9px] font-mono px-1.5 py-0.5 rounded"
                      style={{
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.08)',
                        color: 'var(--text-muted)',
                      }}
                    >
                      {s.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add KeybindHelp to App.tsx**

In the `Dashboard` component in `App.tsx`, add after `<CommandPalette />`:

```tsx
import { KeybindHelp } from '@/components/ui/KeybindHelp';
// ...
<CommandPalette />
<KeybindHelp />
```

- [ ] **Step 3: Verify compile and test**

Run: `cd F:/tentaclaw-os && npx tsc --noEmit --project dashboard/tsconfig.json 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/components/ui/KeybindHelp.tsx dashboard/src/App.tsx
git commit -m "feat(dashboard): add keyboard shortcut help overlay (press ? to open)"
```

---

### Task 12: Responsive Breakpoints

**Files:**
- Modify: `dashboard/src/components/layout/PanelLayout.tsx`

Inspired by OpenCode's responsive sidebar (auto-hides below 120 chars). Auto-collapse panels on narrow viewports.

- [ ] **Step 1: Add responsive breakpoint logic to PanelLayout**

Add a `useEffect` to `PanelLayout` that watches `window.innerWidth` and auto-collapses panels:

```tsx
import { useEffect } from 'react';

// Inside PanelLayout component:
const leftCollapsed = usePanelsStore((s) => s.leftSidebarCollapsed);
const rightCollapsed = usePanelsStore((s) => s.rightSidebarCollapsed);

useEffect(() => {
  function handleResize() {
    const w = window.innerWidth;
    const store = usePanelsStore.getState();

    // Below 1200px: auto-collapse right sidebar
    if (w < 1200 && !store.rightSidebarCollapsed) {
      usePanelsStore.setState({ rightSidebarCollapsed: true });
    }

    // Below 900px: also collapse left sidebar
    if (w < 900 && !store.leftSidebarCollapsed) {
      usePanelsStore.setState({ leftSidebarCollapsed: true });
    }
  }

  // Run once on mount
  handleResize();

  window.addEventListener('resize', handleResize);
  return () => window.removeEventListener('resize', handleResize);
}, []);
```

- [ ] **Step 2: Verify compile**

Run: `cd F:/tentaclaw-os && npx tsc --noEmit --project dashboard/tsconfig.json 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/components/layout/PanelLayout.tsx
git commit -m "feat(dashboard): auto-collapse panels on narrow viewports"
```

---

## Feature Mapping: OpenCode → TentaCLAW

| OpenCode Feature | TentaCLAW Implementation | Task |
|---|---|---|
| Right sidebar (42-char fixed) | Right sidebar (resizable, collapsible) | 3 |
| TODO list (sidebar plugin) | TodoTracker (localStorage persistence) | 4 |
| Status bar footer (LSP/MCP counts) | StatusBar (cluster stats, tok/s, alerts) | 5 |
| Leader key sequences (`<leader>l`) | `g s`, `g m` etc via useKeybinds | 6 |
| Command palette (fuzzy, slash cmds) | Enhanced CommandPalette with fuzzy + `/` cmds | 7 |
| Responsive sidebar (auto-hide <120) | Auto-collapse at viewport breakpoints | 12 |
| 30+ JSON themes | 8 built-in themes with CSS variable engine | 9 |
| Resizable split panes | useResizable + ResizeHandle on all panels | 1, 8 |
| Collapsible sections (sidebar) | CollapsibleSection in RightSidebar | 3 |
| Plugin slot system (sidebar_content) | Not ported — TentaCLAW uses direct composition (simpler, appropriate for scope) | — |
| OpenTUI / Solid.js TUI renderer | Not ported — TentaCLAW stays React web dashboard (different platform) | — |
| Session threading / timeline | Not ported — no concept of AI coding sessions in TentaCLAW | — |

## Ideas Not Ported (and Why)

- **OpenTUI framework**: OpenCode's custom Solid.js terminal renderer is deeply specialized for CLI apps. TentaCLAW's React web dashboard is the right abstraction for an ops dashboard with rich data viz, xterm.js, and charts.
- **Plugin slot system**: OpenCode uses a dynamic plugin slot architecture (`sidebar_content`, `sidebar_title`) for extensibility. TentaCLAW's dashboard is a single product, not a platform — direct component composition is clearer.
- **Session forking/timeline**: OpenCode's ability to fork a conversation at any message and branch the timeline is deeply tied to AI coding sessions. TentaCLAW has no equivalent concept.
- **Diff viewer**: OpenCode's split/unified diff viewer is for code review. TentaCLAW's diff needs are covered by the terminal tab.
- **PTY emulation**: OpenCode runs a pseudo-terminal for shell access. TentaCLAW already has xterm.js in the Terminal tab — same result via a different implementation.
