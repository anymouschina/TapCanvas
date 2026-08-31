import React from 'react'
import { ActionIcon, Button, Checkbox, Loader, NumberInput, SegmentedControl, TextInput, Textarea, Tooltip } from '@mantine/core'
import { IconRefresh, IconSend, IconTrash } from '@tabler/icons-react'
import {
  createAccountAdminNotification,
  getAccountAdminSettings,
  listAccountAdminNotifications,
  listAccountAdminSessions,
  revokeAccountAdminSession,
  saveAccountAdminSettings,
  type AccountAdminNotification,
  type AccountAdminSession,
  type AccountAdminSettings,
} from '../../../api/accountAdmin'
import { toast } from '../../toast'
import './stats-account.css'

const INITIAL_SETTINGS: AccountAdminSettings = {
  checkInEnabled: false,
  checkInRewardCredits: 10,
  membershipEnabled: false,
  sessionTtlDays: 7,
  maxActiveSessions: 10,
}

function formatTime(value: string): string {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString('zh-CN') : value
}

export default function StatsAccountManagement({ className }: { className?: string }): JSX.Element {
  const [settings, setSettings] = React.useState<AccountAdminSettings>(INITIAL_SETTINGS)
  const [configured, setConfigured] = React.useState(false)
  const [sessions, setSessions] = React.useState<AccountAdminSession[]>([])
  const [notifications, setNotifications] = React.useState<AccountAdminNotification[]>([])
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [audience, setAudience] = React.useState<'all' | 'users'>('users')
  const [userIds, setUserIds] = React.useState('')
  const [messageType, setMessageType] = React.useState('system')
  const [title, setTitle] = React.useState('')
  const [body, setBody] = React.useState('')
  const [actionUrl, setActionUrl] = React.useState('')
  const [sending, setSending] = React.useState(false)
  const [revoking, setRevoking] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [settingsState, sessionPage, notificationPage] = await Promise.all([
        getAccountAdminSettings(),
        listAccountAdminSessions(),
        listAccountAdminNotifications(),
      ])
      setConfigured(settingsState.configured)
      setSettings(settingsState.settings || {
        ...INITIAL_SETTINGS,
        sessionTtlDays: settingsState.effectiveSessionTtlDays,
        maxActiveSessions: settingsState.effectiveMaxActiveSessions,
      })
      setSessions(sessionPage.items)
      setNotifications(notificationPage.items)
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '加载账户后台失败')
    } finally { setLoading(false) }
  }, [])
  React.useEffect(() => { void load() }, [load])

  const save = React.useCallback(async () => {
    setSaving(true)
    try {
      const state = await saveAccountAdminSettings(settings)
      if (!state.settings) throw new Error('保存成功但服务端未返回有效配置')
      setConfigured(true)
      setSettings(state.settings)
      toast('账户中心配置已保存', 'success')
    } catch (reason: unknown) { toast(reason instanceof Error ? reason.message : '保存配置失败', 'error') }
    finally { setSaving(false) }
  }, [settings])

  const send = React.useCallback(async () => {
    const recipients = userIds.split('\n').map((value) => value.trim()).filter(Boolean)
    if (!title.trim() || !body.trim()) { toast('标题和正文不能为空', 'error'); return }
    if (audience === 'users' && recipients.length === 0) { toast('定向发送必须填写用户 ID', 'error'); return }
    if (audience === 'all' && !window.confirm('确认向全部有效用户发送这条站内消息？')) return
    setSending(true)
    try {
      const result = await createAccountAdminNotification({ audience, ...(audience === 'users' ? { userIds: recipients } : {}), type: messageType, title, body, actionUrl: actionUrl.trim() || null })
      toast(`已创建 ${result.createdCount} 条站内消息`, 'success')
      setTitle(''); setBody(''); setActionUrl('')
      setNotifications((await listAccountAdminNotifications()).items)
    } catch (reason: unknown) { toast(reason instanceof Error ? reason.message : '发送站内消息失败', 'error') }
    finally { setSending(false) }
  }, [actionUrl, audience, body, messageType, title, userIds])

  const revoke = React.useCallback(async (session: AccountAdminSession) => {
    if (!window.confirm(`确认移除 ${session.userName} 的 ${session.deviceLabel} 会话？`)) return
    setRevoking(session.id)
    try { await revokeAccountAdminSession(session.id); setSessions((current) => current.filter((item) => item.id !== session.id)); toast('设备会话已移除', 'success') }
    catch (reason: unknown) { toast(reason instanceof Error ? reason.message : '移除会话失败', 'error') }
    finally { setRevoking(null) }
  }, [])

  return (
    <div className={['stats-account', className].filter(Boolean).join(' ')}>
      <header className="stats-account__header"><div className="stats-account__heading"><h2 className="stats-account__title">账户与会员</h2><span className={`stats-account__status${configured ? ' is-configured' : ' is-unconfigured'}`}>{configured ? '已配置' : '未配置'}</span></div><Tooltip className="stats-account__refresh-tooltip" label="刷新"><ActionIcon className="stats-account__refresh" variant="subtle" aria-label="刷新账户后台" onClick={() => void load()}><IconRefresh className="stats-account__refresh-icon" size={17} /></ActionIcon></Tooltip></header>
      {loading ? <div className="stats-account__state"><Loader className="stats-account__loader" size="sm" /></div> : error ? <div className="stats-account__state stats-account__state--error"><span className="stats-account__error">{error}</span><Button className="stats-account__retry" variant="subtle" onClick={() => void load()}>重试</Button></div> : (
        <div className="stats-account__content">
          <section className="stats-account-section"><h3 className="stats-account-section__title">能力配置</h3><div className="stats-account-settings"><Checkbox className="stats-account-settings__toggle" label="开放每日签到" checked={settings.checkInEnabled} onChange={(event) => setSettings((current) => ({ ...current, checkInEnabled: event.currentTarget.checked }))} /><NumberInput className="stats-account-settings__field" label="单次签到积分" min={1} max={1000000} value={settings.checkInRewardCredits} onChange={(value) => setSettings((current) => ({ ...current, checkInRewardCredits: typeof value === 'number' ? value : 10 }))} /><Checkbox className="stats-account-settings__toggle" label="开放会员购买" checked={settings.membershipEnabled} onChange={(event) => setSettings((current) => ({ ...current, membershipEnabled: event.currentTarget.checked }))} /><NumberInput className="stats-account-settings__field" label="会话有效天数" min={1} max={90} value={settings.sessionTtlDays} onChange={(value) => setSettings((current) => ({ ...current, sessionTtlDays: typeof value === 'number' ? value : 7 }))} /><NumberInput className="stats-account-settings__field" label="单账号最大活跃设备" min={1} max={50} value={settings.maxActiveSessions} onChange={(value) => setSettings((current) => ({ ...current, maxActiveSessions: typeof value === 'number' ? value : 10 }))} /><Button className="stats-account-settings__save" loading={saving} onClick={() => void save()}>保存配置</Button></div></section>
          <section className="stats-account-section"><h3 className="stats-account-section__title">发送站内消息</h3><div className="stats-account-message-form"><SegmentedControl className="stats-account-message-form__audience" value={audience} onChange={(value) => setAudience(value as 'all' | 'users')} data={[{ value: 'users', label: '指定用户' }, { value: 'all', label: '全部用户' }]} />{audience === 'users' ? <Textarea className="stats-account-message-form__field" label="用户 ID（每行一个）" value={userIds} minRows={2} onChange={(event) => setUserIds(event.currentTarget.value)} /> : null}<TextInput className="stats-account-message-form__field" label="消息类型" value={messageType} maxLength={64} onChange={(event) => setMessageType(event.currentTarget.value)} /><TextInput className="stats-account-message-form__field" label="标题" value={title} maxLength={120} onChange={(event) => setTitle(event.currentTarget.value)} /><Textarea className="stats-account-message-form__field" label="正文" value={body} maxLength={2000} minRows={3} onChange={(event) => setBody(event.currentTarget.value)} /><TextInput className="stats-account-message-form__field" label="跳转链接（可选）" value={actionUrl} onChange={(event) => setActionUrl(event.currentTarget.value)} /><Button className="stats-account-message-form__send" loading={sending} leftSection={<IconSend className="stats-account-message-form__send-icon" size={15} />} onClick={() => void send()}>发送</Button></div></section>
          <section className="stats-account-section"><h3 className="stats-account-section__title">活跃登录设备</h3>{sessions.length === 0 ? <div className="stats-account-section__empty">暂无活跃设备</div> : <div className="stats-account-session-list">{sessions.map((session) => <div className="stats-account-session" key={session.id}><div className="stats-account-session__user"><strong className="stats-account-session__name">{session.userName}</strong><span className="stats-account-session__id">{session.userId}</span></div><div className="stats-account-session__device"><span className="stats-account-session__label">{session.deviceLabel}</span><time className="stats-account-session__time">最近使用 {formatTime(session.lastSeenAt)}</time></div><Tooltip className="stats-account-session__tooltip" label="移除此设备"><ActionIcon className="stats-account-session__revoke" color="red" variant="subtle" loading={revoking === session.id} aria-label="移除此设备" onClick={() => void revoke(session)}><IconTrash className="stats-account-session__revoke-icon" size={15} /></ActionIcon></Tooltip></div>)}</div>}</section>
          <section className="stats-account-section"><h3 className="stats-account-section__title">最近站内消息</h3>{notifications.length === 0 ? <div className="stats-account-section__empty">尚未发送站内消息</div> : <div className="stats-account-notification-list">{notifications.map((item) => <div className="stats-account-notification" key={item.id}><div className="stats-account-notification__content"><strong className="stats-account-notification__title">{item.title}</strong><span className="stats-account-notification__body">{item.body}</span></div><div className="stats-account-notification__meta"><span className="stats-account-notification__user">{item.userName}</span><time className="stats-account-notification__time">{formatTime(item.createdAt)}</time><span className="stats-account-notification__read">{item.readAt ? '已读' : '未读'}</span></div></div>)}</div>}</section>
        </div>
      )}
    </div>
  )
}
