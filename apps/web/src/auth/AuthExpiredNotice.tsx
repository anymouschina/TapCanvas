import React from 'react'
import './AuthExpiredNotice.css'

const AUTH_EXPIRED_EVENT = 'tapcanvas:auth-expired'
const NOTICE_DURATION_MS = 4_000

export function notifyAuthExpired(): void {
  window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT))
}

export function AuthExpiredNotice(): JSX.Element | null {
  const [visible, setVisible] = React.useState(false)
  const hideTimerRef = React.useRef<number | null>(null)

  React.useEffect(() => {
    const showNotice = (): void => {
      if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current)
      setVisible(true)
      hideTimerRef.current = window.setTimeout(() => {
        setVisible(false)
        hideTimerRef.current = null
      }, NOTICE_DURATION_MS)
    }

    window.addEventListener(AUTH_EXPIRED_EVENT, showNotice)
    return () => {
      window.removeEventListener(AUTH_EXPIRED_EVENT, showNotice)
      if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current)
    }
  }, [])

  if (!visible) return null

  return (
    <div className="tc-auth-expired-notice" role="alert">
      <span className="tc-auth-expired-notice__message">登录状态已过期，请重新登录</span>
    </div>
  )
}
