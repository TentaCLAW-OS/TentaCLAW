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
