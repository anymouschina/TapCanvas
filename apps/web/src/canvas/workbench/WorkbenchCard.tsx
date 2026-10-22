import React, { useState } from 'react'
import { ActionIcon, Button, Loader, Popover, Tooltip } from '@mantine/core'
import { IconAlertCircle, IconFileText, IconMusic, IconPhoto, IconRefresh, IconSparkles } from '@tabler/icons-react'
import { ManagedImage } from '../../domain/resource-runtime/components/ManagedImage'
import { WORKBENCH_CATEGORIES, type WorkbenchItem } from './workbenchModel'

export type WorkbenchMedia = { url: string; kind: 'image' | 'video' | 'audio' }

/** The media a card opens in the shared preview modal; text-only items have none. */
export function workbenchMedia(item: WorkbenchItem): WorkbenchMedia | null {
  if (item.videoUrl) return { url: item.videoUrl, kind: 'video' }
  if (item.imageUrl) return { url: item.imageUrl, kind: 'image' }
  if (item.audioUrl) return { url: item.audioUrl, kind: 'audio' }
  return null
}

export function workbenchStatus(item: WorkbenchItem): string {
  if (item.busy) return item.status === 'queued' ? '等待执行' : '生成中'
  // 已有可用产物时，历史失败/取消不再是卡片的当前状态。
  if (item.hasResult) return '已有内容'
  if (item.status === 'error' || item.status === 'failed') return '生成失败'
  if (item.status === 'canceled' || item.status === 'cancelled') return '已取消'
  return '待生成'
}

function cardState(item: WorkbenchItem, busy: boolean): 'busy' | 'failed' | 'ready' | 'empty' {
  if (busy) return 'busy'
  if (item.hasResult) return 'ready'
  if (item.error || item.status === 'error' || item.status === 'failed') return 'failed'
  return 'empty'
}

type Props = {
  item: WorkbenchItem
  pending: boolean
  readOnly: boolean
  upstream: WorkbenchItem[]
  onGenerate: () => void
  onPreview: (item: WorkbenchItem) => void
  /** Final deliverables play in place at full width. */
  hero?: boolean
}

function referenceSummary(references: readonly WorkbenchItem[]): string {
  const counts = new Map<string, number>()
  for (const reference of references) {
    const label = WORKBENCH_CATEGORIES.find((category) => category.id === reference.category)?.label ?? '素材'
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return [...counts].map(([label, count]) => count > 1 ? `${label} ×${count}` : label).join(' · ')
}

/** Red badge in the frame's top-right corner; hover or click shows the full error. */
function ErrorBadge({ error }: { error: string }): JSX.Element {
  const [hovered, setHovered] = useState(false)
  const [pinned, setPinned] = useState(false)
  return <Popover classNames={{ dropdown: 'tc-workbench-card__error-popover' }} opened={hovered || pinned} onChange={(opened) => { if (!opened) { setPinned(false); setHovered(false) } }}
    position="bottom-end" withArrow shadow="md" width={280} withinPortal>
    <Popover.Target>
      <ActionIcon className="tc-workbench-card__error-badge" variant="filled" size={28} radius="xl" aria-label="查看报错信息"
        aria-expanded={hovered || pinned} onClick={() => setPinned((value) => !value)}
        onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
        <IconAlertCircle className="tc-workbench-card__error-icon" size={16} />
      </ActionIcon>
    </Popover.Target>
    <Popover.Dropdown className="tc-workbench-card__error-popover" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      {error}
    </Popover.Dropdown>
  </Popover>
}

function showsBusyPlaceholder(item: WorkbenchItem, busy: boolean): boolean {
  // Keep a visible waiting state for media tasks while their current operation is pending.
  return busy && item.category !== 'script' && !item.audioUrl
}

function Preview({ item, busy, pending, text }: { item: WorkbenchItem; busy: boolean; pending: boolean; text: string }): JSX.Element {
  if (showsBusyPlaceholder(item, busy)) {
    return <div className="tc-workbench-card__media-placeholder tc-workbench-card__media-placeholder--busy">
      <Loader className="tc-workbench-card__loader" size="sm" /><span className="tc-workbench-card__busy-label">{pending ? '正在执行' : item.status === 'queued' ? '排队中' : '生成中'}</span>
    </div>
  }
  if (item.imageUrl) return <ManagedImage className="tc-workbench-card__image" src={item.imageUrl} alt={item.label} ownerNodeId={item.id} priority="visible" />
  if (item.videoUrl) {
    // The first frame is the output; hovering plays it in place.
    return <video className="tc-workbench-card__video" src={`${item.videoUrl}#t=0.1`} muted loop playsInline preload="metadata" aria-hidden
      onMouseEnter={(event) => { void event.currentTarget.play().catch(() => undefined) }}
      onMouseLeave={(event) => { event.currentTarget.pause() }} />
  }
  if (text && item.category === 'script') return <div className="tc-workbench-card__text">{text}</div>
  const Icon = item.audioUrl ? IconMusic : item.category === 'script' ? IconFileText : IconPhoto
  return <div className="tc-workbench-card__media-placeholder">
    <Icon className="tc-workbench-card__media-icon" size={26} stroke={1.4} />
    <span className="tc-workbench-card__media-label">{item.audioUrl ? '试听音频' : '等待生成'}</span>
  </div>
}

export const WorkbenchCard = React.memo(function WorkbenchCard({
  item, pending, readOnly, upstream, onGenerate, onPreview, hero = false,
}: Props): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const busy = pending || item.busy
  const imageReferences = upstream.filter((reference) => reference.imageUrl).slice(0, 5)
  const otherReferences = upstream.filter((reference) => !imageReferences.includes(reference))
  const state = cardState(item, busy)
  const error = item.error
  const canRun = !readOnly && item.canGenerate
  const media = workbenchMedia(item)
  const text = item.text
  const readable = !media && item.category === 'script' && Boolean(text)
  const preview = <Preview item={item} busy={busy} pending={pending} text={text} />
  return (
    <article className="tc-workbench-card" data-hero={hero} data-has-error={Boolean(error) || undefined} data-busy={busy} data-state={state} data-category={item.category} data-node-id={item.id}
      data-expanded={readable ? expanded : undefined}>
      <div className="tc-workbench-card__frame">
        {hero && item.videoUrl
          ? <video className="tc-workbench-card__player" key={item.videoUrl} src={item.videoUrl} controls playsInline preload="metadata" aria-label={item.label} />
          : media && !showsBusyPlaceholder(item, busy)
            ? <button className="tc-workbench-card__preview" type="button" onClick={() => onPreview(item)} aria-label={`预览${item.label}`}>{preview}</button>
            : readable
              ? <button className="tc-workbench-card__preview" type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}
                aria-label={`${expanded ? '收起' : '展开'}${item.label}`}>{preview}</button>
              : <div className="tc-workbench-card__preview">{preview}</div>}
        {busy && !showsBusyPlaceholder(item, busy) && <span className="tc-workbench-card__busy"><Loader className="tc-workbench-card__loader" size={11} />{pending ? '正在执行' : workbenchStatus(item)}</span>}
        {error && <ErrorBadge error={error} />}
        {canRun && item.hasResult && !busy && <Tooltip className="tc-workbench-card__regenerate-tooltip" label="重新生成" openDelay={300}>
          <ActionIcon className="tc-workbench-card__regenerate" variant="filled" color="dark" size={28} radius="xl" aria-label="重新生成" onClick={onGenerate}>
            <IconRefresh className="tc-workbench-card__regenerate-icon" size={14} />
          </ActionIcon>
        </Tooltip>}
      </div>
      <div className="tc-workbench-card__body">
        <div className="tc-workbench-card__title">
          <span className="tc-workbench-card__dot" aria-hidden />
          <h3 className="tc-workbench-card__name" title={item.label}>{item.label}</h3>
          <span className="tc-workbench-card__status" data-failed={state === 'failed'}>{workbenchStatus(item)}</span>
        </div>
        {upstream.length > 0 && <div className="tc-workbench-card__references" aria-label={`引用 ${upstream.length} 项素材`}>
          {imageReferences.map((reference) => <button className="tc-workbench-card__reference" key={reference.id} type="button"
            onClick={() => onPreview(reference)} title={reference.label} aria-label={`预览${reference.label}`}>
            <ManagedImage className="tc-workbench-card__reference-image" src={reference.imageUrl ?? ''} alt={reference.label} ownerNodeId={reference.id} priority="background" />
          </button>)}
          {otherReferences.length > 0 && <span className="tc-workbench-card__reference-summary"
            title={otherReferences.map((reference) => reference.label).join('、')}>
            {imageReferences.length ? '+ ' : '引用 '}{referenceSummary(otherReferences)}
          </span>}
        </div>}
        {canRun && (!item.hasResult || busy) && <Button className="tc-workbench-card__generate" size="compact-xs" variant="light" color="gray" fullWidth
          loading={busy} onClick={onGenerate} leftSection={!busy ? <IconSparkles className="tc-workbench-card__generate-icon" size={13} /> : undefined}>
          {busy ? '生成中' : state === 'failed' ? '重试生成' : '生成'}
        </Button>}
      </div>
    </article>
  )
})
