import { Group } from '@mantine/core'
import { ManagedImage } from '../../../domain/resource-runtime/components/ManagedImage'
import type { MediaBlock, MediaItem } from './types'

export function MediaItemView({ item, index }: { item: MediaItem; index: number }) {
  const url = String(item.url || '').trim()
  if (!url) return null

  if (item.kind === 'audio') {
    return (
      <div className="tc-ai-chat-bubble__audio" data-media-kind="audio">
        <span className="tc-ai-chat-bubble__audio-title">
          {item.title || `音频 ${index + 1}`}
        </span>
        <audio
          className="tc-ai-chat-bubble__audio-player"
          src={url}
          controls
          preload="metadata"
        />
      </div>
    )
  }

  if (item.kind === 'video') {
    return (
      <video
        className="tc-ai-chat-bubble__asset-video"
        data-media-kind="video"
        src={url}
        poster={item.thumbnailUrl || undefined}
        controls
        playsInline
        preload="metadata"
      />
    )
  }

  const preview = String(item.thumbnailUrl || url).trim()
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="tc-ai-chat-bubble__asset-link"
      data-media-kind="image"
    >
      <ManagedImage
        className="tc-ai-chat-bubble__asset-image"
        src={preview}
        alt={item.title || `图片 ${index + 1}`}
      />
    </a>
  )
}

// Typed media block：图片走 ManagedImage，视频/音频走原生媒体控件。
export function MediaBlockView({ block }: { block: MediaBlock }) {
  return (
    <Group className="tc-ai-chat-bubble__assets" gap={8} mt={8} align="flex-start" wrap="wrap">
      {block.items.map((item, index) => (
        <MediaItemView key={`${block.id}_media_${index}`} item={item} index={index} />
      ))}
    </Group>
  )
}
