import React from 'react'
import { Button, Group, NumberInput, Text, TextInput } from '@mantine/core'
import { NodeToolbar, Position } from '@xyflow/react'
import { validateVideoMarkerRange } from '../videoMarkers'

export type VideoMarkerDraft = {
  startSeconds: number
  endSeconds: number
  note: string
}

type VideoMarkerToolbarProps = {
  opened: boolean
  currentTimeSeconds: number
  durationSeconds: number | null
  markerCount: number
  saving: boolean
  onClose: () => void
  onSave: (draft: VideoMarkerDraft) => void
}

export function VideoMarkerToolbar({
  opened,
  currentTimeSeconds,
  durationSeconds,
  markerCount,
  saving,
  onClose,
  onSave,
}: VideoMarkerToolbarProps): JSX.Element {
  const [draft, setDraft] = React.useState<VideoMarkerDraft>({
    startSeconds: currentTimeSeconds,
    endSeconds: currentTimeSeconds,
    note: '',
  })

  React.useEffect(() => {
    if (!opened) return
    setDraft({ startSeconds: currentTimeSeconds, endSeconds: currentTimeSeconds, note: '' })
  }, [currentTimeSeconds, opened])

  const rangeError = validateVideoMarkerRange({
    startSeconds: draft.startSeconds,
    endSeconds: draft.endSeconds,
    durationSeconds,
  })

  return (
    <NodeToolbar
      className="tc-video-marker-toolbar nodrag nopan"
      isVisible={opened}
      position={Position.Bottom}
      align="center"
      offset={56}
    >
      <div className="tc-video-marker-toolbar__panel">
        <Group className="tc-video-marker-toolbar__header" justify="space-between" gap={12} wrap="nowrap">
          <Text className="tc-video-marker-toolbar__title" size="sm" fw={650}>视频标记</Text>
          <Text className="tc-video-marker-toolbar__meta" size="xs" c="dimmed">
            当前 {currentTimeSeconds.toFixed(2)}s · 已保存 {markerCount}
          </Text>
        </Group>
        <Group className="tc-video-marker-toolbar__range" gap={8} grow wrap="nowrap">
          <NumberInput
            className="tc-video-marker-toolbar__number"
            label="起始秒"
            size="xs"
            min={0}
            max={durationSeconds ?? undefined}
            decimalScale={2}
            value={draft.startSeconds}
            onChange={(value) => {
              const next = typeof value === 'number' ? value : 0
              setDraft((current) => ({
                ...current,
                startSeconds: next,
                endSeconds: current.endSeconds < next ? next : current.endSeconds,
              }))
            }}
          />
          <NumberInput
            className="tc-video-marker-toolbar__number"
            label="结束秒"
            size="xs"
            min={draft.startSeconds}
            max={durationSeconds ?? undefined}
            decimalScale={2}
            value={draft.endSeconds}
            onChange={(value) => setDraft((current) => ({
              ...current,
              endSeconds: typeof value === 'number' ? value : current.startSeconds,
            }))}
          />
        </Group>
        <TextInput
          className="tc-video-marker-toolbar__note"
          label="修改说明（可选）"
          placeholder="例如：保留人物，重拍转身动作"
          size="xs"
          value={draft.note}
          onChange={(event) => setDraft((current) => ({ ...current, note: event.currentTarget.value }))}
        />
        {rangeError ? <Text className="tc-video-marker-toolbar__error" size="xs" c="red">{rangeError}</Text> : null}
        <Group className="tc-video-marker-toolbar__actions" justify="flex-end" gap={8} wrap="nowrap">
          <Button className="tc-video-marker-toolbar__cancel" variant="subtle" size="compact-sm" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button
            className="tc-video-marker-toolbar__save"
            variant="filled"
            size="compact-sm"
            loading={saving}
            disabled={Boolean(rangeError)}
            onClick={() => onSave(draft)}
          >
            截帧并保存标记
          </Button>
        </Group>
      </div>
    </NodeToolbar>
  )
}
