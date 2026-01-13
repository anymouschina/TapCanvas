import React from 'react'
import { setTapImageDragData } from '../../../dnd/setTapImageDragData'
import { useUIStore } from '../../../../ui/uiStore'
import { computeGridLayoutFromCount, sliceImageGridToObjectUrls } from '../../../../utils/imageGridSlicer'

type ImageResult = { url: string; title?: string }

type StoryboardImageContentProps = {
  nodeId: string
  nodeWidth: number
  nodeHeight: number
  variantsOpen: boolean
  variantsBaseWidth?: number | null
  variantsBaseHeight?: number | null
  imageResults: ImageResult[]
  imagePrimaryIndex: number
  primaryImageUrl: string | null
  storyboardCount: number
  onUpdateNodeData: (patch: Record<string, any>) => void
  showStateOverlay: boolean
  stateLabel: string | null
  nodeShellText: string
  darkCardShadow: string
  subtleOverlayBackground: string
  mediaOverlayText: string
  themeWhite: string
}

const dedupeByUrl = <T extends { url: string }>(items: T[]): T[] => {
  const seen = new Set<string>()
  const unique: T[] = []
  for (const item of items) {
    const url = typeof item?.url === 'string' ? item.url.trim() : ''
    if (!url || seen.has(url)) continue
    seen.add(url)
    unique.push({ ...item, url } as T)
  }
  return unique
}

const isShotTitle = (title: unknown) => typeof title === 'string' && title.trim().startsWith('镜头')

export function StoryboardImageContent(props: StoryboardImageContentProps) {
  const {
    nodeId,
    nodeWidth,
    nodeHeight,
    variantsOpen,
    variantsBaseWidth,
    variantsBaseHeight,
    imageResults,
    imagePrimaryIndex,
    primaryImageUrl,
    storyboardCount,
    onUpdateNodeData,
    showStateOverlay,
    stateLabel,
    nodeShellText,
    darkCardShadow,
    subtleOverlayBackground,
    mediaOverlayText,
    themeWhite,
  } = props

  const coverUrl = (primaryImageUrl || imageResults[imagePrimaryIndex]?.url || '').trim() || null
  const isDarkUi = nodeShellText === themeWhite
  const frameRadius = 18
  const frameBorderColor = isDarkUi ? 'rgba(255,255,255,0.12)' : 'rgba(15,23,42,0.12)'
  const frameBorderWidth = coverUrl ? 1 : 1.5
  const frameBorderStyle = coverUrl ? 'solid' : 'dashed'
  const frameBackground = isDarkUi
    ? 'linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))'
    : 'linear-gradient(135deg, rgba(255,255,255,0.88), rgba(255,255,255,0.72))'
  const normalizedCount = Math.max(4, Math.min(16, Math.floor(storyboardCount || 4)))

  const shotItems = React.useMemo(() => {
    const safe = Array.isArray(imageResults) ? imageResults : []
    const slice = safe.slice(Math.max(0, imagePrimaryIndex + 1))
    const shots = slice.filter((it) => isShotTitle((it as any)?.title)).slice(0, normalizedCount)
    if (shots.length) return dedupeByUrl(shots)
    const fallback = safe
      .filter((it) => it?.url && it.url !== coverUrl)
      .slice(0, normalizedCount)
    return dedupeByUrl(fallback)
  }, [coverUrl, imagePrimaryIndex, imageResults, normalizedCount])

  const shotCount = shotItems.length
  const canExpandFrames = !!coverUrl && normalizedCount > 0
  const hasVariants = canExpandFrames && shotCount > 0
  const isExpanded = canExpandFrames && !!variantsOpen
  const baseWidth = variantsBaseWidth ?? nodeWidth
  const baseHeight = variantsBaseHeight ?? nodeHeight
  const tileStyle = { width: baseWidth, height: baseHeight }

  const [cutFrames, setCutFrames] = React.useState<{ index: number; url: string }[]>([])
  const [cutStatus, setCutStatus] = React.useState<'idle' | 'running' | 'success' | 'error'>('idle')
  const [cutError, setCutError] = React.useState<string | null>(null)
  const [cutAttempt, setCutAttempt] = React.useState(0)
  const cutRevokeRef = React.useRef<null | (() => void)>(null)
  const cutKeyRef = React.useRef<string>('')
  const cutUnmountedRef = React.useRef(false)

  const resetCutFrames = React.useCallback(() => {
    if (cutRevokeRef.current) {
      cutRevokeRef.current()
      cutRevokeRef.current = null
    }
    setCutFrames([])
    setCutStatus('idle')
    setCutError(null)
  }, [])

  React.useEffect(() => {
    const key = `${coverUrl || ''}|${normalizedCount}`
    if (cutKeyRef.current && cutKeyRef.current !== key) {
      resetCutFrames()
    }
    cutKeyRef.current = key
  }, [coverUrl, normalizedCount, resetCutFrames])

  React.useEffect(() => {
    return () => {
      cutUnmountedRef.current = true
      if (cutRevokeRef.current) {
        cutRevokeRef.current()
        cutRevokeRef.current = null
      }
    }
  }, [])

  React.useEffect(() => {
    const requestKey = `${coverUrl || ''}|${normalizedCount}`
    if (!isExpanded) return
    if (!coverUrl) return
    if (showStateOverlay) return
    if (shotCount > 0) return
    if (cutStatus === 'running') return
    if (cutFrames.length > 0 && cutStatus === 'success' && cutKeyRef.current === requestKey) return

    setCutStatus('running')
    setCutError(null)

    const layout = computeGridLayoutFromCount(normalizedCount, { minCols: 2, maxCols: 4 })
    void sliceImageGridToObjectUrls(coverUrl, layout, normalizedCount, { mimeType: 'image/png' })
      .then(({ frames, revoke }) => {
        if (cutUnmountedRef.current) {
          revoke()
          return
        }
        if (cutKeyRef.current !== requestKey) {
          revoke()
          return
        }
        if (cutRevokeRef.current) {
          cutRevokeRef.current()
        }
        cutRevokeRef.current = revoke
        setCutFrames(frames.map((frame) => ({ index: frame.index, url: frame.objectUrl })))
        setCutStatus('success')
        cutKeyRef.current = requestKey
      })
      .catch((error) => {
        if (cutUnmountedRef.current) return
        if (cutKeyRef.current !== requestKey) return
        console.error('Failed to slice storyboard grid:', error)
        setCutStatus('error')
        setCutFrames([])
        const message = error instanceof Error ? error.message : '切割失败'
        setCutError(message)
      })
  }, [coverUrl, cutAttempt, cutFrames.length, cutStatus, isExpanded, normalizedCount, shotCount, showStateOverlay])

  const mediaStack = React.useMemo(() => {
    if (!coverUrl) return []
    const list = [{ url: coverUrl }, ...shotItems.map((it) => ({ url: it.url }))]
    return dedupeByUrl(list).slice(0, 3)
  }, [coverUrl, shotItems])

  const toggleVariants = React.useCallback(() => {
    if (!canExpandFrames) return
    if (variantsOpen) {
      onUpdateNodeData({ variantsOpen: false })
      return
    }
    onUpdateNodeData({
      variantsOpen: true,
      variantsBaseWidth: Math.max(72, Math.round(nodeWidth)),
      variantsBaseHeight: Math.max(54, Math.round(nodeHeight)),
    })
  }, [canExpandFrames, nodeHeight, nodeWidth, onUpdateNodeData, variantsOpen])

  const expandedItems = shotCount > 0
    ? shotItems.map((it, idx) => ({ url: it.url, label: it.title || `镜头 ${idx + 1}` }))
    : cutFrames.map((frame) => ({ url: frame.url, label: `镜头 ${frame.index + 1}` }))
  const expandedGridCols = React.useMemo(() => {
    const total = Math.max(0, expandedItems.length) || normalizedCount
    return computeGridLayoutFromCount(total + 1, { minCols: 2, maxCols: 4 }).cols
  }, [expandedItems.length, normalizedCount])

  return (
    <div
      className="task-node-storyboard-image__root"
      style={{
        position: 'relative',
        width: nodeWidth,
        height: nodeHeight,
        overflow: canExpandFrames ? 'visible' : 'hidden',
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
    >
      <div
        className="task-node-storyboard-image__frame"
        onDoubleClick={(e) => {
          e.stopPropagation()
          if (!coverUrl) return
          useUIStore.getState().openPreview({ url: coverUrl, kind: 'image', name: '分镜网格' })
        }}
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          borderRadius: frameRadius,
          overflow: !isExpanded && hasVariants ? 'visible' : 'hidden',
          border: `${frameBorderWidth}px ${frameBorderStyle} ${frameBorderColor}`,
          background: frameBackground,
          backdropFilter: 'blur(18px)',
          WebkitBackdropFilter: 'blur(18px)',
          boxShadow: darkCardShadow,
        }}
      >
        <div
          className="task-node-storyboard-image__glass-sheen"
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(135deg, rgba(255,255,255,0.12), rgba(255,255,255,0.02), rgba(255,255,255,0.10))',
            opacity: isDarkUi ? 0.18 : 0.12,
            pointerEvents: 'none',
          }}
          aria-hidden="true"
        />

        {coverUrl ? (
          !isExpanded && hasVariants ? (
            <div className="task-node-storyboard-image__stack" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
              {mediaStack
                .slice(0, Math.min(3, mediaStack.length))
                .reverse()
                .map((v, idx, arr) => {
                  const depth = arr.length - 1 - idx
                  const offset = depth * 10
                  return (
                    <div
                      key={`${v.url}-${depth}`}
                      className="task-node-storyboard-image__stack-layer"
                      style={{
                        position: 'absolute',
                        inset: 0,
                        transform: `translate(${offset}px, ${offset}px)`,
                        borderRadius: frameRadius,
                        overflow: 'hidden',
                        border: depth ? `1px solid ${frameBorderColor}` : 'none',
                        background: frameBackground,
                        boxShadow: depth ? darkCardShadow : 'none',
                      }}
                    >
                      <img
                        className="task-node-storyboard-image__cover"
                        src={v.url}
                        alt=""
                        draggable={false}
                        style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover' }}
                      />
                    </div>
                  )
                })}
            </div>
          ) : (
            <img
              className="task-node-storyboard-image__cover"
              src={coverUrl}
              alt="分镜网格"
              draggable={false}
              style={{
                width: '100%',
                height: '100%',
                display: 'block',
                objectFit: 'cover',
              }}
            />
          )
        ) : (
          <div
            className="task-node-storyboard-image__placeholder"
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: frameRadius,
              border: 'none',
              background: subtleOverlayBackground,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 12px',
            }}
          >
            <div
              className="task-node-storyboard-image__placeholder-text"
              style={{
                fontSize: 12,
                color: mediaOverlayText,
                opacity: 0.78,
                letterSpacing: 0.2,
                textAlign: 'center',
              }}
            >
              {`分镜图（${normalizedCount} 镜头）`}
            </div>
          </div>
        )}

        <div className="task-node-storyboard-image__badge-row" style={{ position: 'absolute', top: 10, left: 10, zIndex: 8 }}>
          <div
            className="task-node-storyboard-image__badge"
            style={{
              padding: '4px 10px',
              borderRadius: 999,
              background: isExpanded ? 'rgba(59,130,246,0.85)' : 'rgba(124,58,237,0.85)',
              color: '#fff',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 0.2,
              boxShadow: '0 10px 20px rgba(0,0,0,0.25)',
            }}
          >
            {isExpanded ? '总览' : '分镜'}
          </div>
        </div>

        {canExpandFrames && (
          <button
            className="task-node-storyboard-image__variants-toggle nodrag"
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              toggleVariants()
            }}
            title={variantsOpen ? '收起分镜' : '展开分镜'}
            style={{
              position: 'absolute',
              top: 10,
              right: 10,
              padding: '4px 10px',
              borderRadius: 999,
              border: `1px solid ${frameBorderColor}`,
              background: isDarkUi ? 'rgba(0,0,0,0.28)' : 'rgba(255,255,255,0.55)',
              backdropFilter: 'blur(14px)',
              WebkitBackdropFilter: 'blur(14px)',
              color: mediaOverlayText,
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
              boxShadow: variantsOpen ? '0 0 0 2px rgba(59,130,246,0.35)' : undefined,
            }}
          >
            {shotCount || normalizedCount}
          </button>
        )}

        {showStateOverlay && (
          <div
            className="task-node-storyboard-image__overlay"
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: frameRadius,
              background: 'rgba(255,255,255,0.10)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
            }}
            aria-hidden="true"
          >
            <div
              className="task-node-storyboard-image__overlay-text"
              style={{
                fontSize: 12,
                color: mediaOverlayText,
                opacity: 0.85,
                letterSpacing: 0.2,
              }}
            >
              {stateLabel || '生成中'}
            </div>
          </div>
        )}
      </div>

      {isExpanded && canExpandFrames && (
        <div
          className="task-node-storyboard-image__variants-grid"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            zIndex: 20,
            display: 'grid',
            gap: 12,
            pointerEvents: 'none',
            gridTemplateColumns: `repeat(${expandedGridCols}, ${baseWidth}px)`,
          }}
        >
          <div className="task-node-storyboard-image__variants-spacer" aria-hidden style={tileStyle} />
          {expandedItems.map((it) => (
            <button
              key={it.url}
              className="task-node-storyboard-image__variant nodrag"
              type="button"
              draggable
              onDragStart={(evt) => {
                evt.stopPropagation()
                setTapImageDragData(evt, it.url)
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => {
                e.stopPropagation()
                useUIStore.getState().openPreview({ url: it.url, kind: 'image', name: it.label })
              }}
              title="拖拽生成新节点"
              style={{
                ...tileStyle,
                borderRadius: frameRadius,
                overflow: 'hidden',
                border: `1px solid ${frameBorderColor}`,
                background: frameBackground,
                boxShadow: darkCardShadow,
                pointerEvents: 'auto',
                cursor: 'grab',
              }}
            >
              <img
                className="task-node-storyboard-image__variant-image"
                src={it.url}
                alt={it.label}
                draggable={false}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            </button>
          ))}

          {shotCount === 0 && cutStatus === 'running' && (
            <div
              className="task-node-storyboard-image__cutting"
              aria-hidden
              style={{
                ...tileStyle,
                borderRadius: frameRadius,
                border: `1px dashed ${frameBorderColor}`,
                background: isDarkUi ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.55)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: mediaOverlayText,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 0.2,
                pointerEvents: 'none',
              }}
            >
              切割中…
            </div>
          )}

          {shotCount === 0 && cutStatus === 'error' && (
            <button
              className="task-node-storyboard-image__cut-error nodrag"
              type="button"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                setCutAttempt((v) => v + 1)
                resetCutFrames()
              }}
              title="点击重试切割"
              style={{
                ...tileStyle,
                borderRadius: frameRadius,
                overflow: 'hidden',
                border: `1px solid ${frameBorderColor}`,
                background: isDarkUi ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.72)',
                boxShadow: darkCardShadow,
                pointerEvents: 'auto',
                cursor: 'pointer',
                padding: 12,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                alignItems: 'flex-start',
                justifyContent: 'center',
                textAlign: 'left',
              }}
            >
              <div
                className="task-node-storyboard-image__cut-error-title"
                style={{ fontSize: 12, fontWeight: 800, color: mediaOverlayText, opacity: 0.92 }}
              >
                切割失败
              </div>
              <div
                className="task-node-storyboard-image__cut-error-desc"
                style={{ fontSize: 10, fontWeight: 600, color: mediaOverlayText, opacity: 0.72, lineHeight: 1.35 }}
              >
                {cutError || '可能是跨域限制，无法读取像素'}
              </div>
              <div
                className="task-node-storyboard-image__cut-error-retry"
                style={{ fontSize: 10, fontWeight: 800, color: isDarkUi ? '#60a5fa' : '#2563eb', opacity: 0.95 }}
              >
                点击重试
              </div>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
