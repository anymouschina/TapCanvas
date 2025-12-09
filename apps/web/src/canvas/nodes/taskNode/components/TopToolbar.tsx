import React from 'react'
import { ActionIcon, Button, Group, Paper, Text } from '@mantine/core'
import { NodeToolbar, Position } from 'reactflow'
import { IconDots, IconDownload, IconMaximize } from '@tabler/icons-react'

type ToolbarAction = { key: string; label: string; icon: JSX.Element; onClick: () => void }

type TopToolbarProps = {
  isVisible: boolean
  selectedCount: number
  hasContent: boolean
  moreRef: React.RefObject<HTMLDivElement | null>
  showMore: boolean
  setShowMore: (value: boolean) => void
  toolbarBackground: string
  toolbarShadow: string
  toolbarActionIconStyles: any
  toolbarTextButtonStyle: React.CSSProperties
  inlineDividerColor: string
  visibleDefs: ToolbarAction[]
  extraDefs: ToolbarAction[]
  onPreview: () => void
  onDownload: () => void
}

export function TopToolbar({
  isVisible,
  selectedCount,
  hasContent,
  moreRef,
  showMore,
  setShowMore,
  toolbarBackground,
  toolbarShadow,
  toolbarActionIconStyles,
  toolbarTextButtonStyle,
  inlineDividerColor,
  visibleDefs,
  extraDefs,
  onPreview,
  onDownload,
}: TopToolbarProps) {
  return (
    <NodeToolbar isVisible={isVisible && selectedCount === 1 && hasContent} position={Position.Top} align="center">
      <div ref={moreRef} style={{ position: 'relative', display: 'inline-block' }} data-more-root>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 12px',
            borderRadius: 999,
            background: toolbarBackground,
            boxShadow: toolbarShadow,
            backdropFilter: 'blur(18px)',
          }}
        >
          <ActionIcon
            variant="transparent"
            radius={0}
            size="sm"
            title="放大预览"
            styles={toolbarActionIconStyles}
            onClick={onPreview}
          >
            <IconMaximize size={16} />
          </ActionIcon>
          <ActionIcon
            variant="transparent"
            radius={0}
            size="sm"
            styles={toolbarActionIconStyles}
            title="下载"
            onClick={onDownload}
          >
            <IconDownload size={16} />
          </ActionIcon>
          {visibleDefs.length > 0 && (
            <div style={{ width: 1, height: 24, background: inlineDividerColor }} />
          )}
          {visibleDefs.map((d) => (
            <Button
              key={d.key}
              type="button"
              variant="transparent"
              radius={0}
              size="compact-sm"
              onClick={d.onClick}
              style={toolbarTextButtonStyle}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {d.icon}
                <span>{d.label}</span>
              </span>
            </Button>
          ))}
          {extraDefs.length > 0 && (
            <ActionIcon
              variant="transparent"
              radius={0}
              size="sm"
              title="更多"
              styles={toolbarActionIconStyles}
              onClick={(e) => {
                e.stopPropagation()
                setShowMore(!showMore)
              }}
            >
              <IconDots size={16} />
            </ActionIcon>
          )}
        </div>
        {showMore && (
          <div style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 2 }}>
            <Paper shadow="md" radius="md" className="glass" p="xs" style={{ width: 260 }}>
              <Text size="xs" c="dimmed" mb={6}>
                更多
              </Text>
              <Group wrap="wrap" gap={6}>
                {extraDefs.map((d) => (
                  <Button
                    key={d.key}
                    size="xs"
                    variant="subtle"
                    leftSection={<>{d.icon}</>}
                    onClick={() => {
                      setShowMore(false)
                      d.onClick()
                    }}
                  >
                    {d.label}
                  </Button>
                ))}
              </Group>
            </Paper>
          </div>
        )}
      </div>
    </NodeToolbar>
  )
}
