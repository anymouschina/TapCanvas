import { create } from 'zustand'
import type { VideoCompareSource } from './videoCompareSource'

export type VideoCompareSession =
  | { phase: 'idle' }
  | { phase: 'open'; source: VideoCompareSource; target: VideoCompareSource }

type VideoCompareStore = {
  session: VideoCompareSession
  openComparison: (source: VideoCompareSource, target: VideoCompareSource) => void
  close: () => void
}

const IDLE_SESSION: VideoCompareSession = { phase: 'idle' }

export const useVideoCompareStore = create<VideoCompareStore>((set) => ({
  session: IDLE_SESSION,
  openComparison: (source, target) => set({ session: { phase: 'open', source, target } }),
  close: () => set({ session: IDLE_SESSION }),
}))
