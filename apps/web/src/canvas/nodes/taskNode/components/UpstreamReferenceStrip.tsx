import React from 'react'
import { ActionIcon, Badge, Group, Text } from '@mantine/core'
import { IconX } from '@tabler/icons-react'
import type { UpstreamReferenceItem } from '../../../utils/upstreamReferences'

type UpstreamReferenceStripProps = {
  items: UpstreamReferenceItem[]
  inlineDividerColor: string
  mediaFallbackSurface: string
  onRemove: (item: UpstreamReferenceItem) => void
}

export function UpstreamReferenceStrip({
  items,
  inlineDividerColor,
  mediaFallbackSurface,
  onRemove,
}: UpstreamReferenceStripProps) {
  if (!items.length) return null

  return (
    <div className="tc-task-node__upstream-strip" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Group className="tc-task-node__upstream-strip-header" justify="space-between" gap={8}>
        <Text className="tc-task-node__upstream-strip-title" size="xs" fw={600}>
          上游参考图顺序
        </Text>
        <Badge className="tc-task-node__upstream-strip-badge" size="xs" variant="light" color="gray">
          {items.length} 张
        </Badge>
      </Group>
      <Group className="tc-task-node__upstream-strip-list" gap={8} wrap="wrap">
        {items.map((item, index) => (
          <div
            key={`${item.edgeId}-${item.url}`}
            className="tc-task-node__upstream-thumb"
            style={{
              position: 'relative',
              width: 56,
              height: 56,
              borderRadius: 12,
              overflow: 'hidden',
              border: `1px solid ${inlineDividerColor}`,
              background: mediaFallbackSurface,
              boxShadow: '0 12px 20px rgba(0,0,0,0.18)',
            }}
            title={`${index + 1}. ${item.sourceLabel}`}
          >
            <img
              className="tc-task-node__upstream-thumb-image nodrag nopan"
              src={item.url}
              alt={item.sourceLabel || `上游参考图 ${index + 1}`}
              draggable={false}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
            <div
              className="tc-task-node__upstream-thumb-order"
              style={{
                position: 'absolute',
                left: 6,
                top: 6,
                minWidth: 18,
                height: 18,
                borderRadius: 999,
                padding: '0 6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(15,23,42,0.82)',
                color: '#fff',
                fontSize: 10,
                fontWeight: 700,
                lineHeight: 1,
              }}
            >
              {index + 1}
            </div>
            {item.soraFileId && (
              <div
                className="tc-task-node__upstream-thumb-tag"
                style={{
                  position: 'absolute',
                  left: 6,
                  bottom: 6,
                  padding: '2px 5px',
                  borderRadius: 999,
                  background: 'rgba(34, 197, 94, 0.9)',
                  color: '#fff',
                  fontSize: 9,
                  fontWeight: 700,
                  lineHeight: 1,
                }}
              >
                Sora
              </div>
            )}
            <ActionIcon
              className="tc-task-node__upstream-thumb-remove"
              size="sm"
              radius="xl"
              variant="filled"
              color="dark"
              aria-label={`断开 ${item.sourceLabel}`}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                onRemove(item)
              }}
              style={{
                position: 'absolute',
                top: 6,
                right: 6,
                background: 'rgba(15,23,42,0.82)',
                color: '#fff',
              }}
            >
              <IconX className="tc-task-node__upstream-thumb-remove-icon" size={12} />
            </ActionIcon>
          </div>
        ))}
      </Group>
    </div>
  )
}
