import React from 'react'
import { ActionIcon, Button, Center, Loader, Text, Textarea, Tooltip } from '@mantine/core'
import {
  IconArrowLeft,
  IconHeart,
  IconHeartFilled,
  IconStar,
  IconStarFilled,
  IconShare3,
  IconPlayerPlay,
  IconMessageCircle,
  IconChevronLeft,
  IconChevronRight,
  IconTrash,
} from '@tabler/icons-react'
import {
  getCommunityProject,
  getPublicProjectFlows,
  exploreCommunity,
  listCommunityComments,
  addCommunityComment,
  deleteCommunityComment,
  setCommunityLike,
  setCommunityFavorite,
  recordCommunityView,
  type CommunityProjectDetailDto,
  type CommunityProjectCardDto,
  type CommunityCommentDto,
} from '../api/server'
import { ToastHost, toast } from './toast'
import { useAuth } from '../auth/store'
import { LoginModal } from '../auth/LoginModal'
import { navigateBackOr, spaNavigate } from '../utils/spaNavigate'
import { ManagedImage } from '../domain/resource-runtime/components/ManagedImage'

type Cover = { type: 'video' | 'image'; url: string; thumbnailUrl?: string | null } | null

function formatDateTime(ts?: string | null): string {
  if (!ts) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}年${String(d.getMonth() + 1).padStart(2, '0')}月${String(d.getDate()).padStart(2, '0')}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function formatCount(n: number | null | undefined): string {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : 0
  if (v >= 10000) return `${(v / 10000).toFixed(1).replace(/\.0$/, '')}w`
  return String(v)
}

function relTime(ts: string): string {
  const t = new Date(ts).getTime()
  if (!Number.isFinite(t)) return ''
  const diff = Date.now() - t
  const m = Math.floor(diff / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m}分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}小时前`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}天前`
  return new Date(ts).toLocaleDateString()
}

function initialOf(name?: string | null): string {
  const s = (name || '').trim()
  return s ? s.slice(0, 1).toUpperCase() : '·'
}

// 模块级去重：同一作品的浏览量在一次会话内只上报一次（含 StrictMode 双挂载）
const viewedProjectIds = new Set<string>()

function pickCover(flows: any[]): Cover {
  for (const f of [...(flows || [])].reverse()) {
    const nodes: any[] = Array.isArray(f?.data?.nodes) ? f.data.nodes : []
    for (let i = nodes.length - 1; i >= 0; i -= 1) {
      const nd: any = nodes[i]?.data || {}
      const vr = Array.isArray(nd.videoResults) ? nd.videoResults : []
      const v = vr.find((r: any) => typeof r?.url === 'string' && r.url.trim()) || null
      const vUrl = String(v?.url || nd.videoUrl || '').trim()
      if (vUrl) return { type: 'video', url: vUrl, thumbnailUrl: (v?.thumbnailUrl || nd.videoThumbnailUrl || null) as any }
      const ir = Array.isArray(nd.imageResults) ? nd.imageResults : []
      const im = ir.find((r: any) => typeof r?.url === 'string' && r.url.trim()) || null
      const iUrl = String(nd.imageUrl || im?.url || '').trim()
      if (iUrl) return { type: 'image', url: iUrl, thumbnailUrl: null }
    }
  }
  return null
}

export default function TapshowDetailPage({ id }: { id: string }): JSX.Element {
  const token = useAuth((s) => s.token)
  const myLogin = useAuth((s) => s.user?.login || '')

  const [detail, setDetail] = React.useState<CommunityProjectDetailDto | null>(null)
  const [cover, setCover] = React.useState<Cover>(null)
  const [flowId, setFlowId] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [playing, setPlaying] = React.useState(false)
  const [loginOpen, setLoginOpen] = React.useState(false)

  const [liked, setLiked] = React.useState(false)
  const [favorited, setFavorited] = React.useState(false)
  const [likeCount, setLikeCount] = React.useState(0)
  const [favCount, setFavCount] = React.useState(0)

  const [comments, setComments] = React.useState<CommunityCommentDto[]>([])
  const [commentCursor, setCommentCursor] = React.useState<string | null>(null)
  const [commentInput, setCommentInput] = React.useState('')
  const [posting, setPosting] = React.useState(false)

  const [related, setRelated] = React.useState<CommunityProjectCardDto[]>([])
  const relRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    let alive = true
    setLoading(true)
    if (!viewedProjectIds.has(id)) {
      viewedProjectIds.add(id)
      recordCommunityView(id).catch(() => {})
    }
    getCommunityProject(id)
      .then(async (d) => {
        if (!alive) return
        setDetail(d)
        setLiked(d.liked)
        setFavorited(d.favorited)
        setLikeCount(d.likeCount)
        setFavCount(d.favoriteCount)
        const direct = (d.coverUrl || '').trim()
        if (direct) {
          const isVideo = /\.(mp4|webm|mov|m4v)(\?|$)/i.test(direct)
          setCover({ type: isVideo ? 'video' : 'image', url: direct, thumbnailUrl: null })
        }
        try {
          const flows = await getPublicProjectFlows(id)
          if (!alive) return
          if (flows.length) setFlowId(String((flows[0] as any).id))
          if (!direct) setCover(pickCover(flows))
        } catch {
          /* ignore */
        }
        // related: 同频道优先，否则热榜
        exploreCommunity({ channel: d.channelSlug || undefined, sort: 'hot', limit: 12 })
          .then((p) => alive && setRelated(p.items.filter((it) => it.id !== id)))
          .catch(() => {})
      })
      .catch((err) => {
        console.error(err)
        toast(err?.message || '加载作品详情失败', 'error')
      })
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [id])

  React.useEffect(() => {
    listCommunityComments(id)
      .then((r) => {
        setComments(r.items)
        setCommentCursor(r.nextCursor)
      })
      .catch(() => {})
  }, [id])

  const requireLogin = React.useCallback(
    (fn: () => void) => {
      if (!token) {
        setLoginOpen(true)
        return
      }
      fn()
    },
    [token],
  )

  const toggleLike = () =>
    requireLogin(async () => {
      const next = !liked
      setLiked(next)
      setLikeCount((c) => Math.max(0, c + (next ? 1 : -1)))
      try {
        await setCommunityLike(id, next)
      } catch (err: any) {
        setLiked(!next)
        setLikeCount((c) => Math.max(0, c + (next ? -1 : 1)))
        toast(err?.message || '操作失败', 'error')
      }
    })

  const toggleFavorite = () =>
    requireLogin(async () => {
      const next = !favorited
      setFavorited(next)
      setFavCount((c) => Math.max(0, c + (next ? 1 : -1)))
      try {
        await setCommunityFavorite(id, next)
      } catch (err: any) {
        setFavorited(!next)
        setFavCount((c) => Math.max(0, c + (next ? -1 : 1)))
        toast(err?.message || '操作失败', 'error')
      }
    })

  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      toast('已复制作品链接', 'success')
    } catch {
      toast('复制失败，请手动复制地址栏链接', 'error')
    }
  }

  const viewProcess = () => {
    if (!flowId) {
      toast('该作品暂无可查看的创作画布', 'info')
      return
    }
    window.open(`/share/${encodeURIComponent(id)}/${encodeURIComponent(flowId)}`, '_blank', 'noopener,noreferrer')
  }

  const submitComment = () =>
    requireLogin(async () => {
      const body = commentInput.trim()
      if (!body) return
      setPosting(true)
      try {
        const { id: cid } = await addCommunityComment(id, body)
        setComments((prev) => [
          {
            id: cid,
            projectId: id,
            userId: '',
            parentId: null,
            body,
            likeCount: 0,
            createdAt: new Date().toISOString(),
            authorLogin: myLogin || null,
            authorName: myLogin || '我',
            authorAvatarUrl: null,
          },
          ...prev,
        ])
        setDetail((d) => (d ? { ...d, commentCount: d.commentCount + 1 } : d))
        setCommentInput('')
      } catch (err: any) {
        toast(err?.message || '发表评论失败', 'error')
      } finally {
        setPosting(false)
      }
    })

  const removeComment = (cid: string) =>
    requireLogin(async () => {
      try {
        await deleteCommunityComment(cid)
        setComments((prev) => prev.filter((c) => c.id !== cid))
        setDetail((d) => (d ? { ...d, commentCount: Math.max(0, d.commentCount - 1) } : d))
      } catch (err: any) {
        toast(err?.message || '删除失败', 'error')
      }
    })

  const loadMoreComments = () => {
    if (!commentCursor) return
    listCommunityComments(id, commentCursor)
      .then((r) => {
        setComments((prev) => [...prev, ...r.items])
        setCommentCursor(r.nextCursor)
      })
      .catch(() => {})
  }

  const scrollRelated = (dir: number) => {
    relRef.current?.scrollBy({ left: dir * 480, behavior: 'smooth' })
  }

  if (loading) {
    return (
      <div className="tapshow-detail-root">
        <Center mih="100vh">
          <Loader color="gray" />
        </Center>
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="tapshow-detail-root">
        <Center mih="100vh">
          <Text c="dimmed">作品不存在或未公开</Text>
        </Center>
      </div>
    )
  }

  const author = detail.ownerName || detail.ownerLogin || '匿名创作者'
  const canPlayVideo = cover?.type === 'video'

  return (
    <div className="tapshow-detail-root">
      <ToastHost className="tapshow-fullpage-toast" />
      <LoginModal opened={loginOpen} onClose={() => setLoginOpen(false)} />

      <div className="tapshow-detail-topbar">
        <Button
          className="tapshow-detail-back"
          size="xs"
          variant="filled"
          color="dark"
          leftSection={<IconArrowLeft size={14} />}
          onClick={() => navigateBackOr('/')}
        >
          返回
        </Button>
        <div className="tapshow-detail-headinfo">
          {detail.ownerAvatarUrl ? (
            <ManagedImage className="tapshow-detail-avatar" src={detail.ownerAvatarUrl} alt={author} />
          ) : (
            <span className="tapshow-detail-avatar tapshow-card-avatar--fallback">{initialOf(author)}</span>
          )}
          <button
            className="tapshow-detail-author"
            onClick={() => detail.ownerLogin && spaNavigate(`/work/u/${encodeURIComponent(detail.ownerLogin)}`)}
            disabled={!detail.ownerLogin}
          >
            {author}
          </button>
          <span className="tapshow-detail-divider">|</span>
          <span className="tapshow-detail-name">{detail.name}</span>
        </div>
        <div className="tapshow-detail-updated">更新时间: {formatDateTime(detail.updatedAt)}</div>
      </div>

      <div className="tapshow-detail-hero">
        {cover ? (
          canPlayVideo && playing ? (
            <video className="tapshow-detail-media" src={cover.url} poster={cover.thumbnailUrl || undefined} autoPlay controls crossOrigin="anonymous" />
          ) : cover.type === 'video' ? (
            <ManagedImage className="tapshow-detail-media" src={cover.thumbnailUrl || cover.url} alt={detail.name} />
          ) : (
            <ManagedImage className="tapshow-detail-media" src={cover.url} alt={detail.name} />
          )
        ) : (
          <div className="tapshow-detail-media tapshow-card-placeholder" />
        )}

        {!playing && (
          <div className="tapshow-detail-actions">
            {canPlayVideo && (
              <Button className="tapshow-detail-watch" radius="xl" leftSection={<IconPlayerPlay size={16} />} onClick={() => setPlaying(true)}>
                立即观看
              </Button>
            )}
            <Button className="tapshow-detail-process" variant="subtle" color="gray" onClick={viewProcess}>
              查看制作过程
            </Button>
            <Tooltip label={liked ? '取消点赞' : '点赞'} withArrow>
              <ActionIcon className="tapshow-detail-iconbtn" radius="xl" variant="subtle" onClick={toggleLike} aria-label="点赞">
                {liked ? <IconHeartFilled size={18} color="#ff5a7a" /> : <IconHeart size={18} />}
              </ActionIcon>
            </Tooltip>
            <Tooltip label={favorited ? '取消收藏' : '收藏'} withArrow>
              <ActionIcon className="tapshow-detail-iconbtn" radius="xl" variant="subtle" onClick={toggleFavorite} aria-label="收藏">
                {favorited ? <IconStarFilled size={18} color="#ffc83d" /> : <IconStar size={18} />}
              </ActionIcon>
            </Tooltip>
            <Tooltip label="分享" withArrow>
              <ActionIcon className="tapshow-detail-iconbtn" radius="xl" variant="subtle" onClick={share} aria-label="分享">
                <IconShare3 size={18} />
              </ActionIcon>
            </Tooltip>
          </div>
        )}
      </div>

      <div className="tapshow-detail-body">
        <div className="tapshow-detail-stats">
          <span><IconHeart size={14} /> {formatCount(likeCount)}</span>
          <span><IconStar size={14} /> {formatCount(favCount)}</span>
          <span><IconPlayerPlay size={14} /> {formatCount(detail.viewCount)}</span>
          <span><IconMessageCircle size={14} /> {formatCount(detail.commentCount)}</span>
        </div>
        {detail.description && <p className="tapshow-detail-desc">{detail.description}</p>}

        {/* 相关作品 */}
        {related.length > 0 && (
          <div className="tapshow-detail-related">
            <div className="tapshow-section-title">相关作品</div>
            <div className="tapshow-related-wrap">
              <button className="tapshow-hero-nav tapshow-hero-nav--prev" onClick={() => scrollRelated(-1)} aria-label="向左">
                <IconChevronLeft size={18} />
              </button>
              <div className="tapshow-related-row" ref={relRef}>
                {related.map((r) => (
                  <button key={r.id} className="tapshow-related-card" onClick={() => spaNavigate(`/work/${encodeURIComponent(r.id)}`)} title={r.name}>
                    {r.coverUrl ? <ManagedImage className="tapshow-related-cover" src={r.coverUrl} alt={r.name} /> : <div className="tapshow-related-cover tapshow-card-placeholder" />}
                    <span className="tapshow-related-name">{r.name}</span>
                  </button>
                ))}
              </div>
              <button className="tapshow-hero-nav tapshow-hero-nav--next" onClick={() => scrollRelated(1)} aria-label="向右">
                <IconChevronRight size={18} />
              </button>
            </div>
          </div>
        )}

        {/* 评论区 */}
        <div className="tapshow-detail-comments">
          <div className="tapshow-section-title">评论 {detail.commentCount > 0 ? `(${detail.commentCount})` : ''}</div>
          <div className="tapshow-comment-editor">
            <Textarea
              className="tapshow-comment-input"
              placeholder={token ? '写下你的评论…' : '登录后参与评论'}
              autosize
              minRows={2}
              maxRows={5}
              value={commentInput}
              onChange={(e) => setCommentInput(e.currentTarget.value)}
            />
            <Button size="xs" onClick={submitComment} loading={posting} disabled={!commentInput.trim()}>
              发表
            </Button>
          </div>

          {comments.length === 0 ? (
            <Text size="sm" c="dimmed" mt="md">还没有评论，来抢沙发吧</Text>
          ) : (
            <div className="tapshow-comment-list">
              {comments.map((c) => (
                <div key={c.id} className="tapshow-comment">
                  {c.authorAvatarUrl ? (
                    <ManagedImage className="tapshow-comment-avatar" src={c.authorAvatarUrl} alt={c.authorName || ''} />
                  ) : (
                    <span className="tapshow-comment-avatar tapshow-card-avatar--fallback">{initialOf(c.authorName || c.authorLogin)}</span>
                  )}
                  <div className="tapshow-comment-main">
                    <div className="tapshow-comment-head">
                      <span className="tapshow-comment-author">{c.authorName || c.authorLogin || '匿名'}</span>
                      <span className="tapshow-comment-time">{relTime(c.createdAt)}</span>
                      {myLogin && (c.authorLogin === myLogin) && (
                        <ActionIcon size="xs" variant="subtle" color="gray" aria-label="删除" onClick={() => removeComment(c.id)}>
                          <IconTrash size={13} />
                        </ActionIcon>
                      )}
                    </div>
                    <div className="tapshow-comment-body">{c.body}</div>
                  </div>
                </div>
              ))}
              {commentCursor && (
                <Center mt="sm">
                  <Button size="xs" variant="subtle" onClick={loadMoreComments}>加载更多评论</Button>
                </Center>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
