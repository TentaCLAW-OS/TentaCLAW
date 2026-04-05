import { create } from 'zustand';
import { THEMES } from '@/lib/themes';
import type { ThemeDefinition } from '@/lib/types';

interface ThemeState {
  activeThemeId: string;
  activeTheme: ThemeDefinition;
  setTheme: (id: string) => void;
}

function loadSavedTheme(): string {
  if (typeof window === 'undefined') return 'tentaclaw-dark';
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
// Apply immediately on load (only in browser)
if (typeof window !== 'undefined') {
  applyTheme(initialTheme);
}

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
