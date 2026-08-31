import React from 'react'
import { createPortal } from 'react-dom'
import { Text, Tooltip } from '@mantine/core'
import { IconGripVertical, IconPlayerPlay, IconPlus, IconX } from '@tabler/icons-react'
import type { OrderedUpstreamReferenceItem } from '../upstreamReferences'
import { ManagedImage } from '../../../../domain/resource-runtime'
import { useUIStore } from '../../../../ui/uiStore'

type UpstreamReferenceStripProps = {
  targetNodeId: string
  items: OrderedUpstreamReferenceItem[]
  onRemove: (edgeId: string) => void
  onDeleteSourceNode: (sourceNodeId: string) => void
  onReorder: (draggedEdgeId: string, targetEdgeId: string) => void
  onToggleCanvasReferencePicker: () => void
  canvasReferencePickerActive: boolean
}

type VideoPopupPos = { left: number; top: number }

function VideoFirstFrameThumb({ src }: { src: string }) {
  const ref = React.useRef<HTMLVideoElement>(null)
  return (
    <video
      ref={ref}
      className="tc-task-node__upstream-reference-image tc-task-node__upstream-reference-video-thumb"
      src={src}
      crossOrigin="anonymous"
      preload="metadata"
      muted
      playsInline
      onLoadedMetadata={() => {
        if (ref.current) ref.current.currentTime = 0
      }}
    />
  )
}

function VideoReferenceCard({
  item,
  index,
  targetNodeId,
  onRemove,
  onReorder,
  draggedEdgeId,
  setDraggedEdgeId,
}: {
  item: OrderedUpstreamReferenceItem
  index: number
  targetNodeId: string
  onRemove: (edgeId: string) => void
  onReorder: (draggedEdgeId: string, targetEdgeId: string) => void
  draggedEdgeId: string | null
  setDraggedEdgeId: (id: string | null) => void
}) {
  const [popupPos, setPopupPos] = React.useState<VideoPopupPos | null>(null)
  const cardRef = React.useRef<HTMLDivElement>(null)

  const handleMouseEnter = React.useCallback(() => {
    if (!item.videoUrl) return
    const rect = cardRef.current?.getBoundingClientRect()
    if (!rect) return
    const POPUP_W = 256
    const POPUP_H = 144
    const GAP = 8
    setPopupPos({
      left: Math.max(4, rect.left + rect.width / 2 - POPUP_W / 2),
      top: rect.top - GAP - POPUP_H,
    })
  }, [item.videoUrl])

  const handleMouseLeave = React.useCallback(() => {
    setPopupPos(null)
  }, [])

  return (
    <>
      <div
        ref={cardRef}
        className={[
          'tc-task-node__upstream-reference-card',
          'tc-task-node__upstream-reference-card--video-source',
          draggedEdgeId === item.edgeId ? 'tc-task-node__upstream-reference-card--dragging' : '',
        ].join(' ')}
        title={item.label}
        draggable
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onDragStart={(event) => {
          setDraggedEdgeId(item.edgeId)
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', item.edgeId)
        }}
        onDragEnd={() => setDraggedEdgeId(null)}
        onDragOver={(event) => {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
        }}
        onDrop={(event) => {
          event.preventDefault()
          const sourceEdgeId = event.dataTransfer.getData('text/plain') || draggedEdgeId
          setDraggedEdgeId(null)
          if (!sourceEdgeId || sourceEdgeId === item.edgeId) return
          onReorder(sourceEdgeId, item.edgeId)
        }}
      >
        {item.previewUrl ? (
          <ManagedImage
            className="tc-task-node__upstream-reference-image"
            src={item.previewUrl}
            alt={item.label}
            kind="preview"
            variantKey="preview"
            priority="prefetch"
            ownerNodeId={targetNodeId}
            ownerSurface="task-node-upstream-reference"
            ownerRequestKey={`task-node-upstream-reference:${targetNodeId}:${item.edgeId}`}
            loading="lazy"
            decoding="async"
            fetchPriority="low"
            referrerPolicy="no-referrer"
          />
        ) : item.videoUrl ? (
          <VideoFirstFrameThumb src={item.videoUrl} />
        ) : null}

        <span className="tc-task-node__upstream-reference-video-badge" aria-hidden="true">
          <IconPlayerPlay size={7} stroke={2.5} />
        </span>
        <span className="tc-task-node__upstream-reference-drag-handle" aria-hidden="true">
          <IconGripVertical size={10} stroke={1.8} />
        </span>
        <span className="tc-task-node__upstream-reference-order">{index + 1}</span>
        <button
          className="tc-task-node__upstream-reference-remove"
          type="button"
          aria-label={`断开 ${item.label} 连线`}
          draggable={false}
          onDragStart={(e) => e.stopPropagation()}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onRemove(item.edgeId)
          }}
        >
          <IconX size={10} stroke={2.5} color="rgba(246,247,249,0.95)" />
        </button>
      </div>

      {popupPos && item.videoUrl &&
        createPortal(
          <div
            className="tc-task-node__upstream-video-popup"
            style={{ left: popupPos.left, top: popupPos.top }}
          >
            <video
              className="tc-task-node__upstream-video-popup-player"
              src={item.videoUrl}
              crossOrigin="anonymous"
              autoPlay
              loop
              muted
              playsInline
            />
          </div>,
          document.body,
        )}
    </>
  )
}

function UpstreamReferenceStrip({
  targetNodeId,
  items,
  onRemove,
  onDeleteSourceNode,
  onReorder,
  onToggleCanvasReferencePicker,
  canvasReferencePickerActive,
}: UpstreamReferenceStripProps) {
  const [draggedEdgeId, setDraggedEdgeId] = React.useState<string | null>(null)
  const openPreview = useUIStore((s) => s.openPreview)

  return (
    <div className="tc-task-node__upstream-reference-strip">
      <div className="tc-task-node__upstream-reference-strip-header">
        <Text className="tc-task-node__upstream-reference-strip-title" size="xs" fw={600}>
          上游参考
        </Text>
        <Text className="tc-task-node__upstream-reference-strip-meta" size="xs" c="dimmed">
          {canvasReferencePickerActive ? '点击画布图片直接连接' : '拖动调整顺序'}
        </Text>
      </div>
      <div className="tc-task-node__upstream-reference-strip-list">
        {items.map((item, index) =>
          item.sourceKind === 'video' ? (
            <VideoReferenceCard
              key={item.edgeId}
              item={item}
              index={index}
              targetNodeId={targetNodeId}
              onRemove={onRemove}
              onReorder={onReorder}
              draggedEdgeId={draggedEdgeId}
              setDraggedEdgeId={setDraggedEdgeId}
            />
          ) : (
            <Tooltip key={`${item.edgeId}-${item.previewUrl}`} label={item.label} withArrow openDelay={180}>
              <div
                className={[
                  'tc-task-node__upstream-reference-card',
                  draggedEdgeId === item.edgeId ? 'tc-task-node__upstream-reference-card--dragging' : '',
                ].join(' ')}
                title={item.label}
                draggable
                onDragStart={(event) => {
                  setDraggedEdgeId(item.edgeId)
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData('text/plain', item.edgeId)
                }}
                onDragEnd={() => setDraggedEdgeId(null)}
                onDragOver={(event) => {
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  const sourceEdgeId = event.dataTransfer.getData('text/plain') || draggedEdgeId
                  setDraggedEdgeId(null)
                  if (!sourceEdgeId || sourceEdgeId === item.edgeId) return
                  onReorder(sourceEdgeId, item.edgeId)
                }}
              >
                <ManagedImage
                  className="tc-task-node__upstream-reference-image"
                  src={item.previewUrl}
                  alt={item.label}
                  kind="preview"
                  variantKey="preview"
                  priority="prefetch"
                  ownerNodeId={targetNodeId}
                  ownerSurface="task-node-upstream-reference"
                  ownerRequestKey={`task-node-upstream-reference:${targetNodeId}:${item.edgeId}`}
                  loading="lazy"
                  decoding="async"
                  fetchPriority="low"
                  referrerPolicy="no-referrer"
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    if (item.previewUrl) openPreview({ url: item.previewUrl, kind: 'image', name: item.label })
                  }}
                  style={{ cursor: 'zoom-in' }}
                />
                <span className="tc-task-node__upstream-reference-drag-handle" aria-hidden="true">
                  <IconGripVertical size={10} stroke={1.8} />
                </span>
                <span className="tc-task-node__upstream-reference-order">
                  {index + 1}
                </span>
                <button
                  className="tc-task-node__upstream-reference-remove"
                  type="button"
                  aria-label={`断开 ${item.label} 连线`}
                  draggable={false}
                  onDragStart={(e) => e.stopPropagation()}
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    onRemove(item.edgeId)
                  }}
                >
                  <IconX size={10} stroke={2.5} color="rgba(246,247,249,0.95)" />
                </button>
              </div>
            </Tooltip>
          ),
        )}
        <Tooltip
          label={canvasReferencePickerActive ? '退出从画布选择参考' : '从画布选择参考'}
          withArrow
          openDelay={180}
        >
          <button
            className={[
              'tc-task-node__upstream-reference-add',
              canvasReferencePickerActive ? 'tc-task-node__upstream-reference-add--active' : '',
            ].join(' ')}
            type="button"
            aria-label={canvasReferencePickerActive ? '退出从画布选择参考' : '从画布选择参考'}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onToggleCanvasReferencePicker()
            }}
          >
            <IconPlus size={14} stroke={2} />
          </button>
        </Tooltip>
      </div>
    </div>
  )
}

const _UpstreamReferenceStrip = React.memo(UpstreamReferenceStrip)
export { _UpstreamReferenceStrip as UpstreamReferenceStrip }
