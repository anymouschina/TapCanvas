import React from 'react'
import { nanoid } from 'nanoid'
import { API_BASE, uploadServerAssetFile } from '../api/server'
import { useAuth } from '../auth/store'
import { toast } from './toast'
import { useUIStore } from './uiStore'
import { WebCutVideoEditModal } from './WebCutVideoEditModal'

function isLocalWebCutBase(baseUrl: string): boolean {
  try {
    const u = new URL(baseUrl)
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1'
  } catch {
    return false
  }
}

function buildProxyVideoUrl(rawVideoUrl: string, webCutBaseUrl: string): string {
  // Local WebCut dev server can proxy `/assets/*` to API_BASE, so use relative path to keep auth/cookies simple.
  if (isLocalWebCutBase(webCutBaseUrl)) {
    return `/assets/proxy-video?url=${encodeURIComponent(rawVideoUrl)}`
  }

  const base = (API_BASE || '').trim()
  if (!base) return rawVideoUrl
  return `${base.replace(/\/+$/, '')}/assets/proxy-video?url=${encodeURIComponent(rawVideoUrl)}`
}

function buildWebCutEmbedUrl(input: {
  baseUrl: string
  requestId: string
  videoUrl: string
  tapToken?: string | null
}): string {
  const base = input.baseUrl.trim().replace(/\/+$/, '')
  const url = new URL(base)
  url.searchParams.set('embed', '1')
  url.searchParams.set('mode', 'clip')
  url.searchParams.set('requestId', input.requestId)
  url.searchParams.set('videoUrl', input.videoUrl)
  url.searchParams.set('parentOrigin', typeof window !== 'undefined' ? window.location.origin : '')
  if (input.tapToken) {
    url.searchParams.set('tap_token', input.tapToken)
  }
  return url.toString()
}

function inferOrigin(urlStr: string): string | null {
  try {
    return new URL(urlStr).origin
  } catch {
    return null
  }
}

type WebCutExportMessage = {
  type: 'webcut:export'
  requestId: string
  mime: string
  filename?: string
  buffer: ArrayBuffer
}

export function WebCutVideoEditModalHost(): JSX.Element | null {
  const { open, payload } = useUIStore((s) => s.webcutVideoEditModal)
  const close = useUIStore((s) => s.closeWebCutVideoEditModal)
  const token = useAuth((s) => s.token)
  const [loading, setLoading] = React.useState(false)

  const requestId = React.useMemo(() => (open ? nanoid() : ''), [open])
  const baseUrl = import.meta.env.VITE_WEBCUT_URL || import.meta.env.VITE_WEBCUT_APP_URL || import.meta.env.DEV ? 'http://localhost:5174' : 'https://webcut.beqlee.icu/'
  const iframeSrc = React.useMemo(() => {
    if (!open || !payload) return ''
    const proxiedVideoUrl = buildProxyVideoUrl(payload.videoUrl, baseUrl)
    return buildWebCutEmbedUrl({
      baseUrl,
      requestId,
      videoUrl: proxiedVideoUrl,
      tapToken: token || (typeof localStorage !== 'undefined' ? localStorage.getItem('tap_token') : null),
    })
  }, [baseUrl, open, payload, requestId, token])

  const expectedOrigin = React.useMemo(() => inferOrigin(iframeSrc), [iframeSrc])

  const handleClose = React.useCallback(() => {
    if (loading) return
    payload?.onClose?.()
    close()
  }, [close, loading, payload])

  React.useEffect(() => {
    if (!open || !payload) return
    if (!requestId) return

    const onMessage = async (e: MessageEvent) => {
      const raw = e.data as any
      if (!raw || typeof raw !== 'object') return
      if (raw.requestId !== requestId) return
      if (expectedOrigin && e.origin !== expectedOrigin) return
      if (raw.type === 'webcut:cancel') {
        close()
        return
      }

      const data = raw as WebCutExportMessage
      if (data.type !== 'webcut:export') return
      if (!(data.buffer instanceof ArrayBuffer)) return
      if (data.mime !== 'video/mp4') return

      const fileBase = (payload.videoTitle || 'clip').trim() || 'clip'
      const filename = `${fileBase}.mp4`

      setLoading(true)
      try {
        const file = new File([data.buffer], filename, { type: 'video/mp4' })
        const asset = await uploadServerAssetFile(file, filename)
        const nextUrl = typeof asset?.data?.url === 'string' ? asset.data.url.trim() : ''
        if (!nextUrl) throw new Error('上传成功但未返回可用的 url')
        const nextThumb = typeof asset?.data?.thumbnailUrl === 'string' ? asset.data.thumbnailUrl : null
        await payload.onApply({ url: nextUrl, thumbnailUrl: nextThumb, assetId: asset.id })
        toast('已应用 WebCut 剪辑结果', 'success')
        close()
      } catch (err: any) {
        const msg = typeof err?.message === 'string' ? err.message : '剪辑结果应用失败'
        toast(msg, 'error')
      } finally {
        setLoading(false)
      }
    }

    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [close, expectedOrigin, open, payload, requestId])

  if (!open || !payload) return null

  return (
    <WebCutVideoEditModal
      opened={open}
      iframeSrc={iframeSrc}
      loading={loading}
      onClose={handleClose}
    />
  )
}
