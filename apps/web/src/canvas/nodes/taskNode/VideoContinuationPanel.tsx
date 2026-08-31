import React from 'react'
import { NodeToolbar, Position } from '@xyflow/react'
import { ActionIcon, Button, Group, RangeSlider, Select, Stack, Text, Textarea } from '@mantine/core'
import { IconCheck, IconPlayerPlay, IconX } from '@tabler/icons-react'

export type VideoContinuationSubmit = {
  prompt: string
  durationSeconds: number
  sourceRange: { start: number; end: number }
  sourceDurationSeconds: number
}

type VideoContinuationPanelProps = {
  opened: boolean
  readOnly: boolean
  sourceVideoUrl: string
  sourceDurationSeconds: number | null
  /** 模型可接受的续写参考片段最大时长；由实时模型目录提供。 */
  referenceMaxSeconds?: number
  /** 模型可执行的续写输出时长；由实时模型目录提供。 */
  continuationDurationOptions?: number[]
  onClose: () => void
  onSubmit: (value: VideoContinuationSubmit) => void
}

const DEFAULT_MAX_SOURCE_SECONDS = 15
const MIN_SOURCE_SECONDS = 2
const DEFAULT_CONTINUATION_DURATIONS = [5, 10, 15]

const formatTime = (seconds: number): string => {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0)
  const minutes = Math.floor(safe / 60)
  const remainder = safe - minutes * 60
  return `${minutes}:${remainder.toFixed(1).padStart(4, '0')}`
}

export function VideoContinuationPanel({
  opened,
  readOnly,
  sourceVideoUrl,
  sourceDurationSeconds,
  referenceMaxSeconds = DEFAULT_MAX_SOURCE_SECONDS,
  continuationDurationOptions = DEFAULT_CONTINUATION_DURATIONS,
  onClose,
  onSubmit,
}: VideoContinuationPanelProps): JSX.Element | null {
  const [prompt, setPrompt] = React.useState('')
  const normalizedDurationOptions = React.useMemo(() => {
    const values = continuationDurationOptions
      .filter((value) => Number.isFinite(value) && value > 0)
      .map((value) => Math.trunc(value))
      .filter((value, index, all) => all.indexOf(value) === index)
      .sort((a, b) => a - b)
    return values.length > 0 ? values : DEFAULT_CONTINUATION_DURATIONS
  }, [continuationDurationOptions])
  const [duration, setDuration] = React.useState(String(normalizedDurationOptions[0]))
  // 节点上的 videoDuration 可能只是生成参数（例如默认 15 秒），不能覆盖媒体自身 metadata。
  const [loadedDuration, setLoadedDuration] = React.useState<number | null>(null)
  const videoRef = React.useRef<HTMLVideoElement>(null)
  const effectiveDuration = Math.max(0, loadedDuration ?? sourceDurationSeconds ?? 0)
  const maxReferenceSeconds = Math.max(MIN_SOURCE_SECONDS, Number.isFinite(referenceMaxSeconds) ? referenceMaxSeconds : DEFAULT_MAX_SOURCE_SECONDS)
  const initialStart = Math.max(0, effectiveDuration - Math.min(maxReferenceSeconds, effectiveDuration))
  const [sourceRange, setSourceRange] = React.useState<[number, number]>([initialStart, effectiveDuration])

  React.useEffect(() => {
    if (!opened) return
    setLoadedDuration(null)
    setDuration(String(normalizedDurationOptions[0]))
  }, [normalizedDurationOptions, opened, sourceVideoUrl])

  React.useEffect(() => {
    if (!opened || effectiveDuration <= 0) return
    const end = effectiveDuration
    const start = Math.max(0, end - Math.min(maxReferenceSeconds, end))
    setSourceRange([start, end])
  }, [effectiveDuration, maxReferenceSeconds, opened])

  if (!opened) return null
  const selectedDuration = Math.max(0, sourceRange[1] - sourceRange[0])
  const selectionValid = selectedDuration >= Math.min(MIN_SOURCE_SECONDS, effectiveDuration)
    && selectedDuration <= maxReferenceSeconds

  return (
    <NodeToolbar isVisible position={Position.Top} align="center" offset={12} className="nodrag nopan tc-video-continuation-toolbar">
      <Stack gap={10} className="tc-video-continuation-toolbar__panel">
        <Group justify="space-between" gap={12} wrap="nowrap">
          <div>
            <Text size="sm" fw={600}>智能续写</Text>
            <Text size="xs" c="dimmed">请截取续写前置视频</Text>
          </div>
          <ActionIcon variant="subtle" size="sm" onClick={onClose} aria-label="退出续写模式">
            <IconX size={16} />
          </ActionIcon>
        </Group>

        <div className="tc-video-continuation-toolbar__preview">
          <video
            ref={videoRef}
            src={sourceVideoUrl}
            preload="metadata"
            playsInline
            controls
            onLoadedMetadata={(event) => {
              const next = event.currentTarget.duration
              if (Number.isFinite(next) && next > 0) setLoadedDuration(next)
            }}
          />
        </div>

        <div className="tc-video-continuation-toolbar__selection">
          <Group justify="space-between" gap={8} mb={5}>
            <Text size="xs" c="dimmed">前置片段</Text>
            <Text size="xs" className="tc-video-continuation-toolbar__duration">
              {formatTime(sourceRange[0])}–{formatTime(sourceRange[1])} · {selectedDuration.toFixed(1)} 秒
            </Text>
          </Group>
          <RangeSlider
            className="nodrag nopan"
            min={0}
            max={effectiveDuration || 1}
            step={0.1}
            minRange={Math.min(MIN_SOURCE_SECONDS, effectiveDuration || MIN_SOURCE_SECONDS)}
            maxRange={maxReferenceSeconds}
            value={sourceRange}
            onChange={(next) => {
              setSourceRange(next)
              if (videoRef.current) videoRef.current.currentTime = next[0]
            }}
            label={(value) => formatTime(value)}
            disabled={readOnly || effectiveDuration <= 0}
          />
          <Text size="10px" c={selectionValid ? 'dimmed' : 'red'} mt={4}>
            所选前置片段需介于 {Math.min(MIN_SOURCE_SECONDS, effectiveDuration || MIN_SOURCE_SECONDS)}–{maxReferenceSeconds} 秒
          </Text>
          <Text size="10px" c="dimmed" mt={3}>
            确认后会按当前模型目录声明的参考视频、续写时长与计费规格提交任务。
          </Text>
        </div>

        <Textarea
          value={prompt}
          onChange={(event) => setPrompt(event.currentTarget.value)}
          placeholder="请输入需要续写的内容"
          autosize
          minRows={2}
          maxRows={4}
          disabled={readOnly}
        />
        <Group gap={8} align="end" wrap="nowrap">
          <Select
            label="续写时长"
            value={duration}
            onChange={(value) => setDuration(value || String(normalizedDurationOptions[0]))}
            data={normalizedDurationOptions.map((value) => ({ value: String(value), label: `${value} 秒` }))}
            w={120}
            size="xs"
            allowDeselect={false}
            disabled={readOnly}
          />
          <Button
            className="tc-video-continuation-toolbar__preview-start"
            size="xs"
            variant="subtle"
            leftSection={<IconPlayerPlay size={13} />}
            onClick={() => {
              if (!videoRef.current) return
              videoRef.current.currentTime = sourceRange[0]
              void videoRef.current.play()
            }}
            disabled={!sourceVideoUrl}
          >
            预览片段
          </Button>
          <Button
            size="xs"
            leftSection={<IconCheck size={14} />}
            disabled={readOnly || !prompt.trim() || !selectionValid}
            onClick={() => onSubmit({
              prompt: prompt.trim(),
              durationSeconds: Number(duration),
              sourceRange: { start: sourceRange[0], end: sourceRange[1] },
              sourceDurationSeconds: effectiveDuration,
            })}
          >
            确认续写
          </Button>
        </Group>
      </Stack>
    </NodeToolbar>
  )
}
