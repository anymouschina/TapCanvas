import React from 'react'
import type { Node, NodeProps } from '@xyflow/react'
import { NodeResizeControl } from '@xyflow/react'
import { IconEdit, IconGripVertical, IconPlayerPlay } from '@tabler/icons-react'
import { useRFStore } from '../store'
import { runGroupToFilm } from '../runGroupToFilm'

type GroupNodeData = {
  label?: string
  adminWorkflow?: boolean
  sourceRecipeId?: string
  targetDurationSeconds?: number
  videoAspect?: string
  videoModel?: string
  videoProfileId?: string
}

type GroupCanvasNode = Node<GroupNodeData, 'groupNode'>

export default function GroupNode({ id, data, selected, dragging }: NodeProps<GroupCanvasNode>): JSX.Element {
  const label = String(data?.label || '组').trim() || '组'
  const isWorkflowGroup = data?.adminWorkflow === true
  // 只读快照/投影（data.readOnly === true）：禁止改名、禁止运行/出片、禁止缩放。
  const readOnly = (data as unknown as Record<string, unknown> | undefined)?.readOnly === true
  const borderColor = selected ? 'var(--canvas-group-border-selected)' : 'var(--canvas-group-border)'
  const renameGroup = useRFStore((s) => s.renameGroup)
  const [editing, setEditing] = React.useState(false)
  const [draftLabel, setDraftLabel] = React.useState(label)

  React.useEffect(() => {
    if (!editing) setDraftLabel(label)
  }, [editing, label])

  const submitRename = React.useCallback(() => {
    const next = draftLabel.trim()
    if (!readOnly && next && next !== label) {
      renameGroup(id, next)
    }
    setEditing(false)
  }, [draftLabel, id, label, readOnly, renameGroup])

  return (
    <div
      className={`tc-group-node${isWorkflowGroup ? ' tc-group-node--workflow' : ''}`}
      style={{ width: '100%', height: '100%' }}
    >
      <div
        className="tc-group-node__shell"
        style={{
          width: '100%',
          height: '100%',
          border: isWorkflowGroup ? 'none' : `1.5px dashed ${borderColor}`,
          borderRadius: isWorkflowGroup ? 0 : 12,
          background: isWorkflowGroup
            ? 'linear-gradient(180deg, rgba(255, 255, 255, 0.022), rgba(255, 255, 255, 0) 96px)'
            : 'var(--canvas-group-bg)',
          boxShadow: isWorkflowGroup
            ? selected ? 'inset 0 1px 0 var(--canvas-group-border-selected)' : 'none'
            : selected ? 'var(--canvas-group-shadow-selected)' : 'var(--canvas-group-shadow)',
          boxSizing: 'border-box',
          position: 'relative',
          transition: 'border-color 120ms ease, box-shadow 120ms ease, background 120ms ease',
          pointerEvents: 'auto',
          overflow: 'visible',
        }}
      >
        <div
          className="tc-group-node__drag-handle"
          style={{
            position: 'absolute',
            left: 0,
            top: -26,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            lineHeight: '18px',
            fontWeight: 600,
            color: 'var(--canvas-node-subtext)',
            userSelect: 'none',
            pointerEvents: 'auto',
            cursor: dragging ? 'grabbing' : 'grab',
            maxWidth: 'calc(100% - 8px)',
            zIndex: 5,
            padding: '2px 8px',
            borderRadius: isWorkflowGroup ? 4 : 999,
            border: isWorkflowGroup ? 'none' : `1px solid ${selected ? 'var(--canvas-group-border-selected)' : 'var(--canvas-group-border)'}`,
            background: isWorkflowGroup ? 'rgba(17, 18, 21, 0.9)' : 'var(--canvas-group-bg)',
            boxShadow: selected ? '0 6px 16px rgba(17, 18, 21, 0.14)' : 'none',
            overflow: 'hidden',
          }}
          title="拖这里移动组"
        >
          <IconGripVertical size={13} stroke={2} style={{ flex: '0 0 auto', opacity: 0.72 }} />
          {editing ? (
            <input
              className="tc-group-node__title-input nodrag nopan"
              value={draftLabel}
              autoFocus
              onChange={(e) => setDraftLabel(e.currentTarget.value)}
              onBlur={submitRename}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submitRename()
                  return
                }
                if (e.key === 'Escape') {
                  e.preventDefault()
                  setDraftLabel(label)
                  setEditing(false)
                }
              }}
              style={{
                width: '100%',
                minWidth: 96,
                fontSize: 12,
                lineHeight: '18px',
                height: 18,
                fontWeight: 600,
                color: 'var(--canvas-node-subtext)',
                background: 'transparent',
                border: 'none',
                outline: 'none',
                padding: 0,
                margin: 0,
              }}
            />
          ) : (
            <div
              className="tc-group-node__title-text"
              style={{
                minWidth: 0,
                whiteSpace: 'nowrap',
                textOverflow: 'ellipsis',
                overflow: 'hidden',
              }}
            >
              {label}
            </div>
          )}
          {!editing && !readOnly && (
            <button
              className="tc-group-node__title-edit nodrag nopan"
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setEditing(true)
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 18,
                height: 18,
                padding: 0,
                marginLeft: 2,
                border: 'none',
                borderRadius: 999,
                background: 'transparent',
                color: 'inherit',
                cursor: 'pointer',
                flex: '0 0 auto',
              }}
              title="编辑组名"
            >
              <IconEdit size={12} stroke={2} />
            </button>
          )}
          {isWorkflowGroup && !editing ? (
            <span className="tc-group-node__direction" aria-label="工作流方向：执行入口到最终输出">
              单向执行：入口 → 处理 → 输出
            </span>
          ) : null}
          {!editing && !isWorkflowGroup && !readOnly && (
            <button
              className="tc-group-node__run-film nodrag nopan"
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                void runGroupToFilm(id)
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 18,
                height: 18,
                padding: 0,
                marginLeft: 2,
                border: 'none',
                borderRadius: 999,
                background: 'transparent',
                color: 'inherit',
                cursor: 'pointer',
                flex: '0 0 auto',
              }}
              title="运行/出片"
            >
              <IconPlayerPlay size={12} stroke={2} />
            </button>
          )}
        </div>

        {selected && !dragging && !readOnly && (
          <NodeResizeControl
            className="tc-group-node__resize-control nodrag"
            position="bottom-right"
            keepAspectRatio
            minWidth={GROUP_MIN_WIDTH}
            minHeight={GROUP_MIN_HEIGHT}
          >
            <div className="tc-group-node__resize-handle" />
          </NodeResizeControl>
        )}
      </div>
    </div>
  )
}

const GROUP_MIN_WIDTH = 160
const GROUP_MIN_HEIGHT = 90
