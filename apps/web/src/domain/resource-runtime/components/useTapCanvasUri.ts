import { useState, useEffect } from 'react'
import { API_BASE } from '../../../api/server'

const cache = new Map<string, string>()

export function useTapCanvasUri(uri: string | null | undefined): string | null {
  const [cdnUrl, setCdnUrl] = useState<string | null>(() => {
    if (!uri) return null
    if (!uri.startsWith('tapcanvas://')) return uri
    return cache.get(uri) ?? null
  })

  useEffect(() => {
    if (!uri || !uri.startsWith('tapcanvas://')) {
      setCdnUrl(uri ?? null)
      return
    }
    if (cache.has(uri)) {
      setCdnUrl(cache.get(uri)!)
      return
    }
    let cancelled = false
    fetch(`${API_BASE}/resolve?uri=${encodeURIComponent(uri)}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((data: { cdnUrl?: string }) => {
        if (cancelled || !data.cdnUrl) return
        cache.set(uri, data.cdnUrl)
        setCdnUrl(data.cdnUrl)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [uri])

  return cdnUrl
}
