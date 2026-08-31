import React from 'react'
import { ActionIcon, Loader, Menu, Tooltip } from '@mantine/core'
import { IconBell, IconChevronRight, IconCoins, IconCrown, IconGift, IconKey, IconLogout2, IconPlugConnected, IconRefresh, IconUser, IconUsersGroup } from '@tabler/icons-react'
import { useAuth } from '../auth/store'
import { ManagedImage } from '../domain/resource-runtime/components/ManagedImage'
import { toast } from '../ui/toast'
import { getAccountOverview, logoutAccount, performAccountCheckIn, type AccountOverview } from './accountApi'
import type { AccountCenterTabKey } from './account/AccountCenterDialog'
import './PortalAccountMenu.css'

const AccountCenterDialogLazy = React.lazy(() => import('./account/AccountCenterDialog'))
const TeamManagementModalLazy = React.lazy(() => import('../ui/team/TeamManagementModal'))
const ApiKeyManagementModalLazy = React.lazy(async () => {
  const module = await import('../ui/account/ApiKeyManagementModal')
  return { default: module.ApiKeyManagementModal }
})

type AccountCenterRequest = {
  initialTab: AccountCenterTabKey
}

export function PortalAccountMenu({ onRequestLogin }: { onRequestLogin: () => void }): JSX.Element {
  const auth = useAuth()
  const [overview, setOverview] = React.useState<AccountOverview | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [checkingIn, setCheckingIn] = React.useState(false)
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [centerRequest, setCenterRequest] = React.useState<AccountCenterRequest | null>(null)
  const [teamManagementOpen, setTeamManagementOpen] = React.useState(false)
  const [apiKeyManagementOpen, setApiKeyManagementOpen] = React.useState(false)
  const loadSequenceRef = React.useRef(0)
  const authToken = auth.token
  const scopedOverview = overview?.profile.id === String(auth.user?.sub) ? overview : null
  const guestRestricted = scopedOverview?.guestRestricted === true
  const hasActiveMembership = Boolean(scopedOverview?.membership.current)

  const load = React.useCallback(async () => {
    const requestId = ++loadSequenceRef.current
    const tokenAtStart = authToken
    if (!tokenAtStart) {
      setOverview(null)
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const data = await getAccountOverview()
      if (requestId !== loadSequenceRef.current || useAuth.getState().token !== tokenAtStart) return
      setOverview(data)
    } catch (reason: unknown) {
      if (requestId !== loadSequenceRef.current || useAuth.getState().token !== tokenAtStart) return
      setError(reason instanceof Error ? reason.message : '加载账户信息失败')
    } finally {
      if (requestId === loadSequenceRef.current && useAuth.getState().token === tokenAtStart) setLoading(false)
    }
  }, [authToken])

  React.useEffect(() => {
    setOverview(null)
    setError(null)
    setLoading(Boolean(authToken))
    setMenuOpen(false)
    setCenterRequest(null)
    setTeamManagementOpen(false)
    setApiKeyManagementOpen(false)
    void load()
    return () => { loadSequenceRef.current += 1 }
  }, [authToken, load])

  const openCenter = React.useCallback((initialTab: AccountCenterTabKey) => {
    setMenuOpen(false)
    setCenterRequest({ initialTab })
  }, [])

  const checkIn = React.useCallback(async () => {
    setCheckingIn(true)
    try {
      const result = await performAccountCheckIn()
      toast(result.awarded ? `签到成功，获得 ${result.rewardCredits} 积分` : '今日已签到', result.awarded ? 'success' : 'info')
      await load()
    } catch (reason: unknown) {
      toast(reason instanceof Error ? reason.message : '签到失败', 'error')
    } finally { setCheckingIn(false) }
  }, [load])

  const logout = React.useCallback(async () => {
    if (!window.confirm('确认退出当前账号？')) return
    try { await logoutAccount() }
    catch (reason: unknown) { toast(reason instanceof Error ? reason.message : '退出登录失败', 'error'); return }
    auth.removeSavedAccount(String(auth.user?.sub || ''))
  }, [auth])

  const name = scopedOverview?.profile.name || auth.user?.name || auth.user?.login || 'TapCanvas 用户'
  const avatarUrl = scopedOverview?.profile.avatarUrl || auth.user?.avatarUrl || null

  return (
    <>
      <div className="neo-portal-account-actions">
        {scopedOverview?.checkIn && !guestRestricted ? (
          <Tooltip
            className="neo-portal-check-in__tooltip"
            label={scopedOverview.checkIn.checkedInToday ? '今日已签到' : '签到有礼'}
            withArrow
          >
            <span className="neo-portal-check-in__target">
              <ActionIcon
                className="neo-portal-check-in"
                variant="subtle"
                size="sm"
                loading={checkingIn}
                disabled={!scopedOverview.checkIn.configured || !scopedOverview.checkIn.enabled || scopedOverview.checkIn.checkedInToday}
                aria-label={scopedOverview.checkIn.checkedInToday ? '今日已签到' : '签到有礼'}
                onClick={() => void checkIn()}
              >
                <IconGift className="neo-portal-check-in__icon" size={16} />
              </ActionIcon>
            </span>
          </Tooltip>
        ) : null}
        <Menu
          className="neo-portal-user-menu"
          opened={menuOpen}
          onChange={setMenuOpen}
          position="bottom-end"
          trigger="click-hover"
          openDelay={120}
          closeDelay={180}
          offset={8}
          shadow="md"
          width={300}
        >
          <Menu.Target>
            <ActionIcon className="neo-portal-header__avatar-button" variant="subtle" aria-label="账户菜单，悬停查看账户状态">
              <span className="neo-portal-header__avatar">
                {avatarUrl ? <ManagedImage className="neo-portal-header__avatar-image" src={avatarUrl} alt={name} priority="critical" /> : <span className="neo-portal-header__avatar-fallback">{name.slice(0, 1).toUpperCase()}</span>}
                {scopedOverview?.unreadCount ? <span className="neo-portal-header__unread-dot" /> : null}
              </span>
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown className="neo-portal-user-menu__dropdown">
            <div className="neo-account-card">
              <div className="neo-account-card__identity">
                <span className="neo-account-card__avatar">{avatarUrl ? <ManagedImage className="neo-account-card__avatar-image" src={avatarUrl} alt={name} priority="visible" /> : <span className="neo-account-card__avatar-fallback">{name.slice(0, 1)}</span>}</span>
                <div className="neo-account-card__copy"><strong className="neo-account-card__name">{name}</strong><button className="neo-account-card__uid" type="button" onClick={() => void navigator.clipboard.writeText(String(scopedOverview?.profile.id || auth.user?.sub || '')).then(() => toast('UID 已复制', 'success')).catch(() => toast('复制 UID 失败', 'error'))}>UID {scopedOverview?.profile.id || auth.user?.sub}</button></div>
              </div>
              {loading ? <div className="neo-account-card__state"><Loader className="neo-account-card__loader" size="xs" /></div> : null}
              {error ? <div className="neo-account-card__state neo-account-card__state--error"><span className="neo-account-card__error">{error}</span><Tooltip className="neo-account-card__retry-tooltip" label="重新加载"><ActionIcon className="neo-account-card__retry" variant="subtle" aria-label="重新加载账户信息" onClick={() => void load()}><IconRefresh className="neo-account-card__retry-icon" size={14} /></ActionIcon></Tooltip></div> : null}
              {scopedOverview ? (
                <div className="neo-account-card__summary">
                  <div className="neo-account-card__summary-row">
                    <IconCrown className={`neo-account-card__summary-icon neo-account-card__membership-icon${hasActiveMembership ? ' is-active' : ''}`} size={16} />
                    <span className="neo-account-card__summary-label">{scopedOverview.membership.current ? scopedOverview.membership.current.planName : guestRestricted ? '游客账号' : '普通用户'}</span>
					<span className="neo-account-card__summary-action">{hasActiveMembership ? '已配置' : '社区版'}</span>
                  </div>
                  <button className="neo-account-card__summary-row" type="button" onClick={() => openCenter('credits')}><IconCoins className="neo-account-card__summary-icon" size={16} /><span className="neo-account-card__summary-label">积分</span><strong className="neo-account-card__summary-value">{scopedOverview.credits.balance}</strong><IconChevronRight className="neo-account-card__summary-chevron" size={14} /></button>
                  <button className="neo-account-card__summary-row" type="button" onClick={() => openCenter('messages')}><IconBell className="neo-account-card__summary-icon" size={16} /><span className="neo-account-card__summary-label">站内消息</span><strong className="neo-account-card__summary-value">{scopedOverview.unreadCount ? `${scopedOverview.unreadCount} 未读` : '无未读'}</strong><IconChevronRight className="neo-account-card__summary-chevron" size={14} /></button>
                </div>
              ) : null}
              {guestRestricted ? <div className="neo-account-card__guest-notice">游客账号不可签到</div> : null}
              <div className="neo-account-card__commands">
                <button className="neo-account-card__command" type="button" onClick={() => openCenter('profile')}><IconUser className="neo-account-card__command-icon" size={16} /><span className="neo-account-card__command-label">账户中心</span></button>
                <button className="neo-account-card__command" type="button" onClick={() => openCenter('mcp')}><IconPlugConnected className="neo-account-card__command-icon" size={16} /><span className="neo-account-card__command-label">MCP（作为远程工具）</span></button>
                <button className="neo-account-card__command" type="button" onClick={() => { setMenuOpen(false); setApiKeyManagementOpen(true) }}><IconKey className="neo-account-card__command-icon" size={16} /><span className="neo-account-card__command-label">密钥管理</span></button>
                <button className="neo-account-card__command" type="button" disabled={guestRestricted} onClick={() => { setMenuOpen(false); setTeamManagementOpen(true) }}><IconUsersGroup className="neo-account-card__command-icon" size={16} /><span className="neo-account-card__command-label">团队管理</span></button>
                <button className="neo-account-card__command" type="button" disabled={guestRestricted} onClick={() => openCenter('rewards')}><IconGift className="neo-account-card__command-icon" size={16} /><span className="neo-account-card__command-label">赚取积分</span></button>
                <button className="neo-account-card__command neo-account-card__command--danger" type="button" onClick={() => void logout()}><IconLogout2 className="neo-account-card__command-icon" size={16} /><span className="neo-account-card__command-label">退出登录</span></button>
              </div>
            </div>
          </Menu.Dropdown>
        </Menu>
      </div>
      {centerRequest ? (
        <React.Suspense fallback={<div className="neo-account-center-loading"><Loader className="neo-account-center-loading__spinner" size="sm" /></div>}>
          <AccountCenterDialogLazy
            opened
            onClose={() => setCenterRequest(null)}
            initialTab={centerRequest.initialTab}
            initialOverview={scopedOverview}
            onOverviewChange={setOverview}
            onAddAccount={() => { setCenterRequest(null); onRequestLogin() }}
          />
        </React.Suspense>
      ) : null}
      {teamManagementOpen ? (
        <React.Suspense fallback={null}>
          <TeamManagementModalLazy opened onClose={() => setTeamManagementOpen(false)} />
        </React.Suspense>
      ) : null}
      {apiKeyManagementOpen ? (
        <React.Suspense fallback={<div className="neo-account-center-loading"><Loader className="neo-account-center-loading__spinner" size="sm" /></div>}>
          <ApiKeyManagementModalLazy
            opened
            onClose={() => setApiKeyManagementOpen(false)}
            persistCreatedKeyLocally={false}
          />
        </React.Suspense>
      ) : null}
    </>
  )
}
