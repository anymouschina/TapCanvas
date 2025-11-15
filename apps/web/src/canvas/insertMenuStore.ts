import { create } from 'zustand'

type InsertMenuPayload = {
  x: number
  y: number
  edgeId?: string
  fromNodeId?: string
  fromHandle?: string | null
}

type InsertMenuState = {
  open: boolean
  x: number
  y: number
  edgeId?: string
  fromNodeId?: string
  fromHandle?: string | null
  openMenu: (p: InsertMenuPayload) => void
  closeMenu: () => void
}

export const useInsertMenuStore = create<InsertMenuState>((set) => ({
  open: false,
  x: 0,
  y: 0,
  edgeId: undefined,
  fromNodeId: undefined,
  fromHandle: null,
  openMenu: (p) =>
    set({
      open: true,
      x: p.x,
      y: p.y,
      edgeId: p.edgeId,
      fromNodeId: p.fromNodeId,
      fromHandle: p.fromHandle ?? null,
    }),
  closeMenu: () =>
    set({
      open: false,
      edgeId: undefined,
      fromNodeId: undefined,
      fromHandle: null,
    }),
}))

