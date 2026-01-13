import React from 'react'
import { setTapImageDragData } from '../../../dnd/setTapImageDragData'
import { useUIStore } from '../../../../ui/uiStore'

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
  const hasVariants = !!coverUrl && shotCount > 0
  const isExpanded = hasVariants && !!variantsOpen
  const baseWidth = variantsBaseWidth ?? nodeWidth
  const baseHeight = variantsBaseHeight ?? nodeHeight
  const tileStyle = { width: baseWidth, height: baseHeight }

  const mediaStack = React.useMemo(() => {
    if (!coverUrl) return []
    const list = [{ url: coverUrl }, ...shotItems.map((it) => ({ url: it.url }))]
    return dedupeByUrl(list).slice(0, 3)
  }, [coverUrl, shotItems])

  const toggleVariants = React.useCallback(() => {
    if (!hasVariants) return
    if (variantsOpen) {
      onUpdateNodeData({ variantsOpen: false })
      return
    }
    onUpdateNodeData({
      variantsOpen: true,
      variantsBaseWidth: Math.max(72, Math.round(nodeWidth)),
      variantsBaseHeight: Math.max(54, Math.round(nodeHeight)),
    })
  }, [hasVariants, nodeHeight, nodeWidth, onUpdateNodeData, variantsOpen])

  const gridCols = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(shotCount + 1))))

  return (
    <div
      className="task-node-storyboard-image__root"
      style={{
        position: 'relative',
        width: nodeWidth,
        height: nodeHeight,
        overflow: hasVariants ? 'visible' : 'hidden',
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

        {hasVariants && (
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
            {shotCount}
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

      {isExpanded && hasVariants && (
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
            gridTemplateColumns: `repeat(${gridCols}, ${baseWidth}px)`,
          }}
        >
          <div className="task-node-storyboard-image__variants-spacer" aria-hidden style={tileStyle} />
          {shotItems.map((it) => (
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
                alt={it.title || '镜头'}
                draggable={false}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
