import { create } from 'zustand';
import type { ResourceSelection, TabId } from '@/lib/types';

interface UIState {
  selectedResource: ResourceSelection;
  activeTab: TabId;
  sidebarCollapsed: boolean;

  selectResource: (r: ResourceSelection) => void;
  setActiveTab: (t: TabId) => void;
  toggleSidebar: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  selectedResource: { type: 'cluster', id: 'root' },
  activeTab: 'summary',
  sidebarCollapsed: false,

  selectResource: (r) => set({ selectedResource: r, activeTab: 'summary' }),
  setActiveTab: (t) => set({ activeTab: t }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
}));
