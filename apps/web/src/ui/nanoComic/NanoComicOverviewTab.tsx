import React from 'react'
import { Badge, Group, Paper, Progress, SimpleGrid, Stack, Text, Title } from '@mantine/core'
import type {
  NanoComicActivityItem,
  NanoComicConversationArtifactItem,
  NanoComicEpisodeItem,
  NanoComicMetricCard,
  NanoComicRiskItem,
} from './types'

type NanoComicOverviewTabProps = {
  metrics: readonly NanoComicMetricCard[]
  episodes: readonly NanoComicEpisodeItem[]
  risks: readonly NanoComicRiskItem[]
  activities: readonly NanoComicActivityItem[]
  conversationArtifacts: readonly NanoComicConversationArtifactItem[]
  conversationArtifactsLoading?: boolean
  conversationArtifactsError?: string | null
  emptyStateMessage?: string | null
}

function getMetricToneClassName(tone: NanoComicMetricCard['tone']): string {
  return `nano-comic-overview__metric-card nano-comic-overview__metric-card--${tone}`
}

function getRiskToneLabel(level: NanoComicRiskItem['level']): string {
  if (level === 'blocked') return '阻塞'
  if (level === 'stale') return '过期'
  return '预警'
}

export default function NanoComicOverviewTab({
  metrics,
  episodes,
  risks,
  activities,
  conversationArtifacts,
  conversationArtifactsLoading,
  conversationArtifactsError,
  emptyStateMessage,
}: NanoComicOverviewTabProps): JSX.Element {
  return (
    <div className="nano-comic-overview">
      <SimpleGrid className="nano-comic-overview__metric-grid" cols={{ base: 1, md: 2, xl: 4 }} spacing="md">
        {metrics.map((metric) => (
          <Paper className={getMetricToneClassName(metric.tone)} key={metric.id} p="md" radius="md">
            <Stack className="nano-comic-overview__metric-stack" gap={8}>
              <Text className="nano-comic-overview__metric-title" size="xs" fw={700}>
                {metric.title}
              </Text>
              <Text className="nano-comic-overview__metric-value" size="xl" fw={800}>
                {metric.value}
              </Text>
              <Text className="nano-comic-overview__metric-detail" size="sm" c="dimmed">
                {metric.detail}
              </Text>
            </Stack>
          </Paper>
        ))}
      </SimpleGrid>

      {emptyStateMessage ? (
        <Paper className="nano-comic-overview__empty-panel" p="xl" radius="md">
          <Stack className="nano-comic-overview__empty-stack" gap="sm">
            <Title className="nano-comic-overview__empty-title" order={4}>
              当前项目还没有可展示的源书数据
            </Title>
            <Text className="nano-comic-overview__empty-text" size="sm">
              {emptyStateMessage}
            </Text>
          </Stack>
        </Paper>
      ) : null}

      <div className="nano-comic-overview__body-grid">
        <Paper className="nano-comic-overview__episodes-panel" p="md" radius="md">
          <Stack className="nano-comic-overview__episodes-stack" gap="md">
            <Group className="nano-comic-overview__section-header" justify="space-between">
              <Title className="nano-comic-overview__section-title" order={4}>
                剧集推进
              </Title>
              <Text className="nano-comic-overview__section-meta" size="sm" c="dimmed">
                当前项目的阶段总览
              </Text>
            </Group>
            <Stack className="nano-comic-overview__episode-list" gap="sm">
              {episodes.length > 0 ? episodes.map((episode) => (
                <div
                  className={`nano-comic-overview__episode-row${episode.isCurrentChapter ? ' nano-comic-overview__episode-row--current' : ''}`}
                  key={episode.id}
                >
                  <Group className="nano-comic-overview__episode-top" justify="space-between" align="flex-start">
                    <div className="nano-comic-overview__episode-title-wrap">
                      <Text className="nano-comic-overview__episode-code" size="xs" fw={800}>
                        {episode.code}
                      </Text>
                      <Title className="nano-comic-overview__episode-title" order={5}>
                        {episode.title}
                      </Title>
                    </div>
                    <Badge className="nano-comic-overview__episode-stage" variant="light" radius="sm">
                      {episode.stage}
                    </Badge>
                  </Group>
                  {episode.runtimeStatus && episode.runtimeText ? (
                    <div className="nano-comic-overview__episode-runtime">
                      <Group className="nano-comic-overview__episode-runtime-top" justify="space-between" align="center">
                        <Badge
                          className={`nano-comic-overview__episode-runtime-badge nano-comic-overview__episode-runtime-badge--${episode.runtimeStatus}`}
                          radius="sm"
                          variant="light"
                        >
                          {episode.runtimeStatus === 'running'
                            ? '执行中'
                            : episode.runtimeStatus === 'success'
                              ? '已完成'
                              : '失败'}
                        </Badge>
                        {episode.runtimeUpdatedAtLabel ? (
                          <Text className="nano-comic-overview__episode-runtime-time" size="xs" c="dimmed">
                            {episode.runtimeUpdatedAtLabel}
                          </Text>
                        ) : null}
                      </Group>
                      <Text className="nano-comic-overview__episode-runtime-text" size="xs">
                        {episode.runtimeText}
                      </Text>
                    </div>
                  ) : null}
                  <div className="nano-comic-overview__episode-progress">
                    <Text className="nano-comic-overview__episode-progress-label" size="xs" c="dimmed">
                      分镜 {episode.storyboardProgress}% / 视频 {episode.videoProgress}%
                    </Text>
                    <Progress
                      className="nano-comic-overview__episode-progress-bar"
                      size="sm"
                      radius="md"
                      value={episode.storyboardProgress}
                    />
                  </div>
                  <Group className="nano-comic-overview__episode-meta" justify="space-between">
                    <Text className="nano-comic-overview__episode-owner" size="sm">
                      负责人：{episode.ownerName}
                    </Text>
                    <Text className="nano-comic-overview__episode-review" size="sm" c="dimmed">
                      待审核 {episode.reviewCount}
                    </Text>
                  </Group>
                </div>
              )) : (
                <Text className="nano-comic-overview__empty-inline" size="sm" c="dimmed">
                  暂无章节摘要。
                </Text>
              )}
            </Stack>
          </Stack>
        </Paper>

        <Paper className="nano-comic-overview__risks-panel" p="md" radius="md">
          <Stack className="nano-comic-overview__risks-stack" gap="md">
            <Group className="nano-comic-overview__section-header" justify="space-between">
              <Title className="nano-comic-overview__section-title" order={4}>
                风险与阻塞
              </Title>
              <Text className="nano-comic-overview__section-meta" size="sm" c="dimmed">
                先处理最影响下游的项
              </Text>
            </Group>
            <Stack className="nano-comic-overview__risk-list" gap="sm">
              {risks.length > 0 ? risks.map((risk) => (
                <div className="nano-comic-overview__risk-row" key={risk.id}>
                  <Group className="nano-comic-overview__risk-top" justify="space-between" align="flex-start">
                    <Title className="nano-comic-overview__risk-title" order={5}>
                      {risk.title}
                    </Title>
                    <Badge className={`nano-comic-overview__risk-badge nano-comic-overview__risk-badge--${risk.level}`} radius="sm">
                      {getRiskToneLabel(risk.level)}
                    </Badge>
                  </Group>
                  <Text className="nano-comic-overview__risk-detail" size="sm">
                    {risk.detail}
                  </Text>
                  <Text className="nano-comic-overview__risk-impact" size="sm" c="dimmed">
                    {risk.impact}
                  </Text>
                </div>
              )) : (
                <Text className="nano-comic-overview__empty-inline" size="sm" c="dimmed">
                  当前没有需要提示的风险。
                </Text>
              )}
            </Stack>
          </Stack>
        </Paper>
      </div>

      <Paper className="nano-comic-overview__activity-panel" p="md" radius="md">
        <Stack className="nano-comic-overview__activity-stack" gap="md">
          <Group className="nano-comic-overview__section-header" justify="space-between">
            <Title className="nano-comic-overview__section-title" order={4}>
              最近活动
            </Title>
            <Text className="nano-comic-overview__section-meta" size="sm" c="dimmed">
              项目内最近一次变化
            </Text>
          </Group>
          <Stack className="nano-comic-overview__activity-list" gap="sm">
            {activities.length > 0 ? activities.map((activity) => (
              <Group className="nano-comic-overview__activity-row" key={activity.id} justify="space-between" align="flex-start">
                <div className="nano-comic-overview__activity-text-wrap">
                  <Text className="nano-comic-overview__activity-main" size="sm">
                    <Text className="nano-comic-overview__activity-actor" component="span" fw={700}>
                      {activity.actorName}
                    </Text>
                    {' '}
                    {activity.action}
                    {' '}
                    <Text className="nano-comic-overview__activity-target" component="span" c="dimmed">
                      {activity.target}
                    </Text>
                  </Text>
                </div>
                <Text className="nano-comic-overview__activity-time" size="sm" c="dimmed">
                  {activity.timeLabel}
                </Text>
              </Group>
            )) : (
              <Text className="nano-comic-overview__empty-inline" size="sm" c="dimmed">
                当前还没有最近活动记录。
              </Text>
            )}
          </Stack>
        </Stack>
      </Paper>

      <Paper className="nano-comic-overview__conversation-panel" p="md" radius="md">
        <Stack className="nano-comic-overview__conversation-stack" gap="md">
          <Group className="nano-comic-overview__section-header" justify="space-between">
            <Title className="nano-comic-overview__section-title" order={4}>
              对话产物历史
            </Title>
            <Text className="nano-comic-overview__section-meta" size="sm" c="dimmed">
              当前项目对话里最近落下的真实产物
            </Text>
          </Group>
          <Stack className="nano-comic-overview__conversation-list" gap="sm">
            {conversationArtifactsLoading ? (
              <Text className="nano-comic-overview__empty-inline" size="sm" c="dimmed">
                正在读取对话产物历史…
              </Text>
            ) : conversationArtifactsError ? (
              <Text className="nano-comic-overview__empty-inline" size="sm" c="dimmed">
                {conversationArtifactsError}
              </Text>
            ) : conversationArtifacts.length > 0 ? conversationArtifacts.map((item) => (
              <div className="nano-comic-overview__conversation-row" key={item.id}>
                {item.previewImageUrl ? (
                  <div className="nano-comic-overview__conversation-preview-wrap">
                    <img
                      className="nano-comic-overview__conversation-preview"
                      src={item.previewImageUrl}
                      alt={item.promptPreview}
                    />
                  </div>
                ) : (
                  <div className="nano-comic-overview__conversation-preview-wrap nano-comic-overview__conversation-preview-wrap--empty">
                    <Text className="nano-comic-overview__conversation-preview-empty" size="xs">
                      无预览
                    </Text>
                  </div>
                )}
                <div className="nano-comic-overview__conversation-main">
                  <Group className="nano-comic-overview__conversation-top" justify="space-between" align="flex-start">
                    <div className="nano-comic-overview__conversation-title-wrap">
                      <Text className="nano-comic-overview__conversation-label" size="xs" fw={800}>
                        {item.sessionLabel}
                      </Text>
                      <Text className="nano-comic-overview__conversation-prompt" size="sm" fw={700}>
                        {item.promptPreview}
                      </Text>
                    </div>
                    <Badge className="nano-comic-overview__conversation-badge" variant="light" radius="sm">
                      {item.assetCountLabel}
                    </Badge>
                  </Group>
                  <Text className="nano-comic-overview__conversation-response" size="sm" c="dimmed">
                    {item.responsePreview}
                  </Text>
                  <Group className="nano-comic-overview__conversation-meta" justify="space-between" align="center">
                    <Text className="nano-comic-overview__conversation-time" size="xs" c="dimmed">
                      {item.updatedAtLabel}
                    </Text>
                    <Text className="nano-comic-overview__conversation-session" size="xs" c="dimmed">
                      {item.sessionKey}
                    </Text>
                  </Group>
                </div>
              </div>
            )) : (
              <Text className="nano-comic-overview__empty-inline" size="sm" c="dimmed">
                当前项目还没有可回显到工作台的对话产物历史。
              </Text>
            )}
          </Stack>
        </Stack>
      </Paper>
    </div>
  )
}
