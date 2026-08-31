import React from 'react'
import { NodeToolbar, Position } from '@xyflow/react'
import { ActionIcon, Alert, Button, Group, SegmentedControl, Stack, Text } from '@mantine/core'
import {
  IconAlertTriangle,
  IconCheck,
  IconRefresh,
  IconScissors,
  IconX,
} from '@tabler/icons-react'

export type VideoToolEditorMode = 'subtitle' | 'subtitle-auto' | 'subject' | 'separation'

export type VideoToolEditorSelection = {
  id: string
  x: number
  y: number
  width: number
  height: number
}

type VideoToolEditorPanelProps = {
  opened: boolean
  mode: VideoToolEditorMode | null
  videoUrl: string
  readOnly: boolean
  onClose: () => void
  onUnavailable: (mode: VideoToolEditorMode, selections: VideoToolEditorSelection[]) => void
  onSeparate?: (output: 'both' | 'video' | 'audio') => Promise<void> | void
  editModelValue?: string | null
  editModelOptions?: Array<{ value: string; label: string }>
  editModelLoading?: boolean
  editModelError?: string | null
  /** 只有接入专用字幕/OCR/视频修复执行器后才允许提交；通用 video_editing 不等价于此能力。 */
  editExecutorAvailable?: boolean
  onEditModelChange?: (value: string) => void
  onEditSubmit?: (input: {
    mode: Exclude<VideoToolEditorMode, 'separation'>
    selections: VideoToolEditorSelection[]
    modelValue: string
  }) => Promise<void> | void
}

const modeCopy: Record<VideoToolEditorMode, {
  title: string
  hint: string
  submit: string
  gap: string
}> = {
  subtitle: {
    title: '框选去字幕',
    hint: '在画面上拖拽鼠标，框选要擦除的字幕区域；支持多个选区，作用于整段视频。',
    submit: '生成无字幕视频',
    gap: '请在 new-api 启用 volc-erase-video-subtitle-pro（MediaKit 精细字幕擦除）。Seedance 只负责生成/续写，不能替代字幕修复。',
  },
  'subtitle-auto': {
    title: '智能去字幕',
    hint: '自动识别整段视频中的字幕并生成无字幕版本。',
    submit: '生成无字幕视频',
    gap: '请在 new-api 启用 volc-erase-video-subtitle（MediaKit 自动 OCR + 时序修复）。Seedance 只负责生成/续写，不能替代字幕擦除。',
  },
  subject: {
    title: '主体消除',
    hint: '在画面上框选要移除的主体，确认后将对整段视频进行跨帧跟踪和背景修复。',
    submit: '生成主体消除视频',
    gap: 'MediaKit 的抠图是前景分离，不等于任意主体消除。请在 new-api 启用 wan2.7-videoedit（或接入 VOD 视频修复/时序 inpainting）后再执行框选主体消除。',
  },
  separation: {
    title: '音视频分离',
    hint: '将原片分为一个无声视频节点和一个独立音轨节点，两个产物都保留与源节点的连线。',
    submit: '开始分离',
    gap: '当前媒体 worker 可以合成和混音，但没有对外提供 demux 后导出无声 MP4 与独立音频文件的合同。',
  },
}

let rectSequence = 0

export function VideoToolEditorPanel({
  opened,
  mode,
  videoUrl,
  readOnly,
  onClose,
  onUnavailable,
  onSeparate,
  editModelValue,
  editModelOptions = [],
  editModelLoading = false,
  editModelError = null,
  editExecutorAvailable = false,
  onEditModelChange,
  onEditSubmit,
}: VideoToolEditorPanelProps): JSX.Element | null {
  const [rects, setRects] = React.useState<VideoToolEditorSelection[]>([])
  const [draft, setDraft] = React.useState<VideoToolEditorSelection | null>(null)
  const dragStartRef = React.useRef<{ x: number; y: number } | null>(null)
  const [separationOutput, setSeparationOutput] = React.useState<'both' | 'video' | 'audio'>('both')
  const [submitting, setSubmitting] = React.useState(false)
  const [submitError, setSubmitError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!opened) {
      setRects([])
      setDraft(null)
      dragStartRef.current = null
      setSubmitting(false)
      setSubmitError(null)
    }
  }, [opened])

  if (!opened || !mode) return null
  const copy = modeCopy[mode]
  const selectionRequired = mode !== 'separation' && mode !== 'subtitle-auto'
  const editModelSelected = typeof editModelValue === 'string' ? editModelValue.trim() : ''
  const canSubmitEdit = mode !== 'separation' && editExecutorAvailable && !editModelLoading && !editModelError && Boolean(onEditSubmit) && editModelOptions.length > 0 && Boolean(editModelSelected)

  const readPoint = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
      y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
    }
  }

  return (
    <NodeToolbar isVisible position={Position.Bottom} align="center" offset={18} className="nodrag nopan tc-video-tool-editor-toolbar">
      <Stack gap={10} className={`tc-video-tool-editor${mode === 'separation' ? ' tc-video-tool-editor--separation' : ''}`}>
        <Group justify="space-between" wrap="nowrap">
          <div>
            <Text size="sm" fw={600}>{copy.title}</Text>
            <Text size="xs" c="dimmed">{copy.hint}</Text>
          </div>
          <ActionIcon variant="subtle" size="sm" onClick={onClose} aria-label={`关闭${copy.title}`}>
            <IconX size={16} />
          </ActionIcon>
        </Group>

        {mode !== 'separation' ? <div
          className={`tc-video-tool-editor__preview${selectionRequired ? ' tc-video-tool-editor__preview--selectable' : ''}`}
          onPointerDown={selectionRequired && !readOnly ? (event) => {
            event.currentTarget.setPointerCapture(event.pointerId)
            const point = readPoint(event)
            dragStartRef.current = point
            rectSequence += 1
            setDraft({ id: `video-tool-selection-${rectSequence}`, x: point.x, y: point.y, width: 0, height: 0 })
          } : undefined}
          onPointerMove={selectionRequired && !readOnly ? (event) => {
            const start = dragStartRef.current
            if (!start) return
            const point = readPoint(event)
            setDraft((previous) => previous ? {
              ...previous,
              x: Math.min(start.x, point.x),
              y: Math.min(start.y, point.y),
              width: Math.abs(point.x - start.x),
              height: Math.abs(point.y - start.y),
            } : null)
          } : undefined}
          onPointerUp={selectionRequired && !readOnly ? (event) => {
            event.currentTarget.releasePointerCapture(event.pointerId)
            dragStartRef.current = null
            setDraft((previous) => {
              if (previous && previous.width >= 0.02 && previous.height >= 0.02) {
                setRects((items) => [...items, previous])
              }
              return null
            })
          } : undefined}
        >
          <video src={videoUrl} preload="metadata" controls={!selectionRequired} playsInline />
          {[...rects, ...(draft ? [draft] : [])].map((rect, index) => (
            <span
              key={rect.id}
              className="tc-video-tool-editor__selection"
              style={{
                left: `${rect.x * 100}%`,
                top: `${rect.y * 100}%`,
                width: `${rect.width * 100}%`,
                height: `${rect.height * 100}%`,
              }}
            >
              {index + 1}
            </span>
          ))}
          {selectionRequired && rects.length === 0 && !draft ? (
            <span className="tc-video-tool-editor__empty-hint">拖拽框选区域</span>
          ) : null}
        </div> : null}

        {mode === 'separation' ? (
          <div className="tc-video-tool-editor__separation-options">
            <Text size="xs" c="dimmed">输出内容</Text>
            <SegmentedControl
              size="xs"
              value={separationOutput}
              onChange={(value) => setSeparationOutput(value as typeof separationOutput)}
              data={[
                { value: 'both', label: '视频 + 音轨' },
                { value: 'video', label: '仅无声视频' },
                { value: 'audio', label: '仅音轨' },
              ]}
              fullWidth
            />
            <Text size="xs" c="dimmed">确认后会把真实文件上传到 Assets，并创建对应画布节点。</Text>
          </div>
        ) : (
          <Stack gap={8}>
            {editModelLoading ? (
              <Text size="xs" c="dimmed">正在加载 new-api 中已登记的视频编辑模型…</Text>
            ) : editModelError ? (
              <Alert color="red" icon={<IconAlertTriangle size={16} />} title="模型目录加载失败">
                {editModelError}
              </Alert>
            ) : !editExecutorAvailable ? (
              <Alert color="yellow" icon={<IconAlertTriangle size={16} />} title={`${copy.title}专用能力未接入`}>
                {copy.gap}
              </Alert>
            ) : editModelOptions.length > 0 ? (
              <div className="tc-video-tool-editor__model-picker">
                <Text size="xs" c="dimmed">视频编辑模型（new-api）</Text>
                <select
                  aria-label="视频编辑模型"
                  value={editModelSelected}
                  onChange={(event) => onEditModelChange?.(event.currentTarget.value)}
                  disabled={readOnly || submitting}
                >
                  {editModelOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
            ) : (
              <Alert color="yellow" icon={<IconAlertTriangle size={16} />} title="当前执行能力未接入">
                {copy.gap}
              </Alert>
            )}
            {editExecutorAvailable && !editModelLoading && !editModelError && editModelOptions.length > 0 ? (
              <Text size="xs" c="dimmed">将选区与原视频一起提交到 new-api 模型目录中已声明对应能力的执行器。</Text>
            ) : null}
          </Stack>
        )}

        {submitError ? (
          <Alert color="red" icon={<IconAlertTriangle size={16} />} title="处理失败">
            {submitError}
          </Alert>
        ) : null}

        <Group justify="space-between" gap={8} wrap="nowrap">
          <Text size="xs" c="dimmed">
            {selectionRequired
              ? `已标记 ${rects.length} 个区域`
              : mode === 'subtitle-auto' ? '预期产物：自动识别并移除字幕' : '预期产物：无声视频 + 独立音轨'}
          </Text>
          <Group gap={6} wrap="nowrap">
            {selectionRequired ? (
              <Button size="xs" variant="subtle" leftSection={<IconRefresh size={13} />} onClick={() => setRects([])} disabled={rects.length === 0}>
                重置
              </Button>
            ) : null}
            <Button
              size="xs"
              variant="default"
              leftSection={mode === 'separation' ? <IconScissors size={13} /> : <IconCheck size={13} />}
              disabled={readOnly || submitting || editModelLoading || Boolean(editModelError) || (selectionRequired && rects.length === 0)}
              loading={submitting}
              onClick={() => {
                if (mode !== 'separation' && canSubmitEdit && onEditSubmit) {
                  setSubmitting(true)
                  setSubmitError(null)
                  Promise.resolve(onEditSubmit({ mode, selections: rects, modelValue: editModelSelected }))
                    .catch((error: unknown) => {
                      setSubmitError(error instanceof Error ? error.message : '视频编辑处理失败')
                    })
                    .finally(() => setSubmitting(false))
                  return
                }
                if (mode !== 'separation' || !onSeparate) {
                  onUnavailable(mode, rects)
                  return
                }
                setSubmitting(true)
                setSubmitError(null)
                Promise.resolve(onSeparate(separationOutput))
                  .catch((error: unknown) => {
                    setSubmitError(error instanceof Error ? error.message : '音视频分离处理失败')
                  })
                  .finally(() => setSubmitting(false))
              }}
            >
              {mode === 'separation' ? (separationOutput === 'both' ? copy.submit : separationOutput === 'video' ? '导出无声视频' : '导出独立音轨') : copy.submit}
            </Button>
          </Group>
        </Group>
      </Stack>
    </NodeToolbar>
  )
}
