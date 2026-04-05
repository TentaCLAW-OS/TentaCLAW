import { create } from 'zustand';

interface DragState {
  dragging: boolean;
  dragData: { type: 'model'; model: string } | null;
  dropTarget: string | null; // node ID being hovered

  startDrag: (model: string) => void;
  setDropTarget: (nodeId: string | null) => void;
  endDrag: () => void;
}

export const useDragStore = create<DragState>((set) => ({
  dragging: false,
  dragData: null,
  dropTarget: null,

  startDrag: (model) => set({ dragging: true, dragData: { type: 'model', model } }),
  setDropTarget: (nodeId) => set({ dropTarget: nodeId }),
  endDrag: () => set({ dragging: false, dragData: null, dropTarget: null }),
}));
