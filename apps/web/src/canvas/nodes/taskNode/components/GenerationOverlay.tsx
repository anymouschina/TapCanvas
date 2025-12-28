import React from 'react'
import { Group, Loader, Progress, Text } from '@mantine/core'

type GenerationOverlayProps = {
  visible: boolean
  status: 'idle' | 'queued' | 'running' | 'success' | 'error' | 'canceled'
  progress?: number | null
}

function clampProgress(value: unknown): number | null {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return null
  return Math.max(0, Math.min(100, num))
}

export function GenerationOverlay({ visible, status, progress }: GenerationOverlayProps) {
  if (!visible) return null
  const pct = clampProgress(progress)
  const label =
    status === 'queued' ? '排队中' :
    status === 'running' ? '生成中' :
    '处理中'

  return (
    <div className="tc-task-node__gen-overlay" aria-label="generation-overlay">
      <div className="tc-task-node__gen-overlay-sheen" aria-hidden="true" />
      <div className="tc-task-node__gen-overlay-body">
        <Group className="tc-task-node__gen-overlay-title" gap={8}>
          <Loader className="tc-task-node__gen-overlay-loader" size="xs" variant="dots" />
          <Text className="tc-task-node__gen-overlay-text" size="xs" fw={600}>
            {label}{pct !== null ? ` ${Math.round(pct)}%` : ''}
          </Text>
        </Group>
        {pct !== null && (
          <Progress
            className="tc-task-node__gen-overlay-progress"
            value={pct}
            size="sm"
            radius="xl"
            styles={{
              root: { background: 'rgba(255,255,255,0.10)' },
              section: { transition: 'width 180ms ease' },
            }}
          />
        )}
      </div>
    </div>
  )
}

export default React.memo(GenerationOverlay)

