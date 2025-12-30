export type FrameSample = {
  url: string
  time: number
  blob: Blob | null
  remoteUrl?: string | null
  description?: string | null
  describing?: boolean
}
