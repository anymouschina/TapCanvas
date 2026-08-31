import React from 'react'
import { Button, Text, Stack, Group, Box, ActionIcon, Tooltip, Textarea } from '@mantine/core'
import { IconScissors, IconDownload, IconRefresh, IconPlus, IconArrowsMaximize } from '@tabler/icons-react'
import { ManagedImage } from '../../../../domain/resource-runtime/components/ManagedImage'

type VideoComposeContentProps = {
  upstreamVideos: { url: string; title?: string; thumbnailUrl?: string; durationSec?: number }[]
  composedVideoUrl: string | null
  videoSurface: string
  mediaFallbackText: string
  nodeHeight?: number
  onOpenEditor: () => void
  onDownload: () => void
  /** 下载进行中：下载按钮转 loading，防重复点击 */
  downloading?: boolean
  /** 编排器产出的 compose 节点只展示真实交付，不允许本地 WebAV 覆盖成片。 */
  orchestrated?: boolean
  /** 自然语言剪辑意图，交给编辑器/agents 使用，不在 Web 端做语义解析。 */
  prompt?: string
  onPromptChange?: (value: string) => void
  onAddReference?: () => void
}

export function VideoComposeContent({
  upstreamVideos,
  composedVideoUrl,
  videoSurface,
  mediaFallbackText,
  nodeHeight,
  onOpenEditor,
  onDownload,
  downloading = false,
  orchestrated = false,
  prompt = '',
  onPromptChange,
  onAddReference,
}: VideoComposeContentProps): JSX.Element {
  const ready = upstreamVideos.length >= 1
  const durationSec = Math.max(0, ...upstreamVideos.map((source) => source.durationSec || 0))
  const rulerTicks = durationSec > 0
    ? Array.from({ length: Math.floor(durationSec / 2) + 1 }, (_, index) => index * 2)
    : []

  if (orchestrated) {
    return (
      <Stack className="tc-video-compose-content tc-video-compose-content--orchestrated" gap={8}>
        {composedVideoUrl ? (
          <Box className="tc-video-compose-content__orchestrated-video">
            <video
              className="tc-video-compose-content__video"
              src={composedVideoUrl}
              preload="metadata"
              controls
            />
          </Box>
        ) : (
          <Stack className="tc-video-compose-content__orchestrated-pending" gap={6} align="center" justify="center">
            <IconScissors className="tc-video-compose-content__orchestrated-icon" size={30} />
            <Text className="tc-video-compose-content__orchestrated-pending-text" size="xs" c="dimmed" ta="center">
              等待小T写回真实 concatVideoUrl
            </Text>
          </Stack>
        )}
        <Text className="tc-video-compose-content__orchestrated-note" size="xs" c="dimmed">
          这是编排 run 的服务端成片，只读展示；修订或恢复请使用上方镜头生产包动作。
        </Text>
      </Stack>
    )
  }

  if (composedVideoUrl) {
    const videoAreaHeight = nodeHeight ? Math.max(80, nodeHeight - 48) : 220
    return (
      <Stack gap={8} style={{ padding: '8px 0', height: nodeHeight ?? 'auto' }}>
        <Box style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', background: '#000', flex: 1, height: videoAreaHeight }}>
          <video
            src={composedVideoUrl}
            preload="metadata"
            controls
            style={{ width: '100%', height: '100%', display: 'block', objectFit: 'contain' }}
          />
        </Box>
        <Textarea
          className="nodrag"
          value={prompt}
          onChange={(event) => onPromptChange?.(event.currentTarget.value)}
          placeholder="描述想剪成什么效果（可选）"
          autosize
          minRows={1}
          maxRows={3}
          size="xs"
          styles={{ input: { background: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.12)' } }}
        />
        <Group gap={6} justify="flex-end" style={{ flexShrink: 0 }}>
          <Tooltip label="下载合成视频" withArrow>
            <ActionIcon variant="default" size="sm" loading={downloading} onClick={onDownload}>
              <IconDownload size={14} />
            </ActionIcon>
          </Tooltip>
          <Button size="xs" variant="default" leftSection={<IconRefresh size={12} />} onClick={onOpenEditor} disabled={!ready}>
            重新编辑
          </Button>
        </Group>
      </Stack>
    )
  }

  return (
    <Stack
      className="tc-video-compose-content tc-video-compose-content--smart-edit"
      gap={10}
      style={{ background: videoSurface, borderRadius: 10, minHeight: nodeHeight ?? 360, padding: 10 }}
    >
      <Box className="tc-video-compose-content__smart-preview" onClick={ready ? onOpenEditor : undefined}>
        {ready ? (
          <video
            className="tc-video-compose-content__smart-preview-video"
            src={upstreamVideos[0]?.url}
            poster={upstreamVideos[0]?.thumbnailUrl}
            preload="metadata"
            muted
            playsInline
          />
        ) : null}
        <Box className="tc-video-compose-content__smart-preview-overlay">
          <IconScissors size={38} />
          {ready ? (
            <Button size="xs" variant="white" leftSection={<IconScissors size={13} />} onClick={(event) => { event.stopPropagation(); onOpenEditor() }}>
              打开智能剪辑
            </Button>
          ) : <Text size="xs" c="dimmed">连接至少 1 个视频节点</Text>}
        </Box>
      </Box>

      <Box className="tc-video-compose-content__smart-ruler">
        {rulerTicks.map((tick) => <Text key={tick} size="10px" c="dimmed">{tick === 0 ? '0' : `${tick}s`}</Text>)}
      </Box>
      <Box className="tc-video-compose-content__smart-track" />
      <Box className="tc-video-compose-content__smart-track tc-video-compose-content__smart-track--secondary" />

      <Box className="tc-video-compose-content__reference-panel">
        <Group gap={6} mb={6}>
          <Button className="nodrag" size="xs" variant="subtle" leftSection={<IconPlus size={14} />} onClick={onAddReference}>
            参考
          </Button>
          <ActionIcon className="nodrag" variant="subtle" size="sm" title="全屏编辑器" onClick={onOpenEditor} disabled={!ready}>
            <IconArrowsMaximize size={15} />
          </ActionIcon>
        </Group>
        <Group gap={6} wrap="nowrap" style={{ overflowX: 'auto' }}>
          {upstreamVideos.map((source, index) => source.thumbnailUrl ? (
            <Box key={`${source.url}-${index}`} className="tc-video-compose-content__reference-thumb">
              <ManagedImage
                className="tc-video-compose-content__source-thumb"
                src={source.thumbnailUrl}
                alt={source.title || `视频 ${index + 1}`}
                priority="visible"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
              {source.durationSec ? <Text size="10px" className="tc-video-compose-content__reference-duration">{source.durationSec.toFixed(1)}s</Text> : null}
            </Box>
          ) : null)}
        </Group>
        <Textarea
          className="nodrag tc-video-compose-content__prompt"
          value={prompt}
          onChange={(event) => onPromptChange?.(event.currentTarget.value)}
          placeholder="描述想剪成什么效果"
          autosize
          minRows={2}
          maxRows={4}
          size="sm"
          disabled={!ready}
          styles={{ input: { background: 'transparent', border: 0, paddingInline: 0 } }}
        />
      </Box>
    </Stack>
  )
}
