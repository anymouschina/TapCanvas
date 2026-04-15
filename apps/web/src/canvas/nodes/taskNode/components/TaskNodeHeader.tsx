import React from 'react'
import { ActionIcon, Badge, Text, TextInput } from '@mantine/core'
import type { IconProps } from '@tabler/icons-react'
import { IconBrush } from '@tabler/icons-react'

type TaskNodeHeaderProps = {
  NodeIcon: React.ComponentType<IconProps>
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
  showMeta?: boolean
  showIcon?: boolean
  showStatus?: boolean
  isNew?: boolean
  metaBadges?: Array<{
    label: string
    color: string
    variant?: 'light' | 'outline' | 'filled'
  }>
  onLabelDraftChange: (value: string) => void
  onCommitLabel: () => void
  onCancelEdit: () => void
  onStartEdit: () => void
  labelInputRef: React.Ref<HTMLInputElement>
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
  showMeta = true,
  showIcon = true,
  showStatus = true,
  isNew = false,
  metaBadges = [],
  onLabelDraftChange,
  onCommitLabel,
  onCancelEdit,
  onStartEdit,
  labelInputRef,
}: TaskNodeHeaderProps) {
  if (!showMeta) {
    return (
      <div className="task-node-header task-node-header--compact" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        {showIcon && (
          <div
            className="task-node-header-icon"
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
            title={currentLabel}
          >
            <NodeIcon className="task-node-header-icon-svg" size={18} />
          </div>
        )}
        <Text
          className="task-node-header-compact-title"
          size="sm"
          fw={600}
          style={{
            color: nodeShellText,
            lineHeight: 1.2,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            minWidth: 0,
          }}
          title={currentLabel}
        >
          {currentLabel}
        </Text>
        {isNew && (
          <Badge className="task-node-header-new-badge" size="xs" radius="md" color="pink" variant="light">
            新建
          </Badge>
        )}
      </div>
    )
  }

  return (
    <div className="task-node-header" style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12, cursor: 'grab' }}>
      <div className="task-node-header-main" style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
        {showIcon && (
          <div
            className="task-node-header-icon"
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
            <NodeIcon className="task-node-header-icon-svg" size={18} />
          </div>
        )}
        <div className="task-node-header-content" style={{ flex: 1, minWidth: 0 }}>
          {editing ? (
            <TextInput
              className="task-node-header-input"
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
              <div className="task-node-header-title-row" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Text
                  className="task-node-header-title"
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
                {isNew && (
                  <Badge className="task-node-header-new-badge" size="xs" radius="md" color="pink" variant="light">
                    新建
                  </Badge>
                )}
                <ActionIcon className="task-node-header-rename" size="sm" variant="subtle" color="gray" title="重命名" onClick={onStartEdit}>
                  <IconBrush className="task-node-header-rename-icon" size={12} />
                </ActionIcon>
              </div>
              <Text className="task-node-header-subtitle" size="xs" c="dimmed" style={{ marginTop: 2 }}>
                {subtitle}
              </Text>
              {metaBadges.length > 0 && (
                <div
                  className="task-node-header-meta-badges"
                  style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}
                >
                  {metaBadges.map((badge) => (
                    <Badge
                      key={`${badge.label}-${badge.color}`}
                      className="task-node-header-meta-badge"
                      size="xs"
                      radius="md"
                      color={badge.color}
                      variant={badge.variant || 'light'}
                    >
                      {badge.label}
                    </Badge>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {showStatus && statusLabel?.trim() && (
        <div
          className="task-node-header-status"
          style={{
            ...sleekChipBase,
            color: statusColor,
            fontSize: 12,
          }}
        >
          <span className="task-node-header-status-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor, display: 'inline-block' }} />
          <span className="task-node-header-status-text">{statusLabel}</span>
        </div>
      )}
    </div>
  )
}
