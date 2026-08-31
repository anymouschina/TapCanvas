import React from 'react'
import { IconChevronLeft, IconChevronRight, IconCopy, IconExternalLink, IconHeart, IconLoader2, IconPhoto, IconPlus, IconShare3, IconVideo } from '@tabler/icons-react'
import type { PromptLibraryCard as PromptLibraryCardDto } from '../api/promptLibrary'
import { ManagedImage } from '../domain/resource-runtime/components/ManagedImage'
import { toast } from '../ui/toast'
import { PromptVideoPreview } from './PromptVideoPreview'
import { copyPromptLibraryEntryLink } from './promptLibraryShare'
import './PromptLibrary.css'

function displayMediaUrl(media: PromptLibraryCardDto['media'][number]): string {
  return media.thumbnailUrl || media.url
}

function isInteractiveCardTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('a, button'))
}

type PromptLibraryCardProps = Readonly<{
  entry: PromptLibraryCardDto
  creatingProject?: boolean
  onCreateProject?: (entry: PromptLibraryCardDto) => void
  selectionMode?: boolean
  previewMode?: boolean
  selected?: boolean
  onSelect?: (entry: PromptLibraryCardDto) => void
}>

export function PromptLibraryCard({
  entry,
  creatingProject = false,
  onCreateProject,
  selectionMode = false,
  previewMode = false,
  selected = false,
  onSelect,
}: PromptLibraryCardProps): JSX.Element {
  const detailLinkRef = React.useRef<HTMLAnchorElement | null>(null)
  const [mediaIndex, setMediaIndex] = React.useState(0)
  const [loadedMediaId, setLoadedMediaId] = React.useState<string | null>(null)
  const media = entry.media[mediaIndex] ?? entry.media[0]
  const detailUrl = `/prompts/${encodeURIComponent(entry.id)}`
  const mediaStyle = media?.width && media.height
    ? { aspectRatio: `${media.width} / ${media.height}` }
    : { aspectRatio: media?.kind === 'video' ? '16 / 9' : '16 / 10' }
  const mediaReady = Boolean(media && loadedMediaId === media.id)
  const cardMode = previewMode ? 'preview' : selectionMode ? 'select' : 'browse'
  const linksDisabled = cardMode !== 'browse'

  const moveMedia = (offset: number): void => {
    setMediaIndex((current) => (current + offset + entry.media.length) % entry.media.length)
  }

  const copyDetailLink = async (): Promise<void> => {
    try {
      const absoluteUrl = new URL(detailUrl, window.location.origin).toString()
      await copyPromptLibraryEntryLink({ url: absoluteUrl })
      toast('预览链接已复制', 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : '复制链接失败', 'error')
    }
  }

  const openDetailFromCard = (event: React.MouseEvent<HTMLElement>): void => {
    if (cardMode === 'preview') return
    if (cardMode === 'select') {
      if (event.target instanceof Element && event.target.closest('.prompt-library-card__carousel')) return
      if (!isInteractiveCardTarget(event.target)) onSelect?.(entry)
      return
    }
    if (isInteractiveCardTarget(event.target)) return
    detailLinkRef.current?.click()
  }

  const openDetailFromKeyboard = (event: React.KeyboardEvent<HTMLElement>): void => {
    if (!['Enter', ' '].includes(event.key) || isInteractiveCardTarget(event.target)) return
    event.preventDefault()
    if (cardMode === 'preview') return
    if (cardMode === 'select') {
      onSelect?.(entry)
      return
    }
    detailLinkRef.current?.click()
  }

  const selectFromLink = (event: React.MouseEvent<HTMLAnchorElement>): void => {
    if (!linksDisabled) return
    event.preventDefault()
    if (cardMode === 'select') onSelect?.(entry)
  }

  const copyPrompt = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(entry.promptText)
      toast('提示词已复制', 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : '复制失败', 'error')
    }
  }

  return (
    <article
      className={`prompt-library-card${cardMode === 'select' ? ' prompt-library-card--selectable' : ''}${cardMode === 'preview' ? ' prompt-library-card--preview' : ''}${selected ? ' is-selected' : ''}`}
      role={cardMode === 'preview' ? 'group' : cardMode === 'select' ? 'button' : 'link'}
      tabIndex={cardMode === 'preview' ? undefined : 0}
      aria-label={cardMode === 'preview' ? `${entry.title} 提示词预览` : cardMode === 'select' ? `选择 ${entry.title}` : `在新标签页打开 ${entry.title}`}
      aria-pressed={cardMode === 'select' ? selected : undefined}
      onClick={cardMode === 'preview' ? undefined : openDetailFromCard}
      onKeyDown={cardMode === 'preview' ? undefined : openDetailFromKeyboard}
    >
      <a ref={detailLinkRef} className="prompt-library-card__media-link" href={detailUrl} target="_blank" rel="noopener noreferrer" aria-label={cardMode === 'preview' ? undefined : cardMode === 'select' ? `选择 ${entry.title}` : `在新标签页打开 ${entry.title}`} aria-hidden={cardMode === 'preview' ? true : undefined} tabIndex={linksDisabled ? -1 : undefined} onClick={selectFromLink}>
        <div className="prompt-library-card__media" style={mediaStyle}>
          <span className={`prompt-library-card__media-skeleton${mediaReady ? ' is-hidden' : ''}`} aria-hidden="true" />
          {media ? (
            media.kind === 'video' ? (
              <PromptVideoPreview key={media.id} media={media} title={entry.title} onReady={() => setLoadedMediaId(media.id)} />
            ) : (
              <ManagedImage
                className={`prompt-library-card__image${mediaReady ? ' is-loaded' : ''}`}
                src={displayMediaUrl(media)}
                alt={entry.title}
                priority="visible"
                onLoad={() => setLoadedMediaId(media.id)}
              />
            )
          ) : (
            <div className="prompt-library-card__missing">缺少输出媒体</div>
          )}
          <div className="prompt-library-card__media-shade" aria-hidden="true" />
          <div className="prompt-library-card__badges">
            <span className="prompt-library-card__type">
              {entry.mediaType === 'video'
                ? <IconVideo className="prompt-library-card__type-icon" size={12} stroke={1.8} />
                : <IconPhoto className="prompt-library-card__type-icon" size={12} stroke={1.8} />}
              {entry.mediaType === 'video' ? '视频' : '图片'}
            </span>
          </div>
          <span className="prompt-library-card__open" aria-hidden="true">
            <IconExternalLink className="prompt-library-card__open-icon" size={14} stroke={1.8} />
          </span>
        </div>
      </a>

      {entry.media.length > 1 ? (
        <div className="prompt-library-card__carousel" aria-label={`共 ${entry.media.length} 个输出`}>
          <button className="prompt-library-card__carousel-button" type="button" aria-label="上一个输出" onClick={() => moveMedia(-1)}>
            <IconChevronLeft className="prompt-library-card__carousel-icon" size={15} />
          </button>
          <div className="prompt-library-card__dots">
            {entry.media.map((item, index) => (
              <button
                className={`prompt-library-card__dot${index === mediaIndex ? ' is-active' : ''}`}
                key={item.id}
                type="button"
                aria-label={`查看第 ${index + 1} 个输出`}
                aria-current={index === mediaIndex ? 'true' : undefined}
                onClick={() => setMediaIndex(index)}
              />
            ))}
          </div>
          <button className="prompt-library-card__carousel-button" type="button" aria-label="下一个输出" onClick={() => moveMedia(1)}>
            <IconChevronRight className="prompt-library-card__carousel-icon" size={15} />
          </button>
        </div>
      ) : null}

      <div className="prompt-library-card__body">
        <a className="prompt-library-card__title-link" href={detailUrl} target="_blank" rel="noopener noreferrer" aria-hidden={cardMode === 'preview' ? true : undefined} tabIndex={linksDisabled ? -1 : undefined} onClick={selectFromLink}>
          <h2 className="prompt-library-card__title">{entry.title}</h2>
        </a>
        <p className="prompt-library-card__prompt">{entry.promptText}</p>
        <div className="prompt-library-card__footer">
          <span className="prompt-library-card__meta">
            {entry.models[0] ? <span className="prompt-library-card__author">{entry.models[0].name}</span> : null}
            <span className="prompt-library-card__source">{entry.authorLabel}</span>
          </span>
          <span className="prompt-library-card__engagement" aria-label={`点赞 ${entry.likes ?? 0}`}>
            <span><IconHeart size={12} />{(entry.likes ?? 0).toLocaleString('zh-CN')}</span>
          </span>
          {cardMode === 'select' ? (
            <span className="prompt-library-card__selection-state">{selected ? '已选择' : '点击选择'}</span>
          ) : cardMode === 'browse' ? (
            <div className="prompt-library-card__actions">
              <button
                className="prompt-library-card__action prompt-library-card__action--create"
                type="button"
                aria-label="新建项目并添加到画布"
                title="新建项目并添加到画布"
                aria-busy={creatingProject}
                disabled={creatingProject || !onCreateProject}
                onClick={() => onCreateProject?.(entry)}
              >
                {creatingProject
                  ? <IconLoader2 className="prompt-library-card__action-icon prompt-library-card__action-icon--loading" size={15} stroke={1.8} />
                  : <IconPlus className="prompt-library-card__action-icon" size={16} stroke={1.9} />}
              </button>
              <button className="prompt-library-card__action" type="button" aria-label="复制提示词" title="复制提示词" onClick={() => void copyPrompt()}>
                <IconCopy className="prompt-library-card__action-icon" size={15} stroke={1.8} />
              </button>
              <button className="prompt-library-card__action" type="button" aria-label="复制预览链接" title="复制预览链接" onClick={() => void copyDetailLink()}>
                <IconShare3 className="prompt-library-card__action-icon" size={15} stroke={1.8} />
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </article>
  )
}
