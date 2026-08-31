import React from 'react'
import { NodeToolbar } from '@xyflow/react'
import { Position } from '@xyflow/react'
import { ActionIcon, Group, Popover, Tooltip } from '@mantine/core'
import {
  IconBold,
  IconItalic,
  IconList,
  IconListNumbers,
  IconPalette,
  IconSeparatorHorizontal,
  IconColorSwatch,
} from '@tabler/icons-react'
import { Text } from '@mantine/core'
import { TEXT_COLOR_PRESETS, TEXT_BG_PRESETS } from '../constants'

interface TaskNodeTextInlineToolbarProps {
  toolbarBackground: string
  toolbarShadow: string
  inlineDividerColor: string
  applyHeading: (level: 1 | 2 | 3 | 4) => void
  runRichCommand: (command: string, value?: string) => void
  applyList: (ordered: boolean) => void
  insertDivider: () => void
  textColorPickerOpen: boolean
  setTextColorPickerOpen: React.Dispatch<React.SetStateAction<boolean>>
  textColor: string
  textBgPickerOpen: boolean
  setTextBgPickerOpen: React.Dispatch<React.SetStateAction<boolean>>
  updateNodeData: (id: string, data: Record<string, unknown>) => void
  nodeId: string
}

function TaskNodeTextInlineToolbarInner({
  toolbarBackground,
  toolbarShadow,
  inlineDividerColor,
  applyHeading,
  runRichCommand,
  applyList,
  insertDivider,
  textColorPickerOpen,
  setTextColorPickerOpen,
  textColor,
  textBgPickerOpen,
  setTextBgPickerOpen,
  updateNodeData,
  nodeId,
}: TaskNodeTextInlineToolbarProps) {
  return (
    <NodeToolbar className="tc-task-node__text-inline-toolbar" position={Position.Top} align="center">
      <div
        className="tc-task-node__text-inline-toolbar-content"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 10px',
          borderRadius: 999,
          background: toolbarBackground,
          boxShadow: toolbarShadow,
          maxWidth: 'min(95vw, 980px)',
          overflowX: 'auto',
          whiteSpace: 'nowrap',
        }}
      >
        {([1, 2, 3, 4] as const).map((level) => (
          <Tooltip key={`h-${level}`} label={`H${level}`} position="bottom" withArrow>
            <ActionIcon
              className="tc-task-node__text-inline-action"
              variant="transparent"
              size="sm"
              onClick={() => applyHeading(level)}
            >
              <Text size="xs" fw={700}>{`H${level}`}</Text>
            </ActionIcon>
          </Tooltip>
        ))}
        <div className="tc-task-node__text-inline-divider" style={{ width: 1, height: 20, background: inlineDividerColor }} />
        <Tooltip label="加粗" position="bottom" withArrow>
          <ActionIcon className="tc-task-node__text-inline-action" variant="transparent" size="sm" onClick={() => runRichCommand('bold')}>
            <IconBold size={16} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="斜体" position="bottom" withArrow>
          <ActionIcon className="tc-task-node__text-inline-action" variant="transparent" size="sm" onClick={() => runRichCommand('italic')}>
            <IconItalic size={16} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="有序列表" position="bottom" withArrow>
          <ActionIcon className="tc-task-node__text-inline-action" variant="transparent" size="sm" onClick={() => applyList(true)}>
            <IconListNumbers size={16} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="无序列表" position="bottom" withArrow>
          <ActionIcon className="tc-task-node__text-inline-action" variant="transparent" size="sm" onClick={() => applyList(false)}>
            <IconList size={16} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="分割线" position="bottom" withArrow>
          <ActionIcon className="tc-task-node__text-inline-action" variant="transparent" size="sm" onClick={insertDivider}>
            <IconSeparatorHorizontal size={16} />
          </ActionIcon>
        </Tooltip>
        <div className="tc-task-node__text-inline-divider" style={{ width: 1, height: 20, background: inlineDividerColor }} />
        <Popover
          opened={textColorPickerOpen}
          onChange={setTextColorPickerOpen}
          position="bottom"
          withArrow
          withinPortal
          shadow="md"
        >
          <Popover.Target>
            <div>
              <Tooltip label="文字颜色" position="bottom" withArrow>
                <ActionIcon
                  className="tc-task-node__text-inline-action"
                  variant="transparent"
                  size="sm"
                  onClick={() => setTextColorPickerOpen((prev) => !prev)}
                >
                  <IconPalette size={16} color={textColor} />
                </ActionIcon>
              </Tooltip>
            </div>
          </Popover.Target>
          <Popover.Dropdown>
            <Group className="tc-task-node__text-inline-palette" gap={4} wrap="nowrap">
              {TEXT_COLOR_PRESETS.map((colorValue) => (
                <ActionIcon
                  key={colorValue}
                  className="tc-task-node__text-inline-color"
                  size="sm"
                  variant="subtle"
                  onClick={() => {
                    runRichCommand('foreColor', colorValue)
                    updateNodeData(nodeId, { textColor: colorValue })
                    setTextColorPickerOpen(false)
                  }}
                >
                  <span className="tc-task-node__text-inline-color-dot" style={{ width: 12, height: 12, borderRadius: 999, background: colorValue }} />
                </ActionIcon>
              ))}
            </Group>
          </Popover.Dropdown>
        </Popover>
        <Popover
          opened={textBgPickerOpen}
          onChange={setTextBgPickerOpen}
          position="bottom"
          withArrow
          withinPortal
          shadow="md"
        >
          <Popover.Target>
            <div>
              <Tooltip label="背景色" position="bottom" withArrow>
                <ActionIcon
                  className="tc-task-node__text-inline-action"
                  variant="transparent"
                  size="sm"
                  onClick={() => setTextBgPickerOpen((prev) => !prev)}
                >
                  <IconColorSwatch size={16} />
                </ActionIcon>
              </Tooltip>
            </div>
          </Popover.Target>
          <Popover.Dropdown>
            <Group className="tc-task-node__text-inline-palette" gap={4} wrap="nowrap">
              {TEXT_BG_PRESETS.map((colorValue) => (
                <ActionIcon
                  key={colorValue}
                  className="tc-task-node__text-inline-color"
                  size="sm"
                  variant="subtle"
                  onClick={() => {
                    updateNodeData(nodeId, { textBackgroundColor: colorValue })
                    setTextBgPickerOpen(false)
                  }}
                >
                  <span className="tc-task-node__text-inline-color-dot" style={{ width: 12, height: 12, borderRadius: 999, background: colorValue, border: '1px solid rgba(255,255,255,0.25)' }} />
                </ActionIcon>
              ))}
            </Group>
          </Popover.Dropdown>
        </Popover>
      </div>
    </NodeToolbar>
  )
}

export const TaskNodeTextInlineToolbar = React.memo(TaskNodeTextInlineToolbarInner)
