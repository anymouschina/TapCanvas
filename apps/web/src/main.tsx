import React from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { AuthExpiredNotice } from './auth/AuthExpiredNotice'
import { installAuth401Interceptor } from './auth/fetch401Interceptor'
import UpdateBanner from './ui/UpdateBanner'
import { GlobalClickFeedback } from './ui/GlobalClickFeedback'
import { AppErrorBoundary } from './ui/AppErrorBoundary'
import { BrowserZoomLock } from './runtime/BrowserZoomLock'
import { NewApiSetupGate } from './runtime/NewApiSetupGate'

const RouteEntrypoint = React.lazy(() => import('./RouteEntrypoint'))

document.documentElement.setAttribute('data-mantine-color-scheme', 'dark')
installAuth401Interceptor()
;(function captureReferralCode() {
  if (typeof window === 'undefined') return
  try {
    const url = new URL(window.location.href)
    const ref = url.searchParams.get('ref')
    if (ref && /^[A-HJ-NP-Z2-9]{6}$/i.test(ref)) {
      window.sessionStorage.setItem('tapcanvas:pendingRef', ref.toUpperCase())
      url.searchParams.delete('ref')
      window.history.replaceState({}, '', url.toString())
    }
  } catch (err) {
    console.warn('[referral] capture failed', err)
  }
})()

const container = document.getElementById('root')
if (!container) throw new Error('Root container not found')
const root = createRoot(container)

root.render(
  <React.StrictMode>
    <BrowserZoomLock />
    <GlobalClickFeedback />
    <AppErrorBoundary>
      <React.Suspense fallback={<div className="tc-app-route-loading" aria-label="页面加载中" />}>
        <RouteEntrypoint />
      </React.Suspense>
      <NewApiSetupGate />
    </AppErrorBoundary>
    <AuthExpiredNotice />
    <UpdateBanner />
  </React.StrictMode>
)
