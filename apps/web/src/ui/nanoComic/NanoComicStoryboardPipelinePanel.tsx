import React from 'react'
import { Badge, Button, Group, Image, Stack, Text, Title } from '@mantine/core'
import { InlinePanel } from '../InlinePanel'
import { PanelCard } from '../PanelCard'
import type {
  NanoComicCanvasInsertPayload,
  NanoComicStoryboardChunkItem,
  NanoComicStoryboardProductionItem,
} from './types'
import { getNanoComicEntityKey } from './types'

type NanoComicStoryboardRunSummary = {
  status: 'running' | 'success' | 'error'
  progressText: string
  updatedAtLabel: string
  canLocateGroup: boolean
}

type NanoComicStoryboardPipelinePanelProps = {
  production: NanoComicStoryboardProductionItem | null
  chunks: readonly NanoComicStoryboardChunkItem[]
  linkedEntityKeys: ReadonlySet<string>
  onAddToCanvas: (payload: NanoComicCanvasInsertPayload) => void
  onLocateInCanvas: (entityKey: string) => void
  onLocateLatestStoryboardGroup: () => void
  storyboardRunSummary?: NanoComicStoryboardRunSummary | null
}

function buildChunkCanvasPayload(chunk: NanoComicStoryboardChunkItem): NanoComicCanvasInsertPayload {
  return {
    entityKey: getNanoComicEntityKey('asset', chunk.id),
    entityType: 'asset',
    entityId: chunk.id,
    label: `分镜组 ${chunk.chunkIndex + 1} · 镜头 ${chunk.shotStart}-${chunk.shotEnd}`,
    kind: 'imageEdit',
    summary: `章节分镜产出，覆盖镜头 ${chunk.shotStart}-${chunk.shotEnd}，共 ${chunk.frameCount} 张静态帧。`,
    imageUrl: chunk.previewImageUrl,
    statusLabel: '章节分镜产出',
  }
}

export default function NanoComicStoryboardPipelinePanel({
  production,
  chunks,
  linkedEntityKeys,
  onAddToCanvas,
  onLocateInCanvas,
  onLocateLatestStoryboardGroup,
  storyboardRunSummary,
}: NanoComicStoryboardPipelinePanelProps): JSX.Element {
  const latestChunk = chunks[chunks.length - 1] ?? null
  const latestChunkEntityKey = latestChunk ? getNanoComicEntityKey('asset', latestChunk.id) : ''

  return (
    <PanelCard className="nano-comic-storyboard-pipeline">
      <Stack className="nano-comic-storyboard-pipeline__stack" gap="md">
        <Group className="nano-comic-storyboard-pipeline__header" justify="space-between" align="flex-start">
          <div className="nano-comic-storyboard-pipeline__title-wrap">
            <Text className="nano-comic-storyboard-pipeline__eyebrow" size="xs" fw={800}>
              章节分镜流水线
            </Text>
            <Title className="nano-comic-storyboard-pipeline__title" order={4}>
              这里直接产出 `storyboardPlans / storyboardChunks`
            </Title>
            <Text className="nano-comic-storyboard-pipeline__subtitle" size="sm" c="dimmed">
              章节分镜改由 AI 对话驱动发起；工作台只展示进度、分组结果和入画布操作。
            </Text>
            {production ? (
              <Text className="nano-comic-storyboard-pipeline__subtitle" size="xs" c="dimmed">
                当前续写粒度：{production.groupSize} 镜 / 组
              </Text>
            ) : null}
          </div>
        </Group>

        <div className="nano-comic-storyboard-pipeline__metrics">
          <div className="nano-comic-storyboard-pipeline__metric">
            <Text className="nano-comic-storyboard-pipeline__metric-label" size="xs" c="dimmed">
              计划镜头
            </Text>
            <Text className="nano-comic-storyboard-pipeline__metric-value" size="lg" fw={800}>
              {production?.totalShots ?? 0}
            </Text>
          </div>
          <div className="nano-comic-storyboard-pipeline__metric">
            <Text className="nano-comic-storyboard-pipeline__metric-label" size="xs" c="dimmed">
              已生成分组
            </Text>
            <Text className="nano-comic-storyboard-pipeline__metric-value" size="lg" fw={800}>
              {production ? `${production.generatedChunks}/${production.totalChunks || 0}` : '0/0'}
            </Text>
          </div>
          <div className="nano-comic-storyboard-pipeline__metric">
            <Text className="nano-comic-storyboard-pipeline__metric-label" size="xs" c="dimmed">
              下一续写范围
            </Text>
            <Text className="nano-comic-storyboard-pipeline__metric-value" size="lg" fw={800}>
              {production ? `${production.nextShotStart}-${production.nextShotEnd}` : '--'}
            </Text>
          </div>
          <div className="nano-comic-storyboard-pipeline__metric">
            <Text className="nano-comic-storyboard-pipeline__metric-label" size="xs" c="dimmed">
              连续性尾帧
            </Text>
            <Text className="nano-comic-storyboard-pipeline__metric-value" size="lg" fw={800}>
              {production?.latestTailFrameUrl ? '已记录' : '缺失'}
            </Text>
          </div>
        </div>

        {storyboardRunSummary ? (
          <InlinePanel className="nano-comic-storyboard-pipeline__runtime">
            <Stack className="nano-comic-storyboard-pipeline__runtime-stack" gap={6}>
              <Group className="nano-comic-storyboard-pipeline__runtime-top" justify="space-between" align="center">
                <Text className="nano-comic-storyboard-pipeline__runtime-title" size="xs" fw={800}>
                  当前执行状态
                </Text>
                <Badge
                  className={`nano-comic-storyboard-pipeline__runtime-badge nano-comic-storyboard-pipeline__runtime-badge--${storyboardRunSummary.status}`}
                  radius="sm"
                  variant="light"
                >
                  {storyboardRunSummary.status === 'running'
                    ? '执行中'
                    : storyboardRunSummary.status === 'success'
                      ? '已完成'
                      : '失败'}
                </Badge>
              </Group>
              <Text className="nano-comic-storyboard-pipeline__runtime-text" size="sm">
                {storyboardRunSummary.progressText}
              </Text>
              <Group className="nano-comic-storyboard-pipeline__runtime-actions" gap="sm">
                <Text className="nano-comic-storyboard-pipeline__runtime-time" size="xs" c="dimmed">
                  {storyboardRunSummary.updatedAtLabel}
                </Text>
                <Button
                  className="nano-comic-storyboard-pipeline__runtime-action"
                  size="xs"
                  radius="sm"
                  variant="default"
                  disabled={!storyboardRunSummary.canLocateGroup}
                  onClick={onLocateLatestStoryboardGroup}
                >
                  定位最新产出
                </Button>
              </Group>
            </Stack>
          </InlinePanel>
        ) : null}

        <Stack className="nano-comic-storyboard-pipeline__output-list" gap="sm">
          <Group className="nano-comic-storyboard-pipeline__output-head" justify="space-between" align="center">
            <Text className="nano-comic-storyboard-pipeline__output-title" size="xs" fw={800}>
              已产出分镜组
            </Text>
            <Badge className="nano-comic-storyboard-pipeline__output-badge" variant="light" radius="sm">
              {chunks.length} 组
            </Badge>
          </Group>
          {chunks.length > 0 ? chunks.slice().reverse().map((chunk) => {
            const entityKey = getNanoComicEntityKey('asset', chunk.id)
            const inCanvas = linkedEntityKeys.has(entityKey)
            return (
              <div className="nano-comic-storyboard-pipeline__output-row" key={chunk.id}>
                <div className="nano-comic-storyboard-pipeline__output-preview">
                  {chunk.previewImageUrl ? (
                    <Image
                      className="nano-comic-storyboard-pipeline__output-image"
                      src={chunk.previewImageUrl}
                      alt={`分镜组 ${chunk.chunkIndex + 1}`}
                      radius={0}
                    />
                  ) : (
                    <div className="nano-comic-storyboard-pipeline__output-image-placeholder">
                      <Text className="nano-comic-storyboard-pipeline__output-image-placeholder-text" size="xs" c="dimmed">
                        无预览
                      </Text>
                    </div>
                  )}
                </div>
                <div className="nano-comic-storyboard-pipeline__output-main">
                  <Group className="nano-comic-storyboard-pipeline__output-top" justify="space-between" align="flex-start">
                    <div className="nano-comic-storyboard-pipeline__output-copy">
                      <Text className="nano-comic-storyboard-pipeline__output-name" size="sm" fw={700}>
                        第 {chunk.chunkIndex + 1} 组
                      </Text>
                      <Text className="nano-comic-storyboard-pipeline__output-range" size="xs" c="dimmed">
                        镜头 {chunk.shotStart}-{chunk.shotEnd} · {chunk.frameCount} 张静态帧 · {chunk.groupSize} 镜/组
                      </Text>
                    </div>
                    <Badge className="nano-comic-storyboard-pipeline__output-status" variant="light" radius="sm">
                      {chunk.updatedAtLabel}
                    </Badge>
                  </Group>
                  <Group className="nano-comic-storyboard-pipeline__output-actions" gap="xs">
                    <Button
                      className="nano-comic-storyboard-pipeline__output-action"
                      size="xs"
                      radius="sm"
                      variant="filled"
                      onClick={() => onAddToCanvas(buildChunkCanvasPayload(chunk))}
                    >
                      加入画布
                    </Button>
                    <Button
                      className="nano-comic-storyboard-pipeline__output-action"
                      size="xs"
                      radius="sm"
                      variant="default"
                      disabled={!inCanvas}
                      onClick={() => onLocateInCanvas(entityKey)}
                    >
                      定位画布
                    </Button>
                    {latestChunk && latestChunk.id === chunk.id ? (
                      <Button
                        className="nano-comic-storyboard-pipeline__output-action"
                        size="xs"
                        radius="sm"
                        variant="default"
                        onClick={onLocateLatestStoryboardGroup}
                      >
                        定位最新产出
                      </Button>
                    ) : null}
                  </Group>
                </div>
              </div>
            )
          }) : (
            <Text className="nano-comic-storyboard-pipeline__empty" size="sm" c="dimmed">
              当前章节还没有已落盘的 `storyboardChunks`。请直接通过 AI 对话发起本章分镜生产，新的 chunk 会先写入项目索引，再作为结果节点落到画布。
            </Text>
          )}
          {latestChunk && linkedEntityKeys.has(latestChunkEntityKey) ? (
            <Text className="nano-comic-storyboard-pipeline__linked-hint" size="xs" c="dimmed">
              最新分镜组已入画布，可直接定位。
            </Text>
          ) : null}
        </Stack>
      </Stack>
    </PanelCard>
  )
}
