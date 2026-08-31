import React from 'react'
import { ActionIcon, Button, Loader, Modal, SegmentedControl, TextInput, Textarea, Tooltip } from '@mantine/core'
import {
  IconBell,
  IconChevronRight,
  IconCoins,
  IconCrown,
  IconDevices,
  IconExternalLink,
  IconEye,
  IconEyeOff,
  IconFolder,
  IconGift,
  IconHeart,
  IconLogout2,
  IconPlus,
  IconPlugConnected,
  IconRefresh,
  IconSwitchHorizontal,
  IconTrash,
  IconUpload,
  IconUser,
  IconVideo,
} from '@tabler/icons-react'
import { useAuth } from '../../auth/store'
import { uploadServerAssetFile } from '../../api/server'
import { buildStudioUrl } from '../../utils/appRoutes'
import { ManagedImage } from '../../domain/resource-runtime/components/ManagedImage'
import { toast } from '../../ui/toast'
import { spaNavigate } from '../../utils/spaNavigate'
import {
  getAccountOverview,
  getAccountProfile,
  listAccountLikes,
  listAccountNotifications,
  listAccountSessions,
  listAccountWorks,
  deleteAccountWork,
  logoutAccount,
  readAccountNotification,
  readAllAccountNotifications,
  revokeAccountSession,
  updateAccountProfile,
  updateAccountWorkPublication,
  type AccountCheckIn,
  type AccountNotification,
  type AccountOverview,
  type AccountPublishedWork,
  type AccountProfile,
  type AccountSession,
} from '../accountApi'
import { AccountRewardsView } from './AccountRewardsView'
import { AccountCreditsView } from './AccountCreditsView'
import { McpIntegrationView } from './McpIntegrationView'
import './account-center.css'

export type AccountCenterTabKey = 'profile' | 'rewards' | 'works' | 'likes' | 'messages' | 'credits' | 'mcp' | 'devices' | 'accounts'

const TABS: Array<{ key: AccountCenterTabKey; label: string; icon: typeof IconUser }> = [
  { key: 'profile', label: '个人信息', icon: IconUser },
  { key: 'rewards', label: '赚取积分', icon: IconGift },
  { key: 'works', label: '我的作品', icon: IconFolder },
  { key: 'likes', label: '我的点赞', icon: IconHeart },
  { key: 'messages', label: '站内消息', icon: IconBell },
  { key: 'credits', label: '积分账单', icon: IconCoins },
  { key: 'mcp', label: 'MCP（作为远程工具）', icon: IconPlugConnected },
  { key: 'devices', label: '登录设备', icon: IconDevices },
  { key: 'accounts', label: '切换账号', icon: IconSwitchHorizontal },
]

function formatTime(value: string | null): string {
  if (!value) return '—'
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString('zh-CN') : value
}

function readUploadedUrl(data: unknown): string {
  if (!data || typeof data !== 'object') return ''
  const url = (data as Record<string, unknown>).url
  return typeof url === 'string' ? url.trim() : ''
}

function StateView({ loading, error, empty, emptyMessage = '暂无数据', onRetry }: { loading: boolean; error: string | null; empty: boolean; emptyMessage?: string; onRetry: () => void }): JSX.Element | null {
  if (loading) return <div className="account-center-state"><Loader className="account-center-state__loader" size="sm" /></div>
  if (error) return (
    <div className="account-center-state account-center-state--error">
      <span className="account-center-state__message">{error}</span>
      <Button className="account-center-state__retry" variant="subtle" leftSection={<IconRefresh className="account-center-state__retry-icon" size={14} />} onClick={onRetry}>重试</Button>
    </div>
  )
  if (empty) return <div className="account-center-state"><span className="account-center-state__message">{emptyMessage}</span></div>
  return null
}

function ProfileView({ onChanged }: { onChanged: (profile: AccountProfile) => void }): JSX.Element {
  const auth = useAuth()
  const [profile, setProfile] = React.useState<AccountProfile | null>(null)
  const [name, setName] = React.useState('')
  const [bio, setBio] = React.useState('')
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [uploading, setUploading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const fileRef = React.useRef<HTMLInputElement | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getAccountProfile()
      setProfile(data)
      setName(data.name)
      setBio(data.bio || '')
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '加载个人信息失败')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { void load() }, [load])

  const save = React.useCallback(async () => {
    setSaving(true)
    try {
      const data = await updateAccountProfile({ name, bio: bio || null })
      setProfile(data)
      if (!auth.token || !auth.user) throw new Error('当前登录状态已失效')
      auth.setAuth({ ...auth.user, sub: data.id, login: data.login, name: data.name, avatarUrl: data.avatarUrl || undefined })
      onChanged(data)
      toast('个人信息已保存', 'success')
    } catch (reason: unknown) {
      toast(reason instanceof Error ? reason.message : '保存个人信息失败', 'error')
    } finally {
      setSaving(false)
    }
  }, [auth, bio, name, onChanged])

  const uploadAvatar = React.useCallback(async (file: File | null) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast('头像必须是图片文件', 'error')
      return
    }
    setUploading(true)
    let uploadedUrl = ''
    try {
      const asset = await uploadServerAssetFile(file, `头像-${file.name}`)
      uploadedUrl = readUploadedUrl(asset.data)
      if (!uploadedUrl) throw new Error('OSS 上传成功但未返回可访问 URL')
      const data = await updateAccountProfile({ avatarUrl: uploadedUrl })
      setProfile(data)
      if (!auth.token || !auth.user) throw new Error('当前登录状态已失效')
      auth.setAuth({ ...auth.user, sub: data.id, login: data.login, name: data.name, avatarUrl: uploadedUrl })
      onChanged(data)
      toast('头像已更新', 'success')
    } catch (reason: unknown) {
      const message = reason instanceof Error ? reason.message : '头像更新失败'
      toast(uploadedUrl ? `图片已上传，但资料保存失败：${message}` : message, 'error')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }, [auth, onChanged])

  if (loading || error || !profile) return <StateView loading={loading} error={error} empty={!profile} onRetry={() => void load()} />
  if (!profile) return <div className="account-center-state"><span className="account-center-state__message">用户资料不存在</span></div>
  return (
    <div className="account-profile-view">
      <div className="account-profile-view__avatar-row">
        <div className="account-profile-view__avatar">
          {profile.avatarUrl ? <ManagedImage className="account-profile-view__avatar-image" src={profile.avatarUrl} alt={profile.name} priority="visible" /> : <span className="account-profile-view__avatar-fallback">{profile.name.slice(0, 1)}</span>}
        </div>
        <div className="account-profile-view__avatar-actions">
          <strong className="account-profile-view__name">{profile.name}</strong>
          <span className="account-profile-view__uid">UID {profile.id}</span>
          <Button className="account-profile-view__upload" variant="subtle" loading={uploading} leftSection={<IconUpload className="account-profile-view__upload-icon" size={14} />} onClick={() => fileRef.current?.click()}>更换头像</Button>
          <input className="account-profile-view__file-input" ref={fileRef} type="file" accept="image/*" onChange={(event) => void uploadAvatar(event.currentTarget.files?.[0] ?? null)} />
        </div>
      </div>
      <div className="account-profile-view__form">
        <TextInput className="account-profile-view__field" label="昵称" value={name} maxLength={32} onChange={(event) => setName(event.currentTarget.value)} />
        <Textarea className="account-profile-view__field" label="个人简介" value={bio} maxLength={300} minRows={4} onChange={(event) => setBio(event.currentTarget.value)} />
        <div className="account-profile-view__readonly"><span className="account-profile-view__readonly-label">登录账号</span><span className="account-profile-view__readonly-value">{profile.phone || profile.email || profile.login}</span></div>
        <Button className="account-profile-view__save" loading={saving} disabled={!name.trim()} onClick={() => void save()}>保存</Button>
      </div>
    </div>
  )
}

type WorkPreviewMode = 'video' | 'process'

function WorksGrid(): JSX.Element {
  const [items, setItems] = React.useState<AccountPublishedWork[]>([])
  const [cursor, setCursor] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [loadingMore, setLoadingMore] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [busyWorkId, setBusyWorkId] = React.useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = React.useState<AccountPublishedWork | null>(null)
  const [selectedWorkId, setSelectedWorkId] = React.useState<string | null>(null)
  const [previewMode, setPreviewMode] = React.useState<WorkPreviewMode>('video')

  const load = React.useCallback(async (nextCursor: string | null = null) => {
    nextCursor ? setLoadingMore(true) : setLoading(true)
    setError(null)
    try {
      const page = await listAccountWorks(nextCursor)
      setItems((current) => nextCursor ? [...current, ...page.items] : page.items)
      if (!nextCursor && page.items.length > 0) {
        setSelectedWorkId((current) => page.items.some((item) => item.id === current) ? current : page.items[0]?.id || null)
      }
      setCursor(page.nextCursor)
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '加载已发布作品失败')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [])

  React.useEffect(() => { void load() }, [load])
  const changePublication = React.useCallback(async (work: AccountPublishedWork) => {
    setBusyWorkId(work.id)
    try {
      const result = await updateAccountWorkPublication(work.id, !work.published)
      setItems((current) => current.map((item) => item.id === work.id ? { ...item, published: result.published } : item))
      toast(result.published ? '作品已上架到 Neo TV' : '作品已下架，作品文件仍保留在账户中', 'success')
    } catch (reason: unknown) {
      toast(reason instanceof Error ? reason.message : '作品状态更新失败', 'error')
    } finally {
      setBusyWorkId(null)
    }
  }, [])
  const removeWork = React.useCallback(async () => {
    const work = confirmDelete
    if (!work) return
    setBusyWorkId(work.id)
    try {
      await deleteAccountWork(work.id)
      setItems((current) => {
        const next = current.filter((item) => item.id !== work.id)
        setSelectedWorkId((selectedId) => selectedId === work.id ? next[0]?.id || null : selectedId)
        return next
      })
      setConfirmDelete(null)
      toast('发布作品已删除', 'success')
    } catch (reason: unknown) {
      toast(reason instanceof Error ? reason.message : '作品删除失败', 'error')
    } finally {
      setBusyWorkId(null)
    }
  }, [confirmDelete])
  if (loading || error || items.length === 0) {
    return <StateView loading={loading} error={error} empty={items.length === 0} emptyMessage="还没有发布作品" onRetry={() => void load()} />
  }
  const selectedWork = items.find((item) => item.id === selectedWorkId) || items[0] || null
  return (
    <div className="account-project-view account-work-view">
      <div className="account-work-view__workspace">
      <div className="account-project-grid account-work-grid">
        {items.map((work) => (
          <article className={`account-project-card account-work-card${work.published ? '' : ' is-unpublished'}${selectedWork?.id === work.id ? ' is-selected' : ''}`} key={work.id}>
            <button className="account-work-card__select" type="button" aria-label={`预览作品：${work.title}`} onClick={() => setSelectedWorkId(work.id)}>
            <div className="account-project-card__media account-work-card__media">
              {work.coverImageUrl
                ? <ManagedImage className="account-project-card__image account-work-card__image" src={work.coverImageUrl} alt={work.title} priority="visible" />
                : <IconVideo className="account-project-card__placeholder account-work-card__placeholder" size={26} />}
              <span className="account-work-card__play" aria-hidden="true"><IconVideo className="account-work-card__play-icon" size={16} /></span>
              <span className={`account-work-card__publication${work.published ? '' : ' is-unpublished'}`}>{work.published ? '已上架' : '已下架'}</span>
            </div>
            </button>
            <div className="account-project-card__content account-work-card__content">
              <button className="account-work-card__open" type="button" onClick={() => setSelectedWorkId(work.id)}><strong className="account-project-card__title account-work-card__title">{work.title}</strong></button>
              <span className="account-project-card__meta account-work-card__meta">发布于 {formatTime(work.publishedAt)}</span>
              {work.sourceProjectName ? (
                <span className="account-work-card__source">
                  来自 {work.sourceProjectName}{work.sourceOwnerType === 'chapter' && work.sourceChapterTitle ? ` · ${work.sourceChapterTitle}` : ''}
                </span>
              ) : null}
              <div className="account-work-card__actions">
                <Tooltip label={work.published ? '下架' : '上架'}>
                  <ActionIcon className="account-work-card__action" variant="subtle" aria-label={work.published ? '下架作品' : '上架作品'} loading={busyWorkId === work.id} onClick={() => void changePublication(work)}>
                    {work.published ? <IconEyeOff size={15} /> : <IconEye size={15} />}
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="删除作品">
                  <ActionIcon className="account-work-card__action account-work-card__action--danger" variant="subtle" aria-label="删除作品" disabled={busyWorkId === work.id} onClick={() => setConfirmDelete(work)}><IconTrash size={15} /></ActionIcon>
                </Tooltip>
              </div>
            </div>
          </article>
        ))}
      </div>
      {selectedWork ? (
        <section className="account-work-preview" aria-label={`${selectedWork.title}预览`}>
          <div className="account-work-preview__header">
            <div className="account-work-preview__identity">
              <strong className="account-work-preview__title">{selectedWork.title}</strong>
              <span className="account-work-preview__meta">{selectedWork.sourceProjectName ? `创作于 ${selectedWork.sourceProjectName}` : `发布于 ${formatTime(selectedWork.publishedAt)}`}</span>
            </div>
            <SegmentedControl className="account-work-preview__switch" size="xs" value={previewMode} onChange={(value) => setPreviewMode(value as WorkPreviewMode)} data={[{ value: 'video', label: '视频' }, { value: 'process', label: '创作过程' }]} />
          </div>
          {previewMode === 'video' ? (
            <video className="account-work-preview__video" controls preload="metadata" poster={selectedWork.coverImageUrl || undefined} src={selectedWork.videoUrl} />
          ) : selectedWork.sourceProjectId ? (
            <iframe
              className="account-work-preview__process"
              title={`${selectedWork.title}的创作过程`}
              src={buildStudioUrl({ projectId: selectedWork.sourceProjectId, ownerType: 'project', ownerId: selectedWork.sourceProjectId })}
            />
          ) : (
            <div className="account-work-preview__empty"><IconFolder className="account-work-preview__empty-icon" size={22} /><span className="account-work-preview__empty-copy">这件作品没有可访问的创作过程。</span></div>
          )}
        </section>
      ) : null}
      </div>
      {cursor ? <Button className="account-center-load-more" variant="subtle" loading={loadingMore} onClick={() => void load(cursor)}>加载更多</Button> : null}
      <Modal className="account-work-delete-modal" opened={Boolean(confirmDelete)} onClose={() => setConfirmDelete(null)} title="删除发布作品" centered>
        <div className="account-work-delete-modal__body">
          <p className="account-work-delete-modal__copy">将删除「{confirmDelete?.title || ''}」的发布快照，并从 Neo TV 移除。源项目和源视频资产不会被删除。</p>
          <div className="account-work-delete-modal__actions">
            <Button variant="default" onClick={() => setConfirmDelete(null)}>取消</Button>
            <Button color="red" loading={busyWorkId === confirmDelete?.id} onClick={() => void removeWork()}>确认删除</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function LikesGrid(): JSX.Element {
  type LikeItem = Awaited<ReturnType<typeof listAccountLikes>>['items'][number]
  const [items, setItems] = React.useState<LikeItem[]>([])
  const [cursor, setCursor] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [loadingMore, setLoadingMore] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async (nextCursor?: string | null) => {
    nextCursor ? setLoadingMore(true) : setLoading(true)
    setError(null)
    try {
      const page = await listAccountLikes(nextCursor)
      setItems((current) => nextCursor ? [...current, ...page.items] : page.items)
      setCursor(page.nextCursor)
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '加载作品失败')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [])

  React.useEffect(() => { void load(null) }, [load])
  if (loading || error || items.length === 0) return <StateView loading={loading} error={error} empty={items.length === 0} onRetry={() => void load(null)} />
  return (
    <div className="account-project-view">
      <div className="account-project-grid">
        {items.map((item) => {
          const project = item.project
          const available = item.available
          return (
            <button className={`account-project-card${available ? '' : ' is-unavailable'}`} key={item.likeId} type="button" disabled={!project || !available} onClick={() => project && spaNavigate(`/share?projectId=${encodeURIComponent(project.id)}`)}>
              <div className="account-project-card__media">
                {project?.coverUrl ? <ManagedImage className="account-project-card__image" src={project.coverUrl} alt={project.name} priority="visible" /> : <IconFolder className="account-project-card__placeholder" size={24} />}
              </div>
              <div className="account-project-card__content">
                <strong className="account-project-card__title">{project?.name || '作品已删除'}</strong>
                <span className="account-project-card__meta">{project ? `${project.likeCount} 赞 · ${project.viewCount} 浏览` : '原作品不存在'}</span>
                {!available ? <span className="account-project-card__status">已删除、私密或未发布</span> : null}
              </div>
            </button>
          )
        })}
      </div>
      {cursor ? <Button className="account-center-load-more" variant="subtle" loading={loadingMore} onClick={() => void load(cursor)}>加载更多</Button> : null}
    </div>
  )
}

type UnreadCountUpdater = (current: number) => number

function MessagesView({ onUnreadChange }: { onUnreadChange: (updater: UnreadCountUpdater) => void }): JSX.Element {
  const [filter, setFilter] = React.useState<'all' | 'unread' | 'read'>('all')
  const [items, setItems] = React.useState<AccountNotification[]>([])
  const [cursor, setCursor] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [loadingMore, setLoadingMore] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [loadMoreError, setLoadMoreError] = React.useState<string | null>(null)
  const [markingAll, setMarkingAll] = React.useState(false)
  const loadSequenceRef = React.useRef(0)
  const readingIdsRef = React.useRef(new Set<string>())

  const load = React.useCallback(async (nextCursor: string | null = null) => {
    const requestId = ++loadSequenceRef.current
    if (nextCursor) setLoadingMore(true)
    else setLoading(true)
    if (nextCursor) setLoadMoreError(null)
    else setError(null)
    try {
      const data = await listAccountNotifications(filter, nextCursor)
      if (requestId !== loadSequenceRef.current) return
      setItems((current) => nextCursor ? [...current, ...data.items] : data.items)
      setCursor(data.nextCursor)
      onUnreadChange(() => data.unreadCount)
    } catch (reason: unknown) {
      if (requestId !== loadSequenceRef.current) return
      const message = reason instanceof Error ? reason.message : '加载站内消息失败'
      if (nextCursor) setLoadMoreError(message)
      else setError(message)
    } finally {
      if (requestId === loadSequenceRef.current) {
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }, [filter, onUnreadChange])
  React.useEffect(() => {
    setItems([])
    setCursor(null)
    setLoadMoreError(null)
    void load()
    return () => { loadSequenceRef.current += 1 }
  }, [load])

  const markRead = React.useCallback(async (item: AccountNotification) => {
    if (item.readAt || readingIdsRef.current.has(item.id)) return
    readingIdsRef.current.add(item.id)
    try {
      const result = await readAccountNotification(item.id)
      setItems((current) => filter === 'unread'
        ? current.filter((row) => row.id !== item.id)
        : current.map((row) => row.id === item.id ? { ...row, readAt: result.readAt } : row))
      onUnreadChange((current) => Math.max(0, current - 1))
    } catch (reason: unknown) {
      toast(reason instanceof Error ? reason.message : '标记消息已读失败', 'error')
    } finally {
      readingIdsRef.current.delete(item.id)
    }
  }, [filter, onUnreadChange])

  const markAll = React.useCallback(async () => {
    setMarkingAll(true)
    try {
      const result = await readAllAccountNotifications()
      setItems((current) => filter === 'unread' ? [] : current.map((row) => ({ ...row, readAt: row.readAt || result.readAt })))
      if (filter === 'unread') setCursor(null)
      onUnreadChange(() => 0)
    } catch (reason: unknown) {
      toast(reason instanceof Error ? reason.message : '全部标为已读失败', 'error')
    } finally {
      setMarkingAll(false)
    }
  }, [filter, onUnreadChange])

  const showState = loading || Boolean(error) || items.length === 0
  return (
    <div className="account-messages-view">
      <div className="account-messages-view__toolbar">
        <SegmentedControl className="account-messages-view__filter" value={filter} onChange={(value) => setFilter(value as 'all' | 'unread' | 'read')} data={[{ value: 'all', label: '全部' }, { value: 'unread', label: '未读' }, { value: 'read', label: '已读' }]} />
        <Button className="account-messages-view__read-all" variant="subtle" loading={markingAll} disabled={loading} onClick={() => void markAll()}>全部标为已读</Button>
      </div>
      {showState ? <StateView loading={loading} error={error} empty={items.length === 0} onRetry={() => void load()} /> : (
        <div className="account-message-list">
          {items.map((item) => (
            <article className={`account-message${item.readAt ? ' is-read' : ' is-unread'}`} key={item.id} onClick={() => void markRead(item)}>
              <span className="account-message__indicator" />
              <div className="account-message__content"><strong className="account-message__title">{item.title}</strong><p className="account-message__body">{item.body}</p><time className="account-message__time">{formatTime(item.createdAt)}</time></div>
              {item.actionUrl ? <a className="account-message__action" href={item.actionUrl} target="_blank" rel="noreferrer" aria-label="打开消息链接"><IconExternalLink className="account-message__action-icon" size={15} /></a> : null}
            </article>
          ))}
        </div>
      )}
      {loadMoreError ? <div className="account-center-page-error"><span className="account-center-page-error__message">{loadMoreError}</span><Button className="account-center-page-error__retry" variant="subtle" onClick={() => void load(cursor)}>重试</Button></div> : null}
      {cursor && !showState && !loadMoreError ? <Button className="account-center-load-more" variant="subtle" loading={loadingMore} onClick={() => void load(cursor)}>加载更多</Button> : null}
    </div>
  )
}

function DevicesView({ onCurrentRevoked }: { onCurrentRevoked: () => void }): JSX.Element {
  const [items, setItems] = React.useState<AccountSession[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [revoking, setRevoking] = React.useState<string | null>(null)
  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try { setItems((await listAccountSessions()).items) }
    catch (reason: unknown) { setError(reason instanceof Error ? reason.message : '加载登录设备失败') }
    finally { setLoading(false) }
  }, [])
  React.useEffect(() => { void load() }, [load])
  const revoke = React.useCallback(async (item: AccountSession) => {
    if (!window.confirm(`确认移除${item.current ? '当前设备' : `“${item.deviceLabel}”`}?`)) return
    setRevoking(item.id)
    try {
      const result = await revokeAccountSession(item.id)
      if (result.current) onCurrentRevoked()
      else await load()
    } catch (reason: unknown) { toast(reason instanceof Error ? reason.message : '移除登录设备失败', 'error') }
    finally { setRevoking(null) }
  }, [load, onCurrentRevoked])
  if (loading || error || items.length === 0) return <StateView loading={loading} error={error} empty={items.length === 0} onRetry={() => void load()} />
  return <div className="account-device-list">{items.map((item) => <div className={`account-device-row${item.active ? '' : ' is-inactive'}`} key={item.id}><IconDevices className="account-device-row__icon" size={20} /><div className="account-device-row__content"><strong className="account-device-row__name">{item.deviceLabel}{item.current ? ' · 当前设备' : ''}</strong><span className="account-device-row__meta">最近使用 {formatTime(item.lastSeenAt)} · {item.active ? `有效至 ${formatTime(item.expiresAt)}` : '已失效'}</span></div>{item.active ? <Tooltip className="account-device-row__tooltip" label="移除此设备"><ActionIcon className="account-device-row__remove" variant="subtle" color="red" loading={revoking === item.id} aria-label="移除此设备" onClick={() => void revoke(item)}><IconTrash className="account-device-row__remove-icon" size={16} /></ActionIcon></Tooltip> : null}</div>)}</div>
}

function AccountsView({ onAddAccount }: { onAddAccount: () => void }): JSX.Element {
  const auth = useAuth()
  const [switching, setSwitching] = React.useState<string | null>(null)
  const switchTo = React.useCallback(async (id: string) => {
    setSwitching(id)
    try { await auth.switchAccount(id) }
    catch (reason: unknown) { toast(reason instanceof Error ? reason.message : '切换账号失败', 'error') }
    finally { setSwitching(null) }
  }, [auth])
  return (
    <div className="account-switcher-view">
      <div className="account-switcher-list">
        {auth.savedAccounts.map((account) => (
          <div className="account-switcher-row" key={account.id}>
            <div className="account-switcher-row__avatar">{account.user.avatarUrl ? <ManagedImage className="account-switcher-row__avatar-image" src={account.user.avatarUrl} alt={account.user.name || account.user.login} priority="visible" /> : <span className="account-switcher-row__avatar-fallback">{account.user.login.slice(0, 1).toUpperCase()}</span>}</div>
            <div className="account-switcher-row__content"><strong className="account-switcher-row__name">{account.user.name || account.user.login}</strong><span className="account-switcher-row__meta">{account.current ? '当前账号' : `上次使用 ${formatTime(account.lastUsedAt)}`}</span></div>
            {!account.current ? <Button className="account-switcher-row__switch" variant="subtle" loading={switching === account.id} onClick={() => void switchTo(account.id)}>切换</Button> : <span className="account-switcher-row__current">当前</span>}
            <Tooltip className="account-switcher-row__tooltip" label="从本机移除"><ActionIcon className="account-switcher-row__remove" variant="subtle" color="red" aria-label="从本机移除账号" onClick={() => { if (window.confirm('确认从本机移除这个账号？')) auth.removeSavedAccount(account.id) }}><IconTrash className="account-switcher-row__remove-icon" size={15} /></ActionIcon></Tooltip>
          </div>
        ))}
      </div>
      {auth.savedAccounts.length <= 1 ? <div className="account-switcher-view__empty">暂无其他账号</div> : null}
      <Button className="account-switcher-view__add" variant="subtle" leftSection={<IconPlus className="account-switcher-view__add-icon" size={15} />} onClick={onAddAccount}>添加账号</Button>
    </div>
  )
}

export default function AccountCenterDialog({
  opened,
  onClose,
  initialOverview,
  initialTab,
  onOverviewChange,
  onAddAccount,
}: {
  opened: boolean
  onClose: () => void
  initialOverview: AccountOverview | null
  initialTab: AccountCenterTabKey
  onOverviewChange: (overview: AccountOverview) => void
  onAddAccount: () => void
}): JSX.Element {
  const auth = useAuth()
  const [tab, setTab] = React.useState<AccountCenterTabKey>(initialTab)
  const [overview, setOverview] = React.useState<AccountOverview | null>(initialOverview)
  const overviewRef = React.useRef<AccountOverview | null>(initialOverview)
  overviewRef.current = overview
  React.useEffect(() => { if (initialOverview) setOverview(initialOverview) }, [initialOverview])
  const refreshOverview = React.useCallback(async () => {
    try { const data = await getAccountOverview(); setOverview(data); onOverviewChange(data) }
    catch (reason: unknown) { toast(reason instanceof Error ? reason.message : '刷新账户信息失败', 'error') }
  }, [onOverviewChange])
  const updateUnreadCount = React.useCallback((updater: UnreadCountUpdater) => {
    setOverview((current) => current ? { ...current, unreadCount: updater(current.unreadCount) } : current)
  }, [])
  const updateCheckIn = React.useCallback((checkIn: AccountCheckIn) => {
    const current = overviewRef.current
    if (!current) return
    const next = { ...current, credits: { ...current.credits, balance: checkIn.balance }, checkIn }
    overviewRef.current = next
    setOverview(next)
    onOverviewChange(next)
  }, [onOverviewChange])

  const finishLogout = React.useCallback(() => {
    auth.removeSavedAccount(String(auth.user?.sub || ''))
    onClose()
  }, [auth, onClose])
  const logout = React.useCallback(async () => {
    if (!window.confirm('确认退出当前账号？')) return
    try { await logoutAccount() }
    catch (reason: unknown) { toast(reason instanceof Error ? reason.message : '服务端退出登录失败', 'error'); return }
    finishLogout()
  }, [finishLogout])

  const guestRestricted = overview?.guestRestricted === true
  return (
    <Modal className="account-center-modal" opened={opened} onClose={onClose} size="min(1000px, calc(100vw - 32px))" centered title="账户中心">
        <div className="account-center-layout">
          <aside className="account-center-sidebar">
            <div className="account-center-sidebar__member">
              <IconCrown className="account-center-sidebar__member-icon" size={18} />
              <div className="account-center-sidebar__member-copy"><strong className="account-center-sidebar__member-title">{guestRestricted ? '游客账号' : overview?.membership.current ? overview.membership.current.planName : '普通用户'}</strong><span className="account-center-sidebar__member-meta">{guestRestricted ? '不可签到' : overview?.membership.current ? `有效至 ${formatTime(overview.membership.current.endAt)}` : '社区版账户'}</span></div>
            </div>
            <nav className="account-center-nav" aria-label="账户中心导航">{TABS.map((item) => { const ItemIcon = item.icon; return <button className={`account-center-nav__item${tab === item.key ? ' is-active' : ''}`} key={item.key} type="button" onClick={() => setTab(item.key)}><ItemIcon className="account-center-nav__icon" size={17} /><span className="account-center-nav__label">{item.label}</span>{item.key === 'messages' && overview?.unreadCount ? <span className="account-center-nav__badge">{overview.unreadCount}</span> : null}<IconChevronRight className="account-center-nav__chevron" size={14} /></button> })}</nav>
            <button className="account-center-sidebar__logout" type="button" onClick={() => void logout()}><IconLogout2 className="account-center-sidebar__logout-icon" size={17} /><span className="account-center-sidebar__logout-label">退出登录</span></button>
          </aside>
          <main className="account-center-content">
            <header className="account-center-content__header">
              <h2 className="account-center-content__title">{TABS.find((item) => item.key === tab)?.label}</h2>
            </header>
            <div className="account-center-content__body">
              {tab === 'profile' ? <ProfileView onChanged={() => void refreshOverview()} /> : null}
              {tab === 'rewards' ? <AccountRewardsView guestRestricted={guestRestricted} initialCheckIn={overview?.checkIn ?? null} onCheckInChanged={updateCheckIn} /> : null}
              {tab === 'works' ? <WorksGrid /> : null}
              {tab === 'likes' ? <LikesGrid /> : null}
              {tab === 'messages' ? <MessagesView onUnreadChange={updateUnreadCount} /> : null}
              {tab === 'credits' ? <AccountCreditsView /> : null}
              {tab === 'mcp' ? <McpIntegrationView /> : null}
              {tab === 'devices' ? <DevicesView onCurrentRevoked={finishLogout} /> : null}
              {tab === 'accounts' ? <AccountsView onAddAccount={onAddAccount} /> : null}
            </div>
          </main>
        </div>
    </Modal>
  )
}
