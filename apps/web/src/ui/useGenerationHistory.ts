import React from 'react'

import { listServerAssets, type ServerAssetDto } from '../api/server'
import {
  buildGenerationHistoryItems,
  buildGenerationHistoryListInput,
  GENERATION_HISTORY_PAGE_SIZE,
  type GenerationHistoryItem,
} from './generationHistory'
import { ASSET_REFRESH_EVENT } from './assetEvents'

type GenerationHistoryState = {
  items: GenerationHistoryItem[]
  loading: boolean
  loadingMore: boolean
  error: string
  hasMore: boolean
  reload: () => void
  loadMore: () => void
}

export function useGenerationHistory(enabled: boolean): GenerationHistoryState {
  const requestIdRef = React.useRef(0)
  const [assets, setAssets] = React.useState<ServerAssetDto[]>([])
  const [cursor, setCursor] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [loadingMore, setLoadingMore] = React.useState(false)
  const [error, setError] = React.useState('')

  const loadPage = React.useCallback(async (pageCursor: string | null, append: boolean): Promise<void> => {
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId

    if (append) setLoadingMore(true)
    else setLoading(true)
    setError('')

    try {
      const response = await listServerAssets(buildGenerationHistoryListInput(pageCursor))
      if (requestIdRef.current !== requestId) return
      setAssets((current) => {
        if (!append) return response.items
        const knownIds = new Set(current.map((asset) => asset.id))
        return current.concat(response.items.filter((asset) => !knownIds.has(asset.id)))
      })
      setCursor(response.items.length === GENERATION_HISTORY_PAGE_SIZE ? response.cursor : null)
    } catch (loadError: unknown) {
      if (requestIdRef.current !== requestId) return
      if (!append) {
        setAssets([])
        setCursor(null)
      }
      setError(loadError instanceof Error && loadError.message.trim()
        ? loadError.message
        : '生成历史加载失败')
    } finally {
      if (requestIdRef.current === requestId) {
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }, [])

  React.useEffect(() => {
    if (!enabled) {
      requestIdRef.current += 1
      return
    }
    void loadPage(null, false)
  }, [enabled, loadPage])

  React.useEffect(() => {
    if (!enabled || typeof window === 'undefined') return
    const reloadOnAssetChange = (): void => {
      void loadPage(null, false)
    }
    window.addEventListener(ASSET_REFRESH_EVENT, reloadOnAssetChange)
    return () => window.removeEventListener(ASSET_REFRESH_EVENT, reloadOnAssetChange)
  }, [enabled, loadPage])

  const items = React.useMemo(() => buildGenerationHistoryItems(assets), [assets])
  const reload = React.useCallback((): void => {
    void loadPage(null, false)
  }, [loadPage])
  const loadMore = React.useCallback((): void => {
    if (!cursor || loadingMore) return
    void loadPage(cursor, true)
  }, [cursor, loadPage, loadingMore])

  return {
    items,
    loading,
    loadingMore,
    error,
    hasMore: Boolean(cursor),
    reload,
    loadMore,
  }
}
