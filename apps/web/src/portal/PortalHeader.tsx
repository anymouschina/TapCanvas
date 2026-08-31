import React from 'react'
import {
  IconBraces,
  IconFolders,
  IconHome,
  IconSparkles,
  IconSettings,
  IconVideo,
} from '@tabler/icons-react'
import { useAuth } from '../auth/store'
import { useIsAdmin } from '../auth/isAdmin'
import { TapCanvasWordmark } from '../ui/brand/TapCanvasMark'
import { spaNavigate } from '../utils/spaNavigate'
import { preloadPortalRoute } from './portalRouteModules'

const PortalAccountRuntime = React.lazy(() => import('./PortalAccountRuntime'))
const PortalLoginRuntime = React.lazy(() => import('./PortalLoginRuntime'))

export type PortalRoute = 'home' | 'neo-tv' | 'prompts' | 'projects' | 'skills'

type PortalHeaderProps = {
  active: PortalRoute
  onNavigate?: (href: string) => void
  onRequestLogin?: () => void
}

const NAV_ITEMS: ReadonlyArray<{
  key: PortalRoute | 'projects'
  label: string
  href: string
  icon: typeof IconHome
}> = [
  { key: 'home', label: '主页', href: '/', icon: IconHome },
  { key: 'neo-tv', label: 'TcTv', href: '/projects', icon: IconVideo },
  { key: 'prompts', label: '提示词', href: '/prompts', icon: IconBraces },
  { key: 'skills', label: 'Skill', href: '/skills', icon: IconSparkles },
  { key: 'projects', label: '画布', href: '/canvas', icon: IconFolders },
]

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void | Promise<void>) => { finished: Promise<void> }
}

function navigatePortal(href: string): void {
  if (typeof document === 'undefined') return
  const startViewTransition = (document as ViewTransitionDocument).startViewTransition
  if (!startViewTransition) {
    spaNavigate(href)
    return
  }
  startViewTransition.call(document, () => {
    spaNavigate(href)
  })
}

export function PortalHeader({ active, onNavigate, onRequestLogin }: PortalHeaderProps): JSX.Element {
  const auth = useAuth()
  const isAdmin = useIsAdmin()
  const [loginOpen, setLoginOpen] = React.useState(false)

  React.useEffect(() => {
    if (onNavigate) return
    const onPointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Element)) return
      const interactive = event.target.closest('button, a, [role="button"]')
      if (!interactive || interactive.hasAttribute('disabled')) return
      const feedback = document.createElement('span')
      feedback.className = 'tc-portal-click-feedback'
      feedback.style.left = `${event.clientX}px`
      feedback.style.top = `${event.clientY}px`
      document.body.append(feedback)
      feedback.addEventListener('animationend', () => feedback.remove(), { once: true })
    }
    document.addEventListener('pointerdown', onPointerDown, { passive: true })
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [onNavigate])

  const navigate = React.useCallback((href: string): void => {
    if (onNavigate) {
      onNavigate(href)
      return
    }
    navigatePortal(href)
  }, [onNavigate])

  const requestLogin = React.useCallback((): void => {
    if (onRequestLogin) {
      onRequestLogin()
      return
    }
    setLoginOpen(true)
  }, [onRequestLogin])

  return (
    <>
      <header className="neo-portal-header">
        <button className="neo-portal-brand" type="button" aria-label="TapCanvas 首页" onClick={() => navigate('/')}>
          <TapCanvasWordmark
            className="neo-portal-brand__wordmark"
            markClassName="neo-portal-brand__logo"
            nameClassName="neo-portal-brand__name"
            markSize={27}
          />
        </button>

        <nav className="neo-portal-nav" aria-label="主导航">
          {NAV_ITEMS.map((item) => {
            const ItemIcon = item.icon
            const selected = item.key === active
            return (
              <button
                key={item.key}
                className={`neo-portal-nav__item${selected ? ' is-active' : ''}`}
                type="button"
                aria-current={selected ? 'page' : undefined}
                onPointerEnter={() => {
                  void preloadPortalRoute(item.key).catch((error: unknown) => {
                    console.error(`[portal] failed to prefetch ${item.key}`, error)
                  })
                }}
                onFocus={() => {
                  void preloadPortalRoute(item.key).catch((error: unknown) => {
                    console.error(`[portal] failed to prefetch ${item.key}`, error)
                  })
                }}
                onClick={() => navigate(item.href)}
              >
                <ItemIcon className="neo-portal-nav__icon" size={15} stroke={1.8} />
                <span className="neo-portal-nav__label">{item.label}</span>
              </button>
            )
          })}
        </nav>

        <div className="neo-portal-header__actions">
          {isAdmin && active === 'home' ? (
            <button
              className="neo-portal-header__admin"
              type="button"
              aria-label="进入后台管理"
              onClick={() => navigate('/stats')}
            >
              <IconSettings className="neo-portal-header__admin-icon" size={15} stroke={1.8} />
              <span className="neo-portal-header__admin-label">后台管理</span>
            </button>
          ) : null}

          {auth.token ? (
            <React.Suspense fallback={<span className="neo-portal-header__account-loading" aria-hidden="true" />}>
              <PortalAccountRuntime onRequestLogin={requestLogin} />
            </React.Suspense>
          ) : (
            <button className="neo-portal-header__login" type="button" onClick={requestLogin}>
              登录
            </button>
          )}
        </div>
      </header>
      {onRequestLogin || !loginOpen ? null : (
        <React.Suspense fallback={null}>
          <PortalLoginRuntime opened={loginOpen} onClose={() => setLoginOpen(false)} />
        </React.Suspense>
      )}
    </>
  )
}
