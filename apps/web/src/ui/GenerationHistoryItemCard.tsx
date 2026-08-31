import {
  IconMusic,
  IconPhoto,
  IconPlayerPlay,
  IconVideo,
} from '@tabler/icons-react'

import { ManagedImage } from '../domain/resource-runtime/components/ManagedImage'
import type { GenerationHistoryItem, GenerationHistoryKind } from './generationHistory'

export const GENERATION_KIND_LABELS: Record<GenerationHistoryKind, string> = {
  image: '图片',
  video: '视频',
  audio: '音频',
}

function formatHistoryDate(value: string): string {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return '时间不可用'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp)
}

function HistoryPlaceholder({ kind }: { kind: GenerationHistoryKind }): JSX.Element {
  if (kind === 'video') {
    return <IconVideo className="generation-history-panel__placeholder-icon" size={26} stroke={1.6} />
  }
  if (kind === 'audio') {
    return <IconMusic className="generation-history-panel__placeholder-icon" size={26} stroke={1.6} />
  }
  return <IconPhoto className="generation-history-panel__placeholder-icon" size={26} stroke={1.6} />
}

export function GenerationHistoryItemCard({
  item,
  onPreview,
}: {
  item: GenerationHistoryItem
  onPreview: (item: GenerationHistoryItem) => void
}): JSX.Element {
  return (
    <button
      className="generation-history-panel__item"
      type="button"
      aria-label={`预览${GENERATION_KIND_LABELS[item.kind]}：${item.title}`}
      onClick={() => onPreview(item)}
    >
      <span className="generation-history-panel__media">
        {item.thumbnailUrl ? (
          <ManagedImage
            className="generation-history-panel__thumbnail"
            src={item.thumbnailUrl}
            alt=""
            priority="visible"
          />
        ) : (
          <span className="generation-history-panel__placeholder">
            <HistoryPlaceholder kind={item.kind} />
          </span>
        )}
        {item.kind === 'video' ? (
          <span className="generation-history-panel__play" aria-hidden="true">
            <IconPlayerPlay className="generation-history-panel__play-icon" size={14} fill="currentColor" />
          </span>
        ) : null}
        <span className="generation-history-panel__kind">{GENERATION_KIND_LABELS[item.kind]}</span>
      </span>
      <span className="generation-history-panel__meta">
        <span className="generation-history-panel__item-title">{item.title}</span>
        <span className="generation-history-panel__item-time">{formatHistoryDate(item.createdAt)}</span>
      </span>
    </button>
  )
}

