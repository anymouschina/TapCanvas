import { create } from 'zustand'

export type CursorPresence = {
  userId: string
  name: string
  x: number  // flow coordinates
  y: number
  updatedAt: number
}

type PresenceState = {
  cursors: Map<string, CursorPresence>
  sendCursor: ((x: number, y: number) => void) | null
  _setCursor: (userId: string, name: string, x: number, y: number) => void
  _removeCursor: (userId: string) => void
  _setSendCursor: (fn: ((x: number, y: number) => void) | null) => void
  _clearAll: () => void
}

export const usePresenceStore = create<PresenceState>((set) => ({
  cursors: new Map(),
  sendCursor: null,
  _setCursor: (userId, name, x, y) =>
    set((s) => {
      const next = new Map(s.cursors)
      next.set(userId, { userId, name, x, y, updatedAt: Date.now() })
      return { cursors: next }
    }),
  _removeCursor: (userId) =>
    set((s) => {
      const next = new Map(s.cursors)
      next.delete(userId)
      return { cursors: next }
    }),
  _setSendCursor: (fn) => set({ sendCursor: fn }),
  _clearAll: () => set({ cursors: new Map(), sendCursor: null }),
}))
