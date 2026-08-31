import React from 'react'
import { Box, Button, Group, Text, Stack, ActionIcon, Textarea, SegmentedControl, ScrollArea, Select } from '@mantine/core'
import { IconSparkles, IconTrash, IconPlus, IconX } from '@tabler/icons-react'
import type { SubtitleSegment, SubtitleFontSizeTier } from './types'
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
  /** segmentId → 时间线位置（被完全裁掉的段无条目） */
  projected: Map<string, { startUs: number; endUs: number }>
  fontTier: SubtitleFontSizeTier
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
    segments, projected, fontTier, generating, error, skipped, canGenerate,
    modelOptions, selectedModel, modelLoading, modelError,
    onGenerate, onChangeModel, onChangeFontTier, onUpdateText, onDelete, onAddAtPlayhead, onSeek, onClosePanel,
  } = props

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
    <Box style={{ width: 280, flexShrink: 0, display: 'flex', flexDirection: 'column', background: '#181818', borderRight: '1px solid #2e2e2e', minHeight: 0 }}>
      <Group justify="space-between" px={12} py={8} style={{ borderBottom: '1px solid #2e2e2e' }}>
        <Text size="sm" fw={500} c="white">智能字幕</Text>
        <ActionIcon variant="subtle" color="gray" size="sm" onClick={onClosePanel} title="收起面板">
          <IconX size={13} />
        </ActionIcon>
      </Group>

      <Stack gap={8} p={12} style={{ borderBottom: '1px solid #2e2e2e' }}>
        <Text size="10px" c="yellow.4">
          “一键生成字幕”会调用 new-api 视频理解模型，识别视频中真实可听见的人声并返回时间轴；字幕文字不会从节点台词猜测。
        </Text>
        <Select
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
        <Button
          size="xs"
          leftSection={<IconSparkles size={13} />}
          loading={generating}
          disabled={!canGenerate || !selectedModel}
          onClick={onGenerate}
        >
          {segments.some((s) => s.source === 'auto') ? '重新生成字幕' : '一键生成字幕'}
        </Button>
        {!modelLoading && !modelError && modelOptions.length === 0 ? (
          <Text size="xs" c="red.4">模型目录中没有可执行的视频理解模型；请在 new-api 启用带视频分析能力和按时长计费的模型。</Text>
        ) : null}
        <Group gap={8} align="center" wrap="nowrap">
          <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>字号</Text>
          <SegmentedControl
            size="xs"
            fullWidth
            style={{ flex: 1 }}
            value={fontTier}
            onChange={(v) => onChangeFontTier(v as SubtitleFontSizeTier)}
            data={[{ value: 'sm', label: '小' }, { value: 'md', label: '中' }, { value: 'lg', label: '大' }]}
          />
        </Group>
        {error ? <Text size="xs" c="red">{error}</Text> : null}
        {skipped.length > 0 ? (
          <Text size="xs" c="dimmed">
            {skipped.map((s) => s.title || '未命名片段').join('、')}：未提取到台词，可手动添加
          </Text>
        ) : null}
      </Stack>

      <ScrollArea style={{ flex: 1, minHeight: 0 }} p={8}>
        <Stack gap={6}>
          {ordered.length === 0 && !generating ? (
            <Text size="xs" c="dimmed" ta="center" py={16}>
            还没有字幕。可点击一键生成，或在播放头处手动添加。
            </Text>
          ) : null}
          {ordered.map((seg) => {
            const pos = projected.get(seg.id)
            return (
              <Box
                key={seg.id}
                p={6}
                style={{
                  borderRadius: 6,
                  background: '#212121',
                  border: '1px solid #2e2e2e',
                  opacity: pos ? 1 : 0.45,
                }}
              >
                <Group justify="space-between" gap={4} mb={4} wrap="nowrap">
                  <Text
                    fz={10}
                    c={pos ? 'blue.4' : 'dimmed'}
                    style={{ fontFamily: 'monospace', cursor: pos ? 'pointer' : 'default' }}
                    onClick={() => pos && onSeek(pos.startUs)}
                    title={pos ? '点击跳转' : '该段已被裁剪，不会烧录'}
                  >
                    {pos ? `${fmtUs(pos.startUs)} → ${fmtUs(pos.endUs)}` : '已被裁剪'}
                    {seg.source === 'manual' ? ' ·手动' : ''}
                  </Text>
                  <ActionIcon variant="subtle" color="red" size="xs" onClick={() => onDelete(seg.id)} title="删除本段">
                    <IconTrash size={11} />
                  </ActionIcon>
                </Group>
                <Textarea
                  size="xs"
                  autosize
                  minRows={1}
                  maxRows={3}
                  value={seg.text}
                  onChange={(e) => onUpdateText(seg.id, e.currentTarget.value)}
                  styles={{ input: { background: '#181818', color: '#eee', fontSize: 12 } }}
                />
              </Box>
            )
          })}
        </Stack>
      </ScrollArea>

      <Box p={8} style={{ borderTop: '1px solid #2e2e2e' }}>
        <Button size="xs" variant="default" fullWidth leftSection={<IconPlus size={12} />} onClick={onAddAtPlayhead}>
          在播放头处加一段
        </Button>
      </Box>
    </Box>
  )
}
