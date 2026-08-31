import React from 'react'
import { Button, Center, Loader, Text } from '@mantine/core'
import { IconArrowLeft } from '@tabler/icons-react'
import {
  getCommunityAuthor,
  setCommunityFollow,
  type CommunityAuthorPageDto,
  type CommunityProjectCardDto,
} from '../api/server'
import { ToastHost, toast } from './toast'
import { useAuth } from '../auth/store'
import { LoginModal } from '../auth/LoginModal'
import { navigateBackOr, spaNavigate } from '../utils/spaNavigate'
import { ManagedImage } from '../domain/resource-runtime/components/ManagedImage'

function initialOf(name?: string | null): string {
  const s = (name || '').trim()
  return s ? s.slice(0, 1).toUpperCase() : '·'
}

function AuthorProjectCard({ card }: { card: CommunityProjectCardDto }): JSX.Element {
  return (
    <div className="tapshow-card" onClick={() => spaNavigate(`/work/${encodeURIComponent(card.id)}`)}>
      <div className="tapshow-card-media">
        {card.coverUrl ? <ManagedImage className="tapshow-card-image" src={card.coverUrl} alt={card.name} /> : <div className="tapshow-card-placeholder" />}
      </div>
      <div className="tapshow-card-foot">
        <p className="tapshow-card-title">{card.name || '未命名作品'}</p>
      </div>
    </div>
  )
}

export default function TapshowAuthorPage({ login }: { login: string }): JSX.Element {
  const token = useAuth((s) => s.token)
  const [page, setPage] = React.useState<CommunityAuthorPageDto | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [following, setFollowing] = React.useState(false)
  const [followerCount, setFollowerCount] = React.useState(0)
  const [loginOpen, setLoginOpen] = React.useState(false)

  React.useEffect(() => {
    let alive = true
    setLoading(true)
    getCommunityAuthor(login)
      .then((p) => {
        if (!alive) return
        setPage(p)
        setFollowing(p.following)
        setFollowerCount(p.followerCount)
      })
      .catch((err) => {
        console.error(err)
        toast(err?.message || '加载作者主页失败', 'error')
      })
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [login])

  const toggleFollow = async () => {
    if (!token) {
      setLoginOpen(true)
      return
    }
    const next = !following
    setFollowing(next)
    setFollowerCount((c) => Math.max(0, c + (next ? 1 : -1)))
    try {
      await setCommunityFollow(login, next)
    } catch (err: any) {
      setFollowing(!next)
      setFollowerCount((c) => Math.max(0, c + (next ? -1 : 1)))
      toast(err?.message || '操作关注失败', 'error')
    }
  }

  if (loading) {
    return (
      <div className="tapshow-fullpage-root">
        <Center mih="100vh">
          <Loader color="gray" />
        </Center>
      </div>
    )
  }
  if (!page) {
    return (
      <div className="tapshow-fullpage-root">
        <Center mih="100vh">
          <Text c="dimmed">作者不存在</Text>
        </Center>
      </div>
    )
  }

  const name = page.name || page.login

  return (
    <div className="tapshow-fullpage-root">
      <ToastHost className="tapshow-fullpage-toast" />
      <LoginModal opened={loginOpen} onClose={() => setLoginOpen(false)} />

      <div className="tapshow-topbar">
        <Button size="xs" variant="subtle" leftSection={<IconArrowLeft size={14} />} onClick={() => navigateBackOr('/')}>
          返回
        </Button>
        <div className="tapshow-topbar-brand">作者主页</div>
        <div className="tapshow-topbar-actions" />
      </div>

      <div className="tapshow-content">
        <div className="tapshow-author-head">
          {page.bannerUrl && <ManagedImage className="tapshow-author-banner" src={page.bannerUrl} alt="" />}
          <div className="tapshow-author-profile">
            {page.avatarUrl ? (
              <ManagedImage className="tapshow-author-avatar" src={page.avatarUrl} alt={name} />
            ) : (
              <span className="tapshow-author-avatar tapshow-card-avatar--fallback">{initialOf(name)}</span>
            )}
            <div className="tapshow-author-info">
              <div className="tapshow-author-name">{name}</div>
              {page.bio && <div className="tapshow-author-bio">{page.bio}</div>}
              <div className="tapshow-author-stats">
                <span><b>{followerCount}</b> 粉丝</span>
                <span><b>{page.followingCount}</b> 关注</span>
                <span><b>{page.projects.length}</b> 作品</span>
              </div>
            </div>
            <Button className="tapshow-author-follow" radius="xl" variant={following ? 'default' : 'filled'} onClick={toggleFollow}>
              {following ? '已关注' : '关注'}
            </Button>
          </div>
        </div>

        <div className="tapshow-tvshow">
          <div className="tapshow-section-title">作品</div>
          {page.projects.length === 0 ? (
            <Center mih={160}>
              <Text size="sm" c="dimmed">还没有公开作品</Text>
            </Center>
          ) : (
            <div className="tapshow-grid">
              {page.projects.map((p) => (
                <AuthorProjectCard key={p.id} card={p} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
