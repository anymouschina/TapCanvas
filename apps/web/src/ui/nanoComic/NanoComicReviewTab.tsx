import React from 'react'
import { Badge, Button, Group, Paper, Stack, Text, Title } from '@mantine/core'
import type { NanoComicCanvasInsertPayload, NanoComicMetricCard, NanoComicReviewItem } from './types'
import { getNanoComicEntityKey } from './types'

type NanoComicReviewTabProps = {
  metrics: readonly NanoComicMetricCard[]
  items: readonly NanoComicReviewItem[]
  selectedReviewId: string
  onSelectReview: (reviewId: string) => void
  onApproveReview: (review: NanoComicReviewItem) => void
  onRejectReview: (review: NanoComicReviewItem) => void
  onDeleteReview: (review: NanoComicReviewItem) => void
  onAddToCanvas: (payload: NanoComicCanvasInsertPayload) => void
  onLocateInCanvas: (entityKey: string) => void
  onOpenAssetsPanel: () => void
  linkedEntityKeys: ReadonlySet<string>
  reviewActionPendingId?: string | null
  emptyStateMessage?: string | null
}

function buildReviewCanvasPayload(item: NanoComicReviewItem): NanoComicCanvasInsertPayload {
  return {
    entityKey: getNanoComicEntityKey(item.entityType, item.id),
    entityType: item.entityType,
    entityId: item.id,
    label: item.title,
    kind: item.canvasKind,
    summary: item.summary,
    imageUrl: item.previewImageUrl,
    statusLabel: item.riskLevel,
  }
}

function getReviewRiskLabel(level: NanoComicReviewItem['riskLevel']): string {
  if (level === 'blocked') return '阻塞'
  if (level === 'warning') return '预警'
  return '待处理'
}

export default function NanoComicReviewTab({
  metrics,
  items,
  selectedReviewId,
  onSelectReview,
  onApproveReview,
  onRejectReview,
  onDeleteReview,
  onAddToCanvas,
  onLocateInCanvas,
  onOpenAssetsPanel,
  linkedEntityKeys,
  reviewActionPendingId,
  emptyStateMessage,
}: NanoComicReviewTabProps): JSX.Element {
  const selectedReview = React.useMemo(
    () => items.find((item) => item.id === selectedReviewId) ?? items[0] ?? null,
    [items, selectedReviewId],
  )
  const canReviewRoleCard = selectedReview?.entityType === 'asset'
  const isPendingAction = selectedReview ? selectedReview.id === reviewActionPendingId : false

  return (
    <div className="nano-comic-review">
      <div className="nano-comic-review__stats-grid">
        {metrics.map((metric) => (
          <Paper className={`nano-comic-review__stat-card nano-comic-review__stat-card--${metric.tone}`} key={metric.id} p="md" radius="md">
            <Stack className="nano-comic-review__stat-stack" gap={6}>
              <Text className="nano-comic-review__stat-title" size="xs" fw={700}>
                {metric.title}
              </Text>
              <Text className="nano-comic-review__stat-value" size="xl" fw={800}>
                {metric.value}
              </Text>
              <Text className="nano-comic-review__stat-detail" size="sm" c="dimmed">
                {metric.detail}
              </Text>
            </Stack>
          </Paper>
        ))}
      </div>

      <div className="nano-comic-review__content-grid">
        <Paper className="nano-comic-review__filters-panel" p="md" radius="md">
          <Stack className="nano-comic-review__filters-stack" gap="sm">
            <Title className="nano-comic-review__section-title" order={4}>
              快捷筛选
            </Title>
            <Badge className="nano-comic-review__filter-chip" variant="light" radius="sm">
              高风险优先
            </Badge>
            <Badge className="nano-comic-review__filter-chip" variant="light" radius="sm">
              只看阻塞
            </Badge>
            <Badge className="nano-comic-review__filter-chip" variant="light" radius="sm">
              只看导演确认
            </Badge>
            <Badge className="nano-comic-review__filter-chip" variant="light" radius="sm">
              今日更新
            </Badge>
          </Stack>
        </Paper>

        <Paper className="nano-comic-review__list-panel" p="md" radius="md">
          <Stack className="nano-comic-review__list-stack" gap="sm">
            <Group className="nano-comic-review__section-header" justify="space-between">
              <Title className="nano-comic-review__section-title" order={4}>
                审核列表
              </Title>
              <Text className="nano-comic-review__section-meta" size="sm" c="dimmed">
                点击列表可看详情
              </Text>
            </Group>
            <div className="nano-comic-review__list-scroll">
              {items.length > 0 ? items.map((item) => {
                const isSelected = item.id === selectedReview?.id
                const entityKey = getNanoComicEntityKey(item.entityType, item.id)
                return (
                  <button
                    className={`nano-comic-review__item-row${isSelected ? ' nano-comic-review__item-row--selected' : ''}`}
                    key={item.id}
                    type="button"
                    onClick={() => onSelectReview(item.id)}
                  >
                    <Group className="nano-comic-review__item-top" justify="space-between" align="flex-start">
                      <div className="nano-comic-review__item-title-wrap">
                        <Badge className={`nano-comic-review__item-risk nano-comic-review__item-risk--${item.riskLevel}`} variant="filled" radius="sm">
                          {getReviewRiskLabel(item.riskLevel)}
                        </Badge>
                        <Text className="nano-comic-review__item-title" size="sm" fw={700}>
                          {item.title}
                        </Text>
                      </div>
                      {linkedEntityKeys.has(entityKey) ? (
                        <Text className="nano-comic-review__item-linked" size="xs" c="dimmed">
                          已入画布
                        </Text>
                      ) : null}
                    </Group>
                    <Text className="nano-comic-review__item-summary" size="sm">
                      {item.summary}
                    </Text>
                    <Group className="nano-comic-review__item-meta" justify="space-between">
                      <Text className="nano-comic-review__item-assignee" size="xs" c="dimmed">
                        责任人：{item.assigneeName}
                      </Text>
                      <Text className="nano-comic-review__item-impact" size="xs" c="dimmed">
                        {item.impactLabel}
                      </Text>
                    </Group>
                  </button>
                )
              }) : (
                <Text className="nano-comic-review__empty-inline" size="sm" c="dimmed">
                  {emptyStateMessage || '当前没有可处理的审核对象。'}
                </Text>
              )}
            </div>
          </Stack>
        </Paper>

        <Paper className="nano-comic-review__detail-panel" p="md" radius="md">
          {selectedReview ? (
            <Stack className="nano-comic-review__detail-stack" gap="md">
              <div className="nano-comic-review__detail-header">
                <Title className="nano-comic-review__section-title" order={4}>
                  审核详情
                </Title>
                <Text className="nano-comic-review__detail-title" size="sm">
                  {selectedReview.title}
                </Text>
              </div>
              <div className="nano-comic-review__detail-block">
                <Text className="nano-comic-review__detail-label" size="xs" fw={800}>
                  项目 / 剧集
                </Text>
                <Text className="nano-comic-review__detail-text" size="sm">
                  {selectedReview.projectLabel} / {selectedReview.episodeLabel}
                </Text>
              </div>
              <div className="nano-comic-review__detail-block">
                <Text className="nano-comic-review__detail-label" size="xs" fw={800}>
                  问题摘要
                </Text>
                <Text className="nano-comic-review__detail-text" size="sm">
                  {selectedReview.summary}
                </Text>
              </div>
              {selectedReview.previewImageUrl ? (
                <div className="nano-comic-review__detail-block nano-comic-review__detail-block--preview">
                  <Text className="nano-comic-review__detail-label" size="xs" fw={800}>
                    预览图
                  </Text>
                  <div className="nano-comic-review__detail-preview-shell">
                    <img
                      className="nano-comic-review__detail-preview-image"
                      src={selectedReview.previewImageUrl}
                      alt={selectedReview.title}
                    />
                  </div>
                </div>
              ) : null}
              <div className="nano-comic-review__detail-block">
                <Text className="nano-comic-review__detail-label" size="xs" fw={800}>
                  审核关系
                </Text>
                <Text className="nano-comic-review__detail-text" size="sm">
                  审核人：{selectedReview.reviewerName}
                </Text>
                <Text className="nano-comic-review__detail-text" size="sm">
                  责任人：{selectedReview.assigneeName}
                </Text>
                <Text className="nano-comic-review__detail-text" size="sm">
                  更新时间：{selectedReview.updatedAtLabel}
                </Text>
              </div>
              <Group className="nano-comic-review__detail-actions" gap="sm">
                <Button
                  className="nano-comic-review__detail-action"
                  radius="sm"
                  variant="filled"
                  disabled={!canReviewRoleCard}
                  loading={isPendingAction}
                  onClick={() => onApproveReview(selectedReview)}
                >
                  {selectedReview.isConfirmed ? '重新确认' : '确认角色卡'}
                </Button>
                <Button
                  className="nano-comic-review__detail-action"
                  radius="sm"
                  variant="default"
                  disabled={!canReviewRoleCard}
                  loading={isPendingAction}
                  onClick={() => onRejectReview(selectedReview)}
                >
                  取消确认
                </Button>
                <Button
                  className="nano-comic-review__detail-action"
                  radius="sm"
                  variant="default"
                  color="red"
                  disabled={!canReviewRoleCard}
                  loading={isPendingAction}
                  onClick={() => onDeleteReview(selectedReview)}
                >
                  删除角色卡
                </Button>
                <Button
                  className="nano-comic-review__detail-action"
                  radius="sm"
                  variant="light"
                  onClick={() => onAddToCanvas(buildReviewCanvasPayload(selectedReview))}
                >
                  加入画布
                </Button>
                <Button
                  className="nano-comic-review__detail-action"
                  radius="sm"
                  variant="default"
                  disabled={!linkedEntityKeys.has(getNanoComicEntityKey(selectedReview.entityType, selectedReview.id))}
                  onClick={() => onLocateInCanvas(getNanoComicEntityKey(selectedReview.entityType, selectedReview.id))}
                >
                  定位画布
                </Button>
                <Button className="nano-comic-review__detail-action" radius="sm" variant="default" onClick={onOpenAssetsPanel}>
                  打开来源
                </Button>
              </Group>
              {!canReviewRoleCard ? (
                <Text className="nano-comic-review__detail-hint" size="xs" c="dimmed">
                  当前工作台只接入角色卡确认；镜头审核仍需在分镜或资产链路中处理。
                </Text>
              ) : null}
            </Stack>
          ) : (
            <Text className="nano-comic-review__detail-empty">没有可展示的审核对象。</Text>
          )}
        </Paper>
      </div>
    </div>
  )
}
