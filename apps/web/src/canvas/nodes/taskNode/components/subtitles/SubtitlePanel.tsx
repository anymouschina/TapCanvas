import React from 'react'
import { Box, Button, Group, Text, Stack, ActionIcon, Textarea, SegmentedControl, ScrollArea, Select } from '@mantine/core'
import { IconSparkles, IconTrash, IconPlus, IconX } from '@tabler/icons-react'
import type { SubtitleSegment, SubtitleFontSizeTier, SubtitleStyle } from './types'
import { SubtitleStyleControls } from './SubtitleStyleControls'
import './SubtitlePanel.css'
import type { ModelOption } from '../../../../../config/models'

const US_PER_S = 1_000_000

function fmtUs(us: number): string {
  const s = us / US_PER_S
  const m = Math.floor(s / 60)
  const sec = (s % 60).toFixed(1).padStart(4, '0')
  return `${String(m).padStart(2, '0')}:${sec}`
}

export type SubtitlePanelProps = {
  segments: SubtitleSegment[]
  selectedSegmentId?: string | null
  selectionRevision?: number
  onSelect?: (segmentId: string) => void
  /** segmentId → 时间线位置（被完全裁掉的段无条目） */
  projected: Map<string, { startUs: number; endUs: number }>
  fontTier: SubtitleFontSizeTier
  subtitleStyle?: SubtitleStyle
  onChangeStyle: (style: SubtitleStyle) => void
  generating: boolean
  error: string | null
  skipped: Array<{ url: string; title?: string }>
  canGenerate: boolean
  modelOptions: ModelOption[]
  selectedModel: string | null
  modelLoading: boolean
  modelError: string | null
  onGenerate: () => void
  onChangeModel: (value: string | null) => void
  onChangeFontTier: (t: SubtitleFontSizeTier) => void
  onUpdateText: (id: string, text: string) => void
  onDelete: (id: string) => void
  onAddAtPlayhead: () => void
  onSeek: (timelineUs: number) => void
  onClosePanel: () => void
}

export function SubtitlePanel(props: SubtitlePanelProps) {
  const {
    segments, selectedSegmentId, selectionRevision, onSelect, projected, fontTier, subtitleStyle, onChangeStyle, generating, error, skipped, canGenerate,
    modelOptions, selectedModel, modelLoading, modelError,
    onGenerate, onChangeModel, onChangeFontTier, onUpdateText, onDelete, onAddAtPlayhead, onSeek, onClosePanel,
  } = props

  const [view, setView] = React.useState('content')
  const selectedRowRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    if (!selectedSegmentId) return
    setView('content')
  }, [selectedSegmentId, selectionRevision])
  React.useEffect(() => {
    if (view === 'content') selectedRowRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedSegmentId, selectionRevision, view])

  const ordered = React.useMemo(() => {
    return [...segments].sort((a, b) => {
      const pa = projected.get(a.id)
      const pb = projected.get(b.id)
      if (pa && pb) return pa.startUs - pb.startUs
      if (pa) return -1
      if (pb) return 1
      return a.startUs - b.startUs
    })
  }, [segments, projected])

  return (
    <Box className="subtitle-panel">
      <Group className="subtitle-panel__header" justify="space-between" px={12} py={8} style={{ borderBottom: '1px solid #2e2e2e' }}>
        <Text className="subtitle-panel__title" size="sm" fw={500} c="white">智能字幕</Text>
        <ActionIcon className="subtitle-panel__close" aria-label="收起字幕面板" variant="subtle" color="gray" size="sm" onClick={onClosePanel} title="收起面板">
          <IconX className="subtitle-panel__close-icon" size={13} />
        </ActionIcon>
      </Group>

      <SegmentedControl className="subtitle-panel__tabs" aria-label="字幕编辑选项" value={view}
        onChange={setView} size="xs" radius={0} fullWidth
        data={[{ value: 'content', label: '内容' }, { value: 'style', label: '样式' }]} />

      {view === 'content' && <Stack className="subtitle-panel__recognition" gap={8} p={12} style={{ borderBottom: '1px solid #2e2e2e' }}>
        <Text className="subtitle-panel__recognition-description" size="xs" c="dimmed">
          识别视频中的真实人声，也可手动添加字幕。
        </Text>
        <Select className="subtitle-panel__model"
          size="xs"
          label="人声识别模型"
          placeholder={modelLoading ? '正在加载模型目录…' : '请选择视频理解模型'}
          data={modelOptions.map((option) => ({ value: option.value, label: option.label }))}
          value={selectedModel}
          onChange={onChangeModel}
          searchable
          clearable={false}
          disabled={modelLoading || modelOptions.length === 0 || generating}
          error={modelError || undefined}
        />
        <Button className="subtitle-panel__generate"
          size="xs"
          leftSection={<IconSparkles className="subtitle-panel__generate-icon" size={13} />}
          loading={generating}
          disabled={!canGenerate || !selectedModel}
          onClick={onGenerate}
        >
          {segments.some((s) => s.source === 'auto') ? '重新生成字幕' : '一键生成字幕'}
        </Button>
        {!modelLoading && !modelError && modelOptions.length === 0 ? (
          <Text className="subtitle-panel__model-unavailable" size="xs" c="red.4">模型目录中没有可执行的视频理解模型；请在 new-api 启用带视频分析能力和按时长计费的模型。</Text>
        ) : null}
        {error ? <Text className="subtitle-panel__recognition-error" size="xs" c="red">{error}</Text> : null}
        {skipped.length > 0 ? (
          <Text className="subtitle-panel__skipped" size="xs" c="dimmed">
            {skipped.map((s) => s.title || '未命名片段').join('、')}：未提取到台词，可手动添加
          </Text>
        ) : null}
      </Stack>}

      <ScrollArea className="subtitle-panel__body" style={{ flex: 1, minHeight: 0 }} p={12}>
        {view === 'style' ? <Stack className="subtitle-panel__style" gap={12}>
          <SegmentedControl className="subtitle-panel__font-presets" aria-label="字幕字号预设" size="xs" radius={0} fullWidth value={subtitleStyle?.fontSizeRatio === undefined ? fontTier : ''}
            onChange={(value) => { if (value === 'sm' || value === 'md' || value === 'lg') onChangeFontTier(value) }}
            data={[{ value: 'sm', label: '小字' }, { value: 'md', label: '中字' }, { value: 'lg', label: '大字' }]} />
          <SubtitleStyleControls fontTier={fontTier} style={subtitleStyle} onChange={onChangeStyle} />
        </Stack> : <Stack className="subtitle-panel__segments" gap={6}>
          {ordered.length === 0 && !generating ? (
            <Text className="subtitle-panel__empty" size="xs" c="dimmed" ta="center" py={16}>
            还没有字幕。可点击一键生成，或在播放头处手动添加。
            </Text>
          ) : null}
          {ordered.map((seg) => {
            const pos = projected.get(seg.id)
            return (
              <Box className="subtitle-panel__segment"
                ref={selectedSegmentId === seg.id ? selectedRowRef : undefined}
                data-selected={selectedSegmentId === seg.id || undefined}
                key={seg.id}
                p={6}
                style={{
                  opacity: pos ? 1 : 0.45,
                }}
              >
                <Group className="subtitle-panel__segment-header" justify="space-between" gap={4} mb={4} wrap="nowrap">
                  <Text className="subtitle-panel__segment-time"
                    fz={10}
                    c={pos ? 'blue.4' : 'dimmed'}
                    style={{ fontFamily: 'monospace', cursor: pos ? 'pointer' : 'default' }}
                    role={pos ? 'button' : undefined}
                    tabIndex={pos ? 0 : undefined}
                    onClick={() => { onSelect?.(seg.id); if (pos) onSeek(pos.startUs) }}
                    onKeyDown={(event) => { if (pos && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onSelect?.(seg.id); onSeek(pos.startUs) } }}
                    title={pos ? '点击跳转' : '该段已被裁剪，不会烧录'}
                  >
                    {pos ? `${fmtUs(pos.startUs)} → ${fmtUs(pos.endUs)}` : '已被裁剪'}
                    {seg.source === 'manual' ? ' ·手动' : ''}
                  </Text>
                  <ActionIcon className="subtitle-panel__delete" variant="subtle" color="red" size="xs" onClick={() => onDelete(seg.id)} title="删除本段" aria-label={`删除字幕 ${fmtUs(seg.startUs)}`}>
                    <IconTrash className="subtitle-panel__delete-icon" size={11} />
                  </ActionIcon>
                </Group>
                <Textarea className="subtitle-panel__segment-text"
                  aria-label={`字幕内容 ${fmtUs(seg.startUs)}`}
                  size="xs"
                  autosize
                  minRows={1}
                  maxRows={3}
                  value={seg.text}
                  onFocus={() => onSelect?.(seg.id)}
                  onChange={(e) => onUpdateText(seg.id, e.currentTarget.value)}
                  styles={{ input: { background: '#181818', color: '#eee', fontSize: 12 } }}
                />
              </Box>
            )
          })}
        </Stack>}
      </ScrollArea>

      <Box className="subtitle-panel__footer" p={8} style={{ borderTop: '1px solid #2e2e2e' }}>
        <Button className="subtitle-panel__add" size="xs" variant="subtle" fullWidth leftSection={<IconPlus className="subtitle-panel__add-icon" size={12} />} onClick={onAddAtPlayhead}>
          在播放头处加一段
        </Button>
      </Box>
    </Box>
  )
}
