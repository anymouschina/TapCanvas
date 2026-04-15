import React from 'react'
import { ActionIcon, Text, Tooltip } from '@mantine/core'
import { IconGripVertical, IconLinkOff, IconPlus } from '@tabler/icons-react'
import type { OrderedUpstreamReferenceItem } from '../upstreamReferences'
import { ManagedImage } from '../../../../domain/resource-runtime'

type UpstreamReferenceStripProps = {
  targetNodeId: string
  items: OrderedUpstreamReferenceItem[]
  onRemove: (edgeId: string) => void
  onReorder: (draggedEdgeId: string, targetEdgeId: string) => void
  onToggleCanvasReferencePicker: () => void
  canvasReferencePickerActive: boolean
}

export function UpstreamReferenceStrip({
  targetNodeId,
  items,
  onRemove,
  onReorder,
  onToggleCanvasReferencePicker,
  canvasReferencePickerActive,
}: UpstreamReferenceStripProps) {
  const [draggedEdgeId, setDraggedEdgeId] = React.useState<string | null>(null)

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
        {items.map((item, index) => (
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
              onDragEnd={() => {
                setDraggedEdgeId(null)
              }}
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
              />
              <span className="tc-task-node__upstream-reference-drag-handle" aria-hidden="true">
                <IconGripVertical size={10} stroke={1.8} />
              </span>
              <span className="tc-task-node__upstream-reference-order">
                {index + 1}
              </span>
              <ActionIcon
                className="tc-task-node__upstream-reference-remove"
                size="xs"
                variant="filled"
                color="dark"
                aria-label={`断开 ${item.label} 连线`}
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  onRemove(item.edgeId)
                }}
              >
                <IconLinkOff size={9} stroke={1.8} />
              </ActionIcon>
            </div>
          </Tooltip>
        ))}
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
