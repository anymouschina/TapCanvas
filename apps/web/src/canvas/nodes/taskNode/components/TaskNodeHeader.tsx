import React from 'react'
import { ActionIcon, Text, TextInput } from '@mantine/core'
import { IconBrush } from '@tabler/icons-react'

type TaskNodeHeaderProps = {
  NodeIcon: (props: { size?: number }) => JSX.Element
  editing: boolean
  labelDraft: string
  currentLabel: string
  subtitle: string
  statusLabel?: string | null
  statusColor: string
  nodeShellText: string
  iconBadgeBackground: string
  iconBadgeShadow: string
  sleekChipBase: React.CSSProperties
  labelSingleLine?: boolean
  onLabelDraftChange: (value: string) => void
  onCommitLabel: () => void
  onCancelEdit: () => void
  onStartEdit: () => void
  labelInputRef: React.RefObject<HTMLInputElement | null>
}

export function TaskNodeHeader({
  NodeIcon,
  editing,
  labelDraft,
  currentLabel,
  subtitle,
  statusLabel,
  statusColor,
  nodeShellText,
  iconBadgeBackground,
  iconBadgeShadow,
  sleekChipBase,
  labelSingleLine,
  onLabelDraftChange,
  onCommitLabel,
  onCancelEdit,
  onStartEdit,
  labelInputRef,
}: TaskNodeHeaderProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 14,
            background: iconBadgeBackground,
            boxShadow: iconBadgeShadow,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            color: '#fff',
          }}
        >
          <NodeIcon size={18} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {editing ? (
            <TextInput
              ref={labelInputRef}
              size="xs"
              value={labelDraft}
              onChange={(e) => onLabelDraftChange(e.currentTarget.value)}
              onBlur={onCommitLabel}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  onCommitLabel()
                } else if (e.key === 'Escape') {
                  onCancelEdit()
                }
              }}
            />
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Text
                  size="sm"
                  fw={600}
                  style={{
                    color: nodeShellText,
                    lineHeight: 1.2,
                    cursor: 'pointer',
                    flex: 1,
                    ...(labelSingleLine
                      ? {
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }
                      : {}),
                  }}
                  title="双击重命名"
                  onDoubleClick={onStartEdit}
                >
                  {currentLabel}
                </Text>
                <ActionIcon size="sm" variant="subtle" color="gray" title="重命名" onClick={onStartEdit}>
                  <IconBrush size={12} />
                </ActionIcon>
              </div>
              <Text size="xs" c="dimmed" style={{ marginTop: 2 }}>
                {subtitle}
              </Text>
            </>
          )}
        </div>
      </div>
      {statusLabel?.trim() && (
        <div
          style={{
            ...sleekChipBase,
            color: statusColor,
            fontSize: 12,
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor, display: 'inline-block' }} />
          <span>{statusLabel}</span>
        </div>
      )}
    </div>
  )
}
