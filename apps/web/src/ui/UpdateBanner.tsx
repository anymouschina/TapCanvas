import React from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { IconX } from '@tabler/icons-react'
import './UpdateBanner.css'

const UPDATE_CONTROL_TIMEOUT_MS = 10_000

function describeUpdateFailure(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  return '新版本未能接管当前页面，请关闭本站的其他标签页后重试'
}

export default function UpdateBanner() {
  const [dismissed, setDismissed] = React.useState(false)
  const [updating, setUpdating] = React.useState(false)
  const [failureReason, setFailureReason] = React.useState<string | null>(null)
  const controlTimeoutRef = React.useRef<number | null>(null)
  const reloadRequestedRef = React.useRef(false)

  const clearControlTimeout = React.useCallback(() => {
    if (controlTimeoutRef.current === null) return
    window.clearTimeout(controlTimeoutRef.current)
    controlTimeoutRef.current = null
  }, [])

  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW({
    onNeedReload: () => {
      reloadRequestedRef.current = true
      clearControlTimeout()
      window.location.reload()
    },
  })

  React.useEffect(() => clearControlTimeout, [clearControlTimeout])

  const handleRefresh = React.useCallback(async () => {
    clearControlTimeout()
    reloadRequestedRef.current = false
    setFailureReason(null)
    setUpdating(true)

    try {
      await updateServiceWorker()
      if (reloadRequestedRef.current) return
      controlTimeoutRef.current = window.setTimeout(() => {
        controlTimeoutRef.current = null
        setUpdating(false)
        setFailureReason('等待新版本接管超时，请关闭本站的其他标签页后重试')
      }, UPDATE_CONTROL_TIMEOUT_MS)
    } catch (error: unknown) {
      setUpdating(false)
      setFailureReason(describeUpdateFailure(error))
    }
  }, [clearControlTimeout, updateServiceWorker])

  if (!needRefresh || dismissed) return null

  const label = failureReason
    ? `更新失败：${failureReason}`
    : updating
      ? '正在切换到新版本'
      : '发现新版本'

  return (
    <div className="tc-update-banner" role={failureReason ? 'alert' : 'status'}>
      <span className="tc-update-banner__label">{label}</span>
      <div className="tc-update-banner__actions">
        <button
          className="tc-update-banner__refresh"
          type="button"
          disabled={updating}
          onClick={() => void handleRefresh()}
        >
          {failureReason ? '重试' : updating ? '切换中' : '立即刷新'}
        </button>
        <button
          className="tc-update-banner__dismiss"
          type="button"
          disabled={updating}
          onClick={() => {
            clearControlTimeout()
            setDismissed(true)
          }}
          aria-label="关闭"
        >
          <IconX className="tc-update-banner__dismiss-icon" size={14} />
        </button>
      </div>
    </div>
  )
}
