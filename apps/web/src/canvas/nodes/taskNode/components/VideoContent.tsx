import React from 'react'
import { Badge, Button, Group, Paper, Stack, Text, Tooltip } from '@mantine/core'
import { IconClock, IconPhotoSearch, IconUserPlus } from '@tabler/icons-react'

type FrameSample = {
  url: string
  time: number
  description?: string | null
  describing?: boolean
}

type CharacterCard = {
  id: string
  name: string
  summary?: string
  tags?: string[]
  clipRange?: { start: number; end: number }
  startFrame?: { time: number; url: string }
  endFrame?: { time: number; url: string }
  frames: Array<{ time: number; desc: string }>
}

type VideoResult = {
  url: string
  thumbnailUrl?: string
  title?: string
  duration?: number
}

type FrameCompareSummary = {
  reason?: string
  tags?: string[]
  frames?: Array<{ time?: number; desc?: string }>
}

type VideoContentProps = {
  videoResults: VideoResult[]
  videoPrimaryIndex: number
  videoUrl: string | null
  videoThumbnailUrl?: string | null
  videoTitle?: string | null
  videoSurface: string
  mediaOverlayBackground: string
  mediaOverlayText: string
  mediaFallbackText: string
  mediaFallbackSurface: string
  inlineDividerColor: string
  accentPrimary: string
  rgba: (color: string, alpha: number) => string
  hasPrimaryVideo: boolean
  isSoraVideoVendor: boolean
  isSoraVideoNode: boolean
  frameSamples: FrameSample[]
  frameCaptureLoading: boolean
  handleCaptureVideoFrames: () => void
  handleOpenCharacterCreatorFromVideo: () => void
  cleanupFrameSamples: () => void
  frameCompareTimes: number[]
  toggleFrameCompare: (time: number) => void
  frameCompareLoading: boolean
  handleCompareCharacters: () => void
  characterCardLoading: boolean
  handleGenerateCharacterCards: () => void
  frameCompareResult: string | null
  frameCompareSummary: FrameCompareSummary | null
  frameCompareVerdict: { label: string; color: string } | null
  setFrameCompareTimes: (times: number[]) => void
  describedFrameCount: number
  characterCardError: string | null
  characterCards: CharacterCard[]
  handleOpenCharacterCreatorModal: (card: CharacterCard) => void
  onOpenVideoModal: () => void
}

export function VideoContent({
  videoResults,
  videoPrimaryIndex,
  videoUrl,
  videoThumbnailUrl,
  videoTitle,
  videoSurface,
  mediaOverlayBackground,
  mediaOverlayText,
  mediaFallbackText,
  mediaFallbackSurface,
  inlineDividerColor,
  accentPrimary,
  rgba,
  hasPrimaryVideo,
  isSoraVideoVendor,
  isSoraVideoNode,
  frameSamples,
  frameCaptureLoading,
  handleCaptureVideoFrames,
  handleOpenCharacterCreatorFromVideo,
  cleanupFrameSamples,
  frameCompareTimes,
  toggleFrameCompare,
  frameCompareLoading,
  handleCompareCharacters,
  characterCardLoading,
  handleGenerateCharacterCards,
  frameCompareResult,
  frameCompareSummary,
  frameCompareVerdict,
  setFrameCompareTimes,
  describedFrameCount,
  characterCardError,
  characterCards,
  handleOpenCharacterCreatorModal,
  onOpenVideoModal,
}: VideoContentProps) {
  return (
    <div
      style={{
        marginTop: 6,
        width: '100%',
        minHeight: 160,
        borderRadius: 10,
        background: mediaOverlayBackground,
        padding: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        color: mediaOverlayText,
      }}
    >
      <Group justify="space-between" gap={4}>
        <Text size="xs" c="dimmed">
          {videoResults.length > 0
            ? `共 ${videoResults.length} 个视频${videoPrimaryIndex >= 0 ? ` (主视频: 第 ${videoPrimaryIndex + 1} 个)` : ''}`
            : '视频生成中...'
          }
        </Text>
        <Group gap={2}>
          <Button
            size="compact-xs"
            variant="subtle"
            onClick={onOpenVideoModal}
            leftSection={<IconClock size={12} />}
          >
            {videoResults.length > 0 ? '选择主视频' : '查看历史'}
          </Button>
        </Group>
      </Group>
      <Group gap={6} justify="space-between">
        <Group gap={6}>
          <Button
            size="compact-xs"
            variant="light"
            leftSection={<IconPhotoSearch size={12} />}
            loading={frameCaptureLoading}
            onClick={handleCaptureVideoFrames}
          >
            抽帧预览
          </Button>
          <Button
            size="compact-xs"
            variant="default"
            leftSection={<IconUserPlus size={12} />}
            onClick={handleOpenCharacterCreatorFromVideo}
            disabled={!hasPrimaryVideo || !isSoraVideoVendor}
            title="直接生成角色卡，跳过逐帧解析"
          >
            生成角色卡
          </Button>
        </Group>
        {frameSamples.length > 0 && (
          <Button size="compact-xs" variant="subtle" onClick={cleanupFrameSamples}>
            清空帧
          </Button>
        )}
      </Group>
      {frameSamples.length > 0 && (
        <Group gap={6} justify="space-between">
          <Button
            size="compact-xs"
            variant="default"
            loading={frameCompareLoading}
            onClick={handleCompareCharacters}
          >
            AI 判同人
          </Button>
          <Button
            size="compact-xs"
            variant="light"
            loading={characterCardLoading}
            onClick={handleGenerateCharacterCards}
            title="使用帧描述聚类生成角色卡，适合需要精确分镜的场景"
          >
            逐帧解析角色卡
          </Button>
        </Group>
      )}
      {isSoraVideoNode && (
        <Text size="xs" c="dimmed" style={{ lineHeight: 1.35 }}>
          “逐帧解析角色卡” 会抽帧+聚类；“一键生成角色卡” 直接跳到资产面板，由你自行选择截取区间。
        </Text>
      )}

      {videoUrl ? (
        <video
          src={videoResults[videoPrimaryIndex]?.url || videoUrl}
          poster={videoResults[videoPrimaryIndex]?.thumbnailUrl || videoThumbnailUrl || undefined}
          controls
          loop
          muted
          playsInline
          style={{
            borderRadius: 8,
            width: '100%',
            height: 160,
            objectFit: 'cover',
            backgroundColor: videoSurface,
          }}
        />
      ) : (
        <div
          style={{
            height: 160,
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: mediaFallbackText,
            fontSize: 12,
          }}
        >
          等待 Sora 视频生成完成…
        </div>
      )}
      {videoTitle && (
        <Text size="xs" lineClamp={1} c="dimmed">
          {videoTitle}
        </Text>
      )}
      {frameSamples.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))', gap: 6 }}>
          {frameSamples.map((f) => {
            const active = frameCompareTimes.includes(f.time)
            return (
              <div
                key={`${f.url}-${f.time}`}
                style={{ display: 'flex', flexDirection: 'column', gap: 4, cursor: 'pointer' }}
                onClick={() => toggleFrameCompare(f.time)}
                title={active ? '已加入对比，点击取消' : '加入对比'}
              >
                <div
                  style={{
                    borderRadius: 8,
                    overflow: 'hidden',
                    background: mediaFallbackSurface,
                    border: active ? `2px solid ${accentPrimary}` : `1px solid ${inlineDividerColor}`,
                    width: '100%',
                    aspectRatio: '4 / 3',
                    boxShadow: active ? `0 0 0 2px ${rgba(accentPrimary, 0.2)}` : 'none',
                  }}
                >
                  <img
                    src={f.url}
                    alt={`frame-${f.time.toFixed(2)}s`}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                </div>
                <Tooltip
                  label={(!f.describing && f.description) ? f.description : undefined}
                  disabled={!f.description || f.describing}
                  withinPortal
                  multiline
                  maw={280}
                  position="top"
                  withArrow
                >
                  <Text size="xs" c="dimmed">
                    {f.time.toFixed(2)}s
                  </Text>
                </Tooltip>
                {f.describing && (
                  <Text size="xs" c="dimmed">
                    解析中...
                  </Text>
                )}
              </div>
            )
          })}
        </div>
      )}
      {frameCompareTimes.length > 0 && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Group justify="space-between" gap={6}>
            <Text size="xs" fw={600}>
              对比视图（{frameCompareTimes.length}）
            </Text>
            <Button size="compact-xs" variant="subtle" onClick={() => setFrameCompareTimes([])}>
              清空对比
            </Button>
          </Group>
          <div style={{ display: 'grid', gridTemplateColumns: frameCompareTimes.length > 1 ? 'repeat(auto-fit, minmax(120px, 1fr))' : '1fr', gap: 8 }}>
            {frameCompareTimes.map((t) => {
              const f = frameSamples.find((fs) => fs.time === t)
              if (!f) return null
              return (
                <div key={`compare-${t}`} style={{ border: `1px solid ${inlineDividerColor}`, borderRadius: 10, overflow: 'hidden', background: mediaFallbackSurface }}>
                  <img src={f.url} alt={`compare-${t}`} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  <div style={{ padding: '6px 8px' }}>
                    <Text size="xs" c="dimmed">
                      {t.toFixed(2)}s
                    </Text>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
      {frameCompareResult && (
        <Paper shadow="xs" radius="md" withBorder p="sm" style={{ marginTop: 8, background: mediaOverlayBackground, color: mediaOverlayText }}>
          <Group justify="space-between" gap={6} mb={4}>
            <Text size="xs" fw={600}>
              AI 判定
            </Text>
            {frameCompareVerdict && (
              <Badge size="xs" color={frameCompareVerdict.color} variant="filled">
                {frameCompareVerdict.label}
              </Badge>
            )}
          </Group>
          {frameCompareSummary ? (
            <>
              {frameCompareSummary.reason && (
                <Text size="xs" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  理由：{frameCompareSummary.reason}
                </Text>
              )}
              {frameCompareSummary.tags && frameCompareSummary.tags.length > 0 && (
                <Group gap={4} mt={frameCompareSummary.reason ? 6 : 0} wrap="wrap">
                  {frameCompareSummary.tags.map((tag) => (
                    <Badge key={tag} size="xs" variant="light" color="blue">
                      {tag}
                    </Badge>
                  ))}
                </Group>
              )}
              {frameCompareSummary.frames && frameCompareSummary.frames.length > 0 && (
                <Stack gap={4} mt={frameCompareSummary.tags && frameCompareSummary.tags.length > 0 ? 6 : 10}>
                  {frameCompareSummary.frames.map((frame, idx) => (
                    <Group key={`frame-summary-${frame.time ?? idx}`} gap={6} align="flex-start" wrap="nowrap">
                      <Badge size="xs" variant="outline" color="gray">
                        {typeof frame.time === 'number' ? `${frame.time.toFixed(2)}s` : `帧 ${idx + 1}`}
                      </Badge>
                      <Text size="xs" style={{ flex: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {frame.desc || '无描述'}
                      </Text>
                    </Group>
                  ))}
                </Stack>
              )}
            </>
          ) : (
            <Text size="xs" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {frameCompareResult}
            </Text>
          )}
        </Paper>
      )}
      {characterCardLoading && (
        <Text size="xs" c="dimmed" mt={8}>
          正在生成角色卡… (已解析 {describedFrameCount} 帧)
        </Text>
      )}
      {characterCardError && (
        <Text size="xs" c="red" mt={4}>
          {characterCardError}
        </Text>
      )}
      {characterCards.length > 0 && (
        <Stack gap={6} mt={8}>
          <Text size="xs" fw={600}>
            角色卡（{characterCards.length}）
          </Text>
          <Stack gap={8}>
            {characterCards.map((card) => (
              <Paper key={card.id} withBorder radius="md" p="sm" style={{ background: mediaOverlayBackground, color: mediaOverlayText }}>
                <Group justify="space-between" gap={6} mb={6} align="flex-start">
                  <div>
                    <Text size="sm" fw={600}>
                      {card.name}
                    </Text>
                    {card.summary && (
                      <Text size="xs" c="dimmed" style={{ whiteSpace: 'pre-wrap' }}>
                        {card.summary}
                      </Text>
                    )}
                    {card.clipRange && (
                      <Text size="xs" c="dimmed">
                        片段 {card.clipRange.start.toFixed(2)}s - {card.clipRange.end.toFixed(2)}s（{(card.clipRange.end - card.clipRange.start).toFixed(2)}s）
                      </Text>
                    )}
                  </div>
                  {card.tags && card.tags.length > 0 && (
                    <Group gap={4} wrap="wrap" justify="flex-end">
                      {card.tags.map((tag) => (
                        <Badge key={`${card.id}-${tag}`} size="xs" variant="light" color="blue">
                          {tag}
                        </Badge>
                      ))}
                    </Group>
                  )}
                </Group>
                {(card.startFrame || card.endFrame) && (
                  <Group gap={8} mb={6} align="stretch">
                    {card.startFrame && (
                      <div style={{ flex: 1 }}>
                        <Text size="xs" c="dimmed" mb={2}>
                          首次出现 {card.startFrame.time.toFixed(2)}s
                        </Text>
                        <div style={{ borderRadius: 8, overflow: 'hidden', border: `1px solid ${inlineDividerColor}` }}>
                          <img src={card.startFrame.url} alt={`${card.name}-start`} style={{ width: '100%', display: 'block' }} />
                        </div>
                      </div>
                    )}
                    {card.endFrame && (
                      <div style={{ flex: 1 }}>
                        <Text size="xs" c="dimmed" mb={2}>
                          最后出现 {card.endFrame.time.toFixed(2)}s
                        </Text>
                        <div style={{ borderRadius: 8, overflow: 'hidden', border: `1px solid ${inlineDividerColor}` }}>
                          <img src={card.endFrame.url} alt={`${card.name}-end`} style={{ width: '100%', display: 'block' }} />
                        </div>
                      </div>
                    )}
                  </Group>
                )}
                <Stack gap={4}>
                  {card.frames.map((frame) => (
                    <Group key={`${card.id}-${frame.time}`} gap={6} align="flex-start">
                      <Badge size="xs" variant="outline" color="gray">
                        {frame.time.toFixed(2)}s
                      </Badge>
                      <Text size="xs" style={{ whiteSpace: 'pre-wrap' }}>
                        {frame.desc}
                      </Text>
                    </Group>
                  ))}
                </Stack>
                <Group justify="flex-end" gap={6} mt={8}>
                  <Tooltip label="打开创建角色弹窗" withArrow>
                    <Button
                      size="compact-xs"
                      variant="outline"
                      leftSection={<IconUserPlus size={12} />}
                      onClick={() => handleOpenCharacterCreatorModal(card)}
                    >
                      一键创建角色
                    </Button>
                  </Tooltip>
                </Group>
              </Paper>
            ))}
          </Stack>
        </Stack>
      )}
    </div>
  )
}
