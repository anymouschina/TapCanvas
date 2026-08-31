import React from 'react'
import { ActionIcon, Button, Text, Tooltip } from '@mantine/core'
import {
  IconArrowLeft,
  IconFocusCentered,
  IconMusic,
  IconPhoto,
  IconPlayerPlay,
} from '@tabler/icons-react'

import type { TaskInboxItemDto } from '../api/server'
import { ManagedImage } from '../domain/resource-runtime/components/ManagedImage'

type TaskInboxAsset = TaskInboxItemDto['assets'][number]

type TaskInboxDetailProps = Readonly<{
  item: TaskInboxItemDto
  title: string
  onBack: () => void
  onPreview: (asset: TaskInboxAsset) => void
  onFocusNode: () => void
}>

function assetLabel(asset: TaskInboxAsset, index: number): string {
  if (asset.assetName?.trim()) return asset.assetName.trim()
  if (asset.type === 'video') return `视频 ${index + 1}`
  if (asset.type === 'audio') return `音频 ${index + 1}`
  return `图片 ${index + 1}`
}

function AssetPreview({ asset, index, onPreview }: {
  asset: TaskInboxAsset
  index: number
  onPreview: (asset: TaskInboxAsset) => void
}): JSX.Element {
  const label = assetLabel(asset, index)
  const thumbnailUrl = asset.thumbnailUrl?.trim() || asset.posterInline?.trim() || ''
  return (
    <button
      className="task-inbox-detail__asset"
      type="button"
      onClick={() => onPreview(asset)}
      aria-label={`预览${label}`}
    >
      <span className="task-inbox-detail__asset-visual">
        {asset.type === 'image' ? (
          <ManagedImage
            className="task-inbox-detail__asset-image"
            src={thumbnailUrl || asset.url}
            alt={label}
            priority="visible"
          />
        ) : thumbnailUrl ? (
          <ManagedImage
            className="task-inbox-detail__asset-image"
            src={thumbnailUrl}
            alt={label}
            priority="visible"
          />
        ) : asset.type === 'video' ? (
          <IconPlayerPlay className="task-inbox-detail__asset-placeholder-icon" size={24} stroke={1.5} />
        ) : (
          <IconMusic className="task-inbox-detail__asset-placeholder-icon" size={24} stroke={1.5} />
        )}
        <span className="task-inbox-detail__asset-type-icon" aria-hidden="true">
          {asset.type === 'image'
            ? <IconPhoto className="task-inbox-detail__asset-type-glyph" size={12} />
            : asset.type === 'video'
              ? <IconPlayerPlay className="task-inbox-detail__asset-type-glyph" size={12} />
              : <IconMusic className="task-inbox-detail__asset-type-glyph" size={12} />}
        </span>
      </span>
      <span className="task-inbox-detail__asset-label">{label}</span>
    </button>
  )
}

export function TaskInboxDetail({
  item,
  title,
  onBack,
  onPreview,
  onFocusNode,
}: TaskInboxDetailProps): JSX.Element {
  const statusLabel = item.status === 'succeeded'
    ? '执行成功'
    : item.status === 'failed'
      ? '执行失败'
      : item.status === 'queued'
        ? '等待执行'
        : '正在执行'
  const statusTone = item.status === 'succeeded'
    ? 'succeeded'
    : item.status === 'failed'
      ? 'failed'
      : item.status === 'queued'
        ? 'waiting'
        : 'active'
  return (
    <div className="task-inbox-detail">
      <div className="task-inbox-detail__toolbar">
        <Tooltip className="task-inbox-detail__tooltip" label="返回创作动态" withArrow>
          <ActionIcon
            className="task-inbox-detail__back"
            variant="subtle"
            size="sm"
            aria-label="返回创作动态"
            onClick={onBack}
          >
            <IconArrowLeft className="task-inbox-detail__back-icon" size={16} />
          </ActionIcon>
        </Tooltip>
        <div className="task-inbox-detail__identity">
          <Text className="task-inbox-detail__title">{title}</Text>
          <Text className={`task-inbox-detail__status task-inbox-detail__status--${statusTone}`}>
            {statusLabel} · {item.vendor}
          </Text>
        </div>
        {item.nodeId ? (
          <Tooltip className="task-inbox-detail__tooltip" label="定位到画布节点" withArrow>
            <ActionIcon
              className="task-inbox-detail__focus"
              variant="subtle"
              size="sm"
              aria-label="定位到画布节点"
              onClick={onFocusNode}
            >
              <IconFocusCentered className="task-inbox-detail__focus-icon" size={16} />
            </ActionIcon>
          </Tooltip>
        ) : null}
      </div>

      {item.status === 'failed' && item.errorMessage ? (
        <section className="task-inbox-detail__section task-inbox-detail__section--error" aria-labelledby="task-inbox-error-title">
          <Text className="task-inbox-detail__section-title" id="task-inbox-error-title">失败原因</Text>
          <Text className="task-inbox-detail__error-text">{item.errorMessage}</Text>
        </section>
      ) : null}

      <section className="task-inbox-detail__section" aria-labelledby="task-inbox-prompt-title">
        <Text className="task-inbox-detail__section-title" id="task-inbox-prompt-title">任务输入</Text>
        {item.prompt ? (
          <pre className="task-inbox-detail__prompt">{item.prompt}</pre>
        ) : (
          <Text className="task-inbox-detail__empty-text">该任务未记录输入内容</Text>
        )}
      </section>

      <section className="task-inbox-detail__section" aria-labelledby="task-inbox-assets-title">
        <Text className="task-inbox-detail__section-title" id="task-inbox-assets-title">
          产物 {item.assets.length > 0 ? item.assets.length : ''}
        </Text>
        {item.assets.length > 0 ? (
          <div className="task-inbox-detail__assets">
            {item.assets.map((asset, index) => (
              <AssetPreview
                key={`${asset.type}:${asset.assetId || asset.url}:${index}`}
                asset={asset}
                index={index}
                onPreview={onPreview}
              />
            ))}
          </div>
        ) : (
          <Text className="task-inbox-detail__empty-text">
            {item.status === 'queued' || item.status === 'running' ? '产物尚未形成' : '该任务没有可预览产物'}
          </Text>
        )}
      </section>

      {item.assets.length > 0 ? (
        <Button
          className="task-inbox-detail__preview-primary"
          size="xs"
          onClick={() => onPreview(item.assets[0])}
        >
          预览产物
        </Button>
      ) : null}
    </div>
  )
}
