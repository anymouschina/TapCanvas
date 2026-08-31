import { useState, useEffect, useCallback } from 'react'
import { listLlmNodePresets, type LlmNodePresetDto } from '../api/server'
import {
  STYLE_REFERENCE_BASE_LIMIT,
  STYLE_REFERENCE_USER_LIMIT,
  inheritBaseStyleReferencesForUserPresets,
} from '../ui/styleReferenceFacets'

export type UseStylePresetsResult = {
  basePresets: LlmNodePresetDto[]
  userPresets: LlmNodePresetDto[]
  loading: boolean
  reload: () => void
}

export function useStylePresets(enabled: boolean = true): UseStylePresetsResult {
  const [basePresets, setBasePresets] = useState<LlmNodePresetDto[]>([])
  const [userPresets, setUserPresets] = useState<LlmNodePresetDto[]>([])
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    // enabled=false 时不拉取（如 Modal 未打开、只读画布）；未登录场景会 401
    if (!enabled) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    Promise.all([
      listLlmNodePresets({ type: 'image', scope: 'base', limit: STYLE_REFERENCE_BASE_LIMIT }),
      listLlmNodePresets({ type: 'image', scope: 'user', limit: STYLE_REFERENCE_USER_LIMIT }),
    ])
      .then(([nextBasePresets, nextUserPresets]) => {
        if (cancelled) return
        setBasePresets(nextBasePresets)
        setUserPresets(inheritBaseStyleReferencesForUserPresets({
          basePresets: nextBasePresets,
          userPresets: nextUserPresets,
        }))
      })
      .catch(console.error)
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [tick, enabled])

  const reload = useCallback(() => setTick((t) => t + 1), [])

  return { basePresets, userPresets, loading, reload }
}
