import React from 'react'
import { ActionIcon, Tooltip } from '@mantine/core'
import { NodeToolbar, Position } from '@xyflow/react'
import { IconDownload, IconMaximize } from '@tabler/icons-react'

type ToolbarAction = { key: string; label: string; icon: JSX.Element; onClick: () => void }

type TopToolbarProps = {
  isVisible: boolean
  selectedCount: number
  hasContent: boolean
  toolbarBackground: string
  toolbarShadow: string
  toolbarActionIconStyles: any
  inlineDividerColor: string
  visibleDefs: ToolbarAction[]
  onPreview: () => void
  onDownload: () => void
}

export function TopToolbar({
  isVisible,
  selectedCount,
  hasContent,
  toolbarBackground,
  toolbarShadow,
  toolbarActionIconStyles,
  inlineDividerColor,
  visibleDefs,
  onPreview,
  onDownload,
}: TopToolbarProps) {
  return (
    <NodeToolbar className="top-toolbar" isVisible={isVisible && selectedCount === 1 && hasContent} position={Position.Top} align="center">
      <div className="top-toolbar-anchor" style={{ position: 'relative', display: 'inline-block' }}>
        <div
          className="top-toolbar-content"
          style={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            justifyContent: 'center',
            gap: 8,
            padding: '6px 12px',
            borderRadius: 999,
            background: toolbarBackground,
            boxShadow: toolbarShadow,
            backdropFilter: 'blur(18px)',
            maxWidth: 'min(92vw, 980px)',
          }}
        >
          <Tooltip className="top-toolbar-tooltip" label="放大预览" position="bottom" withArrow>
            <ActionIcon
              className="top-toolbar-action"
              variant="transparent"
              radius={0}
              size="sm"
              aria-label="放大预览"
              styles={toolbarActionIconStyles}
              onClick={onPreview}
            >
              <IconMaximize className="top-toolbar-action-icon" size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip className="top-toolbar-tooltip" label="下载" position="bottom" withArrow>
            <ActionIcon
              className="top-toolbar-action"
              variant="transparent"
              radius={0}
              size="sm"
              aria-label="下载"
              styles={toolbarActionIconStyles}
              onClick={onDownload}
            >
              <IconDownload className="top-toolbar-action-icon" size={16} />
            </ActionIcon>
          </Tooltip>
          {visibleDefs.length > 0 && (
            <div className="top-toolbar-divider" style={{ width: 1, height: 24, background: inlineDividerColor }} />
          )}
          {visibleDefs.map((d) => (
            <Tooltip className="top-toolbar-tooltip" key={d.key} label={d.label} position="bottom" withArrow>
              <ActionIcon
                className="top-toolbar-action"
                variant="transparent"
                radius={0}
                size="sm"
                aria-label={d.label}
                styles={toolbarActionIconStyles}
                onClick={d.onClick}
              >
                {d.icon}
              </ActionIcon>
            </Tooltip>
          ))}
        </div>
      </div>
    </NodeToolbar>
  )
}
