import React from 'react'
import {
  composeVideosToBlob,
  type ComposeAudioTrack,
  type ComposePhase,
  type ComposeSubtitlesInput,
  type ComposeVideoSource,
} from './composeVideosCore'

export type { ComposeVideoSource } from './composeVideosCore'

const INITIAL_PHASE: ComposePhase = 'preparing'

export function useVideoCompose() {
  const [composing, setComposing] = React.useState(false)
  const [progress, setProgress] = React.useState(0)
  const [phase, setPhase] = React.useState<ComposePhase>(INITIAL_PHASE)
  const [error, setError] = React.useState<string | null>(null)
  const abortRef = React.useRef<AbortController | null>(null)

  React.useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  const compose = React.useCallback(async (
    videos: ComposeVideoSource[],
    options?: { audioTracks?: ComposeAudioTrack[]; subtitles?: ComposeSubtitlesInput },
  ): Promise<Blob | null> => {
    if (videos.length < 1) {
      setError('至少需要 1 个可用视频才能开始剪辑')
      return null
    }

    abortRef.current?.abort()
    const abortCtrl = new AbortController()
    abortRef.current = abortCtrl

    setComposing(true)
    setProgress(0)
    setPhase(INITIAL_PHASE)
    setError(null)

    try {
      return await composeVideosToBlob(videos, {
        signal: abortCtrl.signal,
        onProgress: (p) => setProgress(p),
        onPhase: setPhase,
        audioTracks: options?.audioTracks,
        subtitles: options?.subtitles,
      })
    } catch (err: unknown) {
      if (!abortCtrl.signal.aborted) {
        setError(err instanceof Error ? err.message : '合成失败')
      }
      return null
    } finally {
      setComposing(false)
    }
  }, [])

  const cancel = React.useCallback(() => {
    abortRef.current?.abort()
  }, [])

  return { compose, cancel, composing, progress, phase, error }
}
