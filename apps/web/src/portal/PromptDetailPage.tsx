import React from 'react'
import {
  IconBookmark,
  IconBrandWhatsapp,
  IconExternalLink,
  IconEye,
  IconHeart,
  IconLink,
  IconQuote,
  IconShare3,
} from '@tabler/icons-react'
import { getPromptLibraryDetail, togglePromptLibraryLike, type PromptLibraryDetail } from '../api/promptLibrary'
import { useAuth } from '../auth/store'
import { ManagedImage } from '../domain/resource-runtime/components/ManagedImage'
import { StatePanel } from '../ui/StatePanel'
import { ToastHost, toast } from '../ui/toast'
import { PortalHeader } from './PortalHeader'
import { PromptDetailPageLoginRuntime } from './PromptDetailPageLoginRuntime'
import { PromptImageGenerator } from './PromptImageGenerator'
import { PromptVideoGenerator } from './PromptVideoGenerator'
import { copyPromptLibraryEntryLink } from './promptLibraryShare'
import './PromptLibrary.css'

function readPromptId(): string {
  const parts = window.location.pathname.split('/').filter(Boolean)
  return decodeURIComponent(parts[1] ?? '')
}

function formatCount(value: number): string {
  return new Intl.NumberFormat('zh-CN', { notation: value >= 10_000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value)
}

function formatDate(value: string | null): string {
  if (!value) return '未记录'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('zh-CN', { dateStyle: 'long' }).format(date)
}

const METRIC_CONFIG = [
  { key: 'likes', label: '点赞', icon: IconHeart },
  { key: 'views', label: '浏览', icon: IconEye },
  { key: 'shares', label: '分享', icon: IconShare3 },
  { key: 'bookmarks', label: '收藏', icon: IconBookmark },
  { key: 'quotes', label: '引用', icon: IconQuote },
] as const

export default function PromptDetailPage(): JSX.Element {
  const [entry, setEntry] = React.useState<PromptLibraryDetail | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState('')
  const [loginOpen, setLoginOpen] = React.useState(false)
  const currentUser = useAuth((state) => state.user)
  const [likeLoading, setLikeLoading] = React.useState(false)
  const id = React.useMemo(readPromptId, [])
  const requestVersionRef = React.useRef(0)

  const loadDetail = React.useCallback((): void => {
    const requestVersion = requestVersionRef.current + 1
    requestVersionRef.current = requestVersion
    setLoading(true)
    setError('')
    if (!id) {
      setError('提示词地址缺少条目 ID')
      setLoading(false)
      return
    }
    void getPromptLibraryDetail(id)
      .then((result) => { if (requestVersionRef.current === requestVersion) setEntry(result) })
      .catch((reason: unknown) => { if (requestVersionRef.current === requestVersion) setError(reason instanceof Error ? reason.message : '加载提示词详情失败') })
      .finally(() => { if (requestVersionRef.current === requestVersion) setLoading(false) })
  }, [id])

  React.useEffect(() => {
    loadDetail()
    return () => { requestVersionRef.current += 1 }
  }, [loadDetail])

  const copyText = async (value: string, message: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value)
      toast(message, 'success')
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : '复制失败', 'error')
    }
  }

  const share = async (): Promise<void> => {
    if (!entry) return
    try {
      await copyPromptLibraryEntryLink({ url: window.location.href })
      toast('预览链接已复制', 'success')
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : '复制链接失败', 'error')
    }
  }

  const shareTo = (target: 'x' | 'linkedin' | 'whatsapp'): void => {
    if (!entry) return
    const url = encodeURIComponent(window.location.href)
    const text = encodeURIComponent(entry.title)
    const targets = {
      x: `https://x.com/intent/post?url=${url}&text=${text}`,
      linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${url}`,
      whatsapp: `https://wa.me/?text=${text}%20${url}`,
    }
    window.open(targets[target], '_blank', 'noopener,noreferrer')
  }

  const toggleLike = async (): Promise<void> => {
    if (!entry || likeLoading) return
    if (!currentUser) {
      setLoginOpen(true)
      return
    }
    setLikeLoading(true)
    try {
      const result = await togglePromptLibraryLike(entry.id)
      setEntry((current) => current ? { ...current, viewerLiked: result.liked, likes: result.likes, metrics: { ...current.metrics, likes: result.likes } } : current)
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : '更新点赞失败', 'error')
    } finally {
      setLikeLoading(false)
    }
  }

  return (
    <main className="prompt-detail-page">
      <PortalHeader active="prompts" onRequestLogin={() => setLoginOpen(true)} />
      <PromptDetailPageLoginRuntime opened={loginOpen} onClose={() => setLoginOpen(false)} />
      <ToastHost className="prompt-detail-page__toast" />
      {loading ? (
        <div className="prompt-detail-page__state"><StatePanel className="prompt-detail-page__state-panel" title="正在加载提示词详情…" tone="loading" /></div>
      ) : error || !entry ? (
        <div className="prompt-detail-page__state">
          <StatePanel
            className="prompt-detail-page__state-panel"
            title="无法打开提示词"
            description={error || '提示词不存在'}
            tone="error"
            actions={<button className="prompt-detail-page__retry" type="button" onClick={loadDetail}>重新加载</button>}
          />
        </div>
      ) : (
        <div className="prompt-detail-page__layout">
          <article className="prompt-detail-page__main">
            <div className="prompt-detail-page__title-block">
              <p className="prompt-detail-page__eyebrow">{entry.mediaType === 'video' ? 'VIDEO PROMPT' : 'IMAGE PROMPT'}</p>
              <h1 className="prompt-detail-page__title">{entry.title}</h1>
              {entry.description ? <p className="prompt-detail-page__description">{entry.description}</p> : null}
            </div>

            <section className="prompt-detail-page__outputs" aria-label="输出效果">
              {entry.media.map((media, index) => (
                <figure className={`prompt-detail-page__output prompt-detail-page__output--${media.kind}`} key={media.id}>
                  {media.kind === 'video' ? (
                    <video className="prompt-detail-page__video" src={media.url} poster={media.thumbnailUrl ?? undefined} controls playsInline preload="metadata" />
                  ) : (
                    <ManagedImage
                      className="prompt-detail-page__image"
                      src={media.url}
                      alt={`${entry.title} 输出 ${index + 1}`}
                      priority={index === 0 ? 'critical' : 'visible'}
                      loading={index === 0 ? 'eager' : 'lazy'}
                      style={media.width && media.height ? { aspectRatio: `${media.width} / ${media.height}` } : undefined}
                    />
                  )}
                  <figcaption className="prompt-detail-page__output-index">输出 {index + 1} / {entry.media.length}</figcaption>
                </figure>
              ))}
            </section>

            {entry.mediaType === 'video' ? (
              <PromptVideoGenerator
                entryId={entry.id}
                title={entry.title}
                initialPrompt={entry.promptText}
                sourceModels={entry.models}
                onRequestLogin={() => setLoginOpen(true)}
                onCopyPrompt={(value) => void copyText(value, '提示词已复制')}
              />
            ) : (
              <PromptImageGenerator
                entryId={entry.id}
                title={entry.title}
                initialPrompt={entry.promptText}
                sourceModels={entry.models}
                onRequestLogin={() => setLoginOpen(true)}
                onCopyPrompt={(value) => void copyText(value, '提示词已复制')}
              />
            )}
          </article>

          <aside className="prompt-detail-page__aside">
            <section className="prompt-detail-page__source-panel">
              <div className="prompt-detail-page__collector-mark" aria-hidden="true">集</div>
              <div className="prompt-detail-page__source-copy">
                <strong className="prompt-detail-page__author">{entry.authorLabel}</strong>
                <a className="prompt-detail-page__source-link" href={entry.originalSourceUrl || entry.sourceUrl} target="_blank" rel="noopener noreferrer">
                  查看原始来源<IconExternalLink className="prompt-detail-page__source-icon" size={14} />
                </a>
              </div>
            </section>

            <section className="prompt-detail-page__metadata">
              <dl className="prompt-detail-page__metadata-list">
                <div className="prompt-detail-page__metadata-row"><dt className="prompt-detail-page__metadata-term">发布时间</dt><dd className="prompt-detail-page__metadata-value">{formatDate(entry.publishedAt)}</dd></div>
                <div className="prompt-detail-page__metadata-row"><dt className="prompt-detail-page__metadata-term">原始语言</dt><dd className="prompt-detail-page__metadata-value">{entry.originalLanguage?.toUpperCase() || '未记录'}</dd></div>
                <div className="prompt-detail-page__metadata-row prompt-detail-page__metadata-row--stacked">
                  <dt className="prompt-detail-page__metadata-term">模型</dt>
                  <dd className="prompt-detail-page__tag-list">{entry.models.map((model) => <span className="prompt-detail-page__tag" key={model.slug}>{model.name}</span>)}</dd>
                </div>
                {entry.categories.length > 0 ? (
                  <div className="prompt-detail-page__metadata-row prompt-detail-page__metadata-row--stacked">
                    <dt className="prompt-detail-page__metadata-term">分类</dt>
                    <dd className="prompt-detail-page__tag-list">{entry.categories.map((category) => <span className="prompt-detail-page__tag" key={category}>{category}</span>)}</dd>
                  </div>
                ) : null}
              </dl>
            </section>

            <section className="prompt-detail-page__metrics" aria-label="来源数据">
              {METRIC_CONFIG.map((metric) => {
                const MetricIcon = metric.icon
                return (
                  <div className={`prompt-detail-page__metric${metric.key === 'likes' ? ' prompt-detail-page__metric--interactive' : ''}`} key={metric.key}>
                    {metric.key === 'likes' ? <button type="button" className={`prompt-detail-page__metric-button${entry.viewerLiked ? ' is-liked' : ''}`} onClick={() => void toggleLike()} disabled={likeLoading} aria-pressed={entry.viewerLiked} aria-label={entry.viewerLiked ? '取消点赞' : '点赞'}>
                      <span className="prompt-detail-page__metric-label"><MetricIcon className="prompt-detail-page__metric-icon" size={15} />{metric.label}</span>
                      <strong className="prompt-detail-page__metric-value">{formatCount(entry.metrics[metric.key])}</strong>
                    </button> : <>
                    <span className="prompt-detail-page__metric-label"><MetricIcon className="prompt-detail-page__metric-icon" size={15} />{metric.label}</span>
                    <strong className="prompt-detail-page__metric-value">{formatCount(entry.metrics[metric.key])}</strong>
                    </>}
                  </div>
                )
              })}
            </section>

            <section className="prompt-detail-page__share-panel">
              <h2 className="prompt-detail-page__share-title">分享</h2>
              <div className="prompt-detail-page__share-actions">
                <button className="prompt-detail-page__share-action" type="button" aria-label="复制链接" title="复制链接" onClick={() => void copyText(window.location.href, '链接已复制')}><IconLink className="prompt-detail-page__share-icon" size={18} /></button>
                <button className="prompt-detail-page__share-action" type="button" aria-label="分享到 X" title="分享到 X" onClick={() => shareTo('x')}><span className="prompt-detail-page__share-letter">X</span></button>
                <button className="prompt-detail-page__share-action" type="button" aria-label="分享到 LinkedIn" title="分享到 LinkedIn" onClick={() => shareTo('linkedin')}><span className="prompt-detail-page__share-letter">in</span></button>
                <button className="prompt-detail-page__share-action" type="button" aria-label="分享到 WhatsApp" title="分享到 WhatsApp" onClick={() => shareTo('whatsapp')}><IconBrandWhatsapp className="prompt-detail-page__share-icon" size={19} /></button>
                <button className="prompt-detail-page__share-action" type="button" aria-label="复制预览链接" title="复制预览链接" onClick={() => void share()}><IconShare3 className="prompt-detail-page__share-icon" size={18} /></button>
              </div>
            </section>
          </aside>
        </div>
      )}
    </main>
  )
}
