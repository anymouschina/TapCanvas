export type FrameSample = {
  url: string
  time: number
  blob: Blob | null
  remoteUrl?: string | null
  description?: string | null
  describing?: boolean
}

export type CharacterCard = {
  id: string
  name: string
  summary?: string
  tags?: string[]
  frames: Array<{ time: number; desc: string }>
  startFrame?: { time: number; url: string }
  endFrame?: { time: number; url: string }
  clipRange?: { start: number; end: number }
}
