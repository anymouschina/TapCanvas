import React from 'react'
import type {
  ResourceKind,
  ResourceOwnerSurface,
  ResourcePriority,
  ResourceRequestedSize,
  ResourceVariantKey,
} from '../model/resourceTypes'
import { useImageResource } from '../hooks/useImageResource'
import { useViewportVisibility } from '../hooks/useViewportVisibility'
import { resourceManager } from '../services/resourceManager'
import { useResourceRuntimeStore } from '../store/resourceRuntimeStore'
import { useTapCanvasUri } from './useTapCanvasUri'

// Synchronously read a cached, already-decoded renderUrl from the runtime store
// so first paint can skip the loading skeleton when the same URL was acquired
// elsewhere (other node, preview modal, asset panel, etc.).
function readCachedRenderUrl(
  url: string,
  kind: ResourceKind,
  variantKey: ResourceVariantKey | undefined,
  requestedSize: Partial<ResourceRequestedSize> | undefined,
): string {
  if (!url) return ''
  const id = resourceManager.buildResourceId({
    url,
    kind,
    variantKey,
    requestedSize,
  })
  if (!id) return ''
  const entry = useResourceRuntimeStore.getState().imageEntries[id]
  return entry?.decoded?.renderUrl ?? ''
}

const TRANSPARENT_PIXEL_DATA_URL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='

function resolveViewportMargin(priority: ResourcePriority): string {
  if (priority === 'critical') return '640px'
  if (priority === 'visible') return '360px'
  if (priority === 'prefetch') return '240px'
  return '120px'
}

type ManagedImageProps = {
  className: string
  src: string
  alt: string
  kind?: ResourceKind
  variantKey?: ResourceVariantKey
  priority?: ResourcePriority
  ownerNodeId?: string | null
  ownerSurface?: ResourceOwnerSurface
  ownerRequestKey?: string
  requestedSize?: Partial<ResourceRequestedSize>
  loading?: 'eager' | 'lazy'
  decoding?: 'sync' | 'async' | 'auto'
  fetchPriority?: 'high' | 'low' | 'auto'
  referrerPolicy?: React.ImgHTMLAttributes<HTMLImageElement>['referrerPolicy']
  crossOrigin?: React.ImgHTMLAttributes<HTMLImageElement>['crossOrigin']
  draggable?: boolean
  style?: React.CSSProperties
  onLoad?: React.ReactEventHandler<HTMLImageElement>
  onError?: React.ReactEventHandler<HTMLImageElement>
  onDragStart?: React.DragEventHandler<HTMLImageElement>
  onMouseDown?: React.MouseEventHandler<HTMLImageElement>
  onPointerDown?: React.PointerEventHandler<HTMLImageElement>
  onClick?: React.MouseEventHandler<HTMLDivElement>
}

export function ManagedImage(props: ManagedImageProps) {
  const {
    className,
    src,
    alt,
    kind = 'image',
    variantKey,
    priority = 'visible',
    ownerNodeId = null,
    ownerSurface,
    ownerRequestKey,
    requestedSize,
    loading = 'lazy',
    decoding = 'async',
    fetchPriority = 'low',
    referrerPolicy = 'no-referrer',
    // No default crossOrigin: historical transformed URLs may not return CORS
    // headers. Callers that genuinely need CORS (for example canvas drawImage
    // during export) must pass it explicitly.
    crossOrigin,
    draggable = false,
    style,
    onLoad,
    onError,
    onDragStart,
    onMouseDown,
    onPointerDown,
    onClick,
  } = props

  const resolvedSrc = useTapCanvasUri(src) ?? src
  const stableRequestedSize = React.useMemo<Partial<ResourceRequestedSize> | undefined>(() => {
    if (!requestedSize) return undefined
    return {
      width: requestedSize.width,
      height: requestedSize.height,
      dpr: requestedSize.dpr,
      fit: requestedSize.fit,
    }
  }, [requestedSize?.dpr, requestedSize?.fit, requestedSize?.height, requestedSize?.width])

  // critical 优先级 = 必须立即加载，不能被浏览器原生 lazy 延迟。实测根因：面板右侧的 critical
  // 图片 <img> 仍带 loading="lazy"，浏览器判它离屏就推迟加载 → 一直 skeleton、无网络请求、
  // 重开命中缓存才出图、刷新又被推迟。critical 一律 eager + fetchpriority high。
  const resolvedLoading: 'eager' | 'lazy' = priority === 'critical' ? 'eager' : loading
  const resolvedFetchPriority: 'high' | 'low' | 'auto' =
    priority === 'critical' ? 'high' : fetchPriority

  const visibilityGate = useViewportVisibility<HTMLImageElement>({
    enabled: Boolean(resolvedSrc),
    rootMargin: resolveViewportMargin(priority),
    freezeOnceVisible: true,
  })
  const bindImageRef = React.useCallback((node: HTMLImageElement | null) => {
    const refTarget = visibilityGate.ref as React.MutableRefObject<HTMLImageElement | null>
    refTarget.current = node
    if (!node) return
    node.setAttribute('fetchpriority', resolvedFetchPriority)
  }, [resolvedFetchPriority, visibilityGate.ref])

  const resourceEnabled = Boolean(resolvedSrc)
    && (priority === 'critical' || visibilityGate.isVisible)
  const resource = useImageResource({
    url: resolvedSrc,
    kind,
    variantKey,
    priority,
    enabled: resourceEnabled,
    ownerNodeId,
    ownerSurface,
    ownerRequestKey,
    requestedSize: stableRequestedSize,
  })

  // ── Chain-layer rendering (TapNow-style):
  // Each new URL gets a fresh <img> element appended to a layer chain. New
  // layers stack on top via increasing z-index. While a new layer is still
  // loading, it paints transparent — so the user keeps seeing the previous
  // layer underneath. Once a layer's onLoad fires, all earlier layers are
  // unmounted (they're already visually covered, so removal is invisible).
  //
  // Why this matters: the alternative — keeping one <img> and swapping its
  // `src` attribute — incurs a re-fetch IPC even on cache hits, plus a
  // single-frame window where the browser may paint nothing while it figures
  // out whether to keep old pixels. Mounting a fresh element sidesteps both
  // by letting the new img paint independently and only removing the old
  // after the new is fully on screen.
  type Layer = { key: number; url: string }
  const initialCachedUrl = React.useMemo(
    () => readCachedRenderUrl(resolvedSrc, kind, variantKey, stableRequestedSize),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  const layerKeyRef = React.useRef(1)
  const [layers, setLayers] = React.useState<Layer[]>(
    () => (initialCachedUrl ? [{ key: 0, url: initialCachedUrl }] : []),
  )
  // Keys of layers whose <img> has finished DECODING (not merely loading). A
  // newly appended top layer stays transparent until it is decoded, so the
  // flip-to-visible composites an already-decoded bitmap instead of forcing a
  // synchronous decode on the compositor — the paint-time jank TapNow avoids
  // with `img.decode()`. Single-track by construction: we reuse the SAME single
  // <img> decode and only gate WHEN the layer is revealed; nothing decodes twice
  // and no worker/bitmap second path is introduced.
  const [decodedKeys, setDecodedKeys] = React.useState<Set<number>>(() => new Set())

  const mainRenderUrl = resource.renderUrl || ''

  const appendLayer = React.useCallback((url: string) => {
    if (!url) return
    const nextLayer: Layer = { key: layerKeyRef.current++, url }
    setLayers((prev) => {
      // Every state transition re-checks the live tail. Multiple effects used
      // to compare against render-time snapshots and could concurrently append
      // the same direct URL, producing two stacked <img> elements for one
      // logical image.
      if (prev[prev.length - 1]?.url === url) return prev
      return [...prev, nextLayer].slice(-3)
    })
  }, [])

  // Direct-url transport resolves to the source URL, so reconcile source,
  // cache, and resource readiness through one state transition. This keeps the
  // previous successfully painted layer during a real src change without
  // letting three independent effects race to append the same URL.
  React.useEffect(() => {
    if (resource.state === 'failed') return
    const nextRenderUrl = mainRenderUrl || (resourceEnabled ? resolvedSrc : '')
    appendLayer(nextRenderUrl)
  }, [appendLayer, mainRenderUrl, resolvedSrc, resource.state, resourceEnabled])

  // Mark a layer decoded → reveal it and prune everything beneath (they're now
  // covered by decoded pixels). Also backfill natural size into the store.
  const markLayerDecoded = React.useCallback(
    (key: number, target: HTMLImageElement | null) => {
      setDecodedKeys((prev) => {
        if (prev.has(key)) return prev
        const next = new Set(prev)
        next.add(key)
        return next
      })
      setLayers((prev) => {
        const idx = prev.findIndex((l) => l.key === key)
        if (idx <= 0) return prev
        return prev.slice(idx)
      })
      if (target && resource.id && target.naturalWidth && target.naturalHeight) {
        resourceManager.recordDecodedSize(resource.id, target.naturalWidth, target.naturalHeight)
      }
    },
    [resource.id],
  )
  const handleLayerLoaded = React.useCallback(
    (key: number, ev: React.SyntheticEvent<HTMLImageElement>) => {
      const target = ev.currentTarget
      // Gate reveal on DECODE completion, not just load. img.decode() shares the
      // browser's single decode of this URL (it does not decode a second time) —
      // it just lets us defer the reveal until the bitmap is ready so the flip
      // never stalls the compositor. Fall back to revealing on decode failure /
      // unsupported browser so we never strand pixels.
      if (typeof target.decode === 'function') {
        void target.decode().then(
          () => markLayerDecoded(key, target),
          () => markLayerDecoded(key, target),
        )
      } else {
        markLayerDecoded(key, target)
      }
      if (onLoad) onLoad(ev)
    },
    [markLayerDecoded, onLoad],
  )
  const handleLayerError = React.useCallback(
    (key: number, failedRenderUrl: string, ev: React.SyntheticEvent<HTMLImageElement>) => {
      // The resource manager's direct-url hand-off cannot observe native img
      // decode/attach failures itself. Report the failure before removing the
      // layer so the same URL is not immediately reconciled back into the DOM.
      if (failedRenderUrl === resolvedSrc || failedRenderUrl === mainRenderUrl) {
        resourceManager.reportImageElementFailure(resource.id, failedRenderUrl)
      }
      // Drop only this layer; lower layers stay visible as fallback. Caller's
      // onError fires only if no layer remains (true "no pixels at all").
      const wasOnlyLayer = layers.length === 1 && layers[0]?.key === key
      setLayers((prev) => {
        const next = prev.filter((l) => l.key !== key)
        return next
      })
      if (wasOnlyLayer && onError) onError(ev)
    },
    [layers, mainRenderUrl, onError, resolvedSrc, resource.id],
  )

  // Drop decoded-keys for layers that have been pruned so the Set stays bounded.
  React.useEffect(() => {
    setDecodedKeys((prev) => {
      if (prev.size === 0) return prev
      const live = new Set(layers.map((l) => l.key))
      let stale = false
      for (const k of prev) if (!live.has(k)) { stale = true; break }
      if (!stale) return prev
      const next = new Set<number>()
      for (const k of prev) if (live.has(k)) next.add(k)
      return next
    })
  }, [layers])

  // Skeleton class kept for back-compat (CSS still references it), but only
  // applied when we have nothing at all to show.
  const isLoading = Boolean(src) && layers.length === 0 && resource.state !== 'failed'

  const wrapperClassName = [
    'tc-managed-image-wrap',
    isLoading ? 'tc-managed-image-wrap--loading' : '',
    className,
  ].filter(Boolean).join(' ')

  const sharedImgStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    objectFit: 'inherit',
    position: 'absolute',
    inset: 0,
  }

  // Bind the resource-runtime visibility / fetchpriority ref to the topmost
  // layer (the one the user actually sees). When a new layer is added, the
  // ref naturally rebinds to it on the next commit.
  const topLayerIdx = layers.length - 1

  return (
    // isolation:isolate（2026-07-17 根治「视频只有声音、画面永远是封面」）：渐进清晰度多层 img 的
    // zIndex(idx+1) 只该管内部层序，wrapper 不建层叠上下文时这些 z-index 会泄漏到外层——把 DOM
    // 顺序在其后的兄弟元素（如视频壳的透明 <video>，z-index auto=0）整个盖住：视频正常播、帧正常
    // 合成，用户只看得到海报。isolate 把内层 z-index 关进 wrapper 自己的上下文，外部回归 DOM 顺序。
    // 调用方显式传 style.isolation 时以调用方为准。
    <div className={wrapperClassName} style={{ isolation: 'isolate', ...style }} onClick={onClick}>
      {layers.length === 0 && (
        <img
          ref={bindImageRef}
          className="tc-managed-image"
          crossOrigin={crossOrigin}
          src={TRANSPARENT_PIXEL_DATA_URL}
          alt={alt}
          draggable={draggable}
          loading={resolvedLoading}
          decoding={decoding}
          referrerPolicy={referrerPolicy}
          data-src={src || undefined}
          style={{ ...sharedImgStyle, opacity: 0 }}
        />
      )}
      {layers.map((layer, idx) => {
        const isTop = idx === topLayerIdx
        // Reveal a layer only once it is decoded — EXCEPT the bottom layer
        // (idx 0), which has nothing beneath it to fall back to and must paint
        // ASAP to avoid a blank/skeleton flash. Non-revealed top layers stay
        // mounted at opacity 0 so the browser loads+decodes them off the paint
        // path; the flip to visible then composites a ready bitmap.
        const revealed = idx === 0 || decodedKeys.has(layer.key)
        return (
          <img
            key={layer.key}
            ref={isTop ? bindImageRef : undefined}
            className="tc-managed-image"
            crossOrigin={crossOrigin}
            src={layer.url}
            alt={isTop ? alt : ''}
            aria-hidden={isTop ? undefined : true}
            draggable={isTop ? draggable : false}
            loading={resolvedLoading}
            decoding={decoding}
            referrerPolicy={referrerPolicy}
            data-src={isTop ? (src || undefined) : undefined}
            style={{
              ...sharedImgStyle,
              zIndex: idx + 1,
              opacity: revealed ? 1 : 0,
              pointerEvents: isTop ? 'auto' : 'none',
            }}
            onLoad={(ev) => handleLayerLoaded(layer.key, ev)}
            onError={(ev) => handleLayerError(layer.key, layer.url, ev)}
            onDragStart={isTop ? onDragStart : undefined}
            onMouseDown={isTop ? onMouseDown : undefined}
            onPointerDown={isTop ? onPointerDown : undefined}
          />
        )
      })}
    </div>
  )
}
