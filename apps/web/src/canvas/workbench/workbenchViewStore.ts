import { create } from 'zustand'

export type CanvasWorkspaceView = 'canvas' | 'workbench'

export const useWorkbenchViewStore = create<{
  view: CanvasWorkspaceView
  setView: (view: CanvasWorkspaceView) => void
}>((set) => ({
  view: 'canvas',
  setView: (view) => set({ view }),
}))
