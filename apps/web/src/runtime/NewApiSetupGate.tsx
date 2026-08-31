import React from 'react'
import type { NewApiGatewayReadinessDto } from '../api/server'
import { DEFAULT_PLATFORM_CREDENTIALS } from '../auth/defaultCredentials'
import { useAuth } from '../auth/store'
import './NewApiSetupGate.css'

type GateState =
  | { status: 'idle' }
  | { status: 'ready' }
  | { status: 'setup-required'; readiness: NewApiGatewayReadinessDto }
  | { status: 'error'; message: string }

function readinessDescription(readiness: NewApiGatewayReadinessDto): string {
  if (readiness.enabledModelCount === 0 && readiness.configuredChannelCount === 0) {
    return 'new-api 当前没有启用模型，也没有配置可用的渠道凭据。'
  }
  if (readiness.enabledModelCount === 0) {
    return 'new-api 已有渠道凭据，但模型目录中没有启用模型。'
  }
  if (readiness.configuredChannelCount === 0) {
    return 'new-api 已有启用模型，但还没有配置可用的渠道 API Key。'
  }
  return '已启用模型与已配置渠道尚未形成可执行路由，请在 new-api 检查渠道模型绑定。'
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  return '无法确认 new-api 配置状态'
}

export function NewApiSetupGate(): JSX.Element | null {
  const token = useAuth((state) => state.token)
  const userId = useAuth((state) => state.user?.sub)
  const [state, setState] = React.useState<GateState>({ status: 'idle' })
  const [checking, setChecking] = React.useState(false)
  const requestSequenceRef = React.useRef(0)

  const checkReadiness = React.useCallback(async (): Promise<void> => {
    if (!token || userId === undefined) {
      setState({ status: 'idle' })
      setChecking(false)
      return
    }
    const requestId = ++requestSequenceRef.current
    setChecking(true)
    try {
      const { getNewApiGatewayReadiness } = await import('../api/server')
      const readiness = await getNewApiGatewayReadiness()
      if (requestId !== requestSequenceRef.current) return
      setState(readiness.ready
        ? { status: 'ready' }
        : { status: 'setup-required', readiness })
    } catch (error: unknown) {
      if (requestId !== requestSequenceRef.current) return
      setState({ status: 'error', message: errorMessage(error) })
    } finally {
      if (requestId === requestSequenceRef.current) setChecking(false)
    }
  }, [token, userId])

  React.useEffect(() => {
    void checkReadiness()
    return () => { requestSequenceRef.current += 1 }
  }, [checkReadiness])

  React.useEffect(() => {
    if (state.status !== 'setup-required') return
    const handleFocus = (): void => { void checkReadiness() }
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [checkReadiness, state.status])

  if (!token || userId === undefined || state.status === 'idle' || state.status === 'ready') {
    return null
  }

  const readiness = state.status === 'setup-required' ? state.readiness : null
  return (
    <div className="new-api-setup-gate" role="presentation">
      <section
        className="new-api-setup-gate__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-api-setup-gate-title"
        aria-describedby="new-api-setup-gate-description"
      >
        <div className="new-api-setup-gate__brand" aria-hidden="true">N</div>
        <div className="new-api-setup-gate__content">
          <span className="new-api-setup-gate__eyebrow">首次启动检查</span>
          <h2 className="new-api-setup-gate__title" id="new-api-setup-gate-title">
            {state.status === 'error' ? '无法检查 new-api' : '先配置一个可用模型渠道'}
          </h2>
          <p className="new-api-setup-gate__description" id="new-api-setup-gate-description">
            {state.status === 'error'
              ? state.message
              : readiness
                ? readinessDescription(readiness)
                : '正在读取 new-api 的真实配置状态。'}
          </p>

          {readiness ? (
            <div className="new-api-setup-gate__recommendation">
              <span className="new-api-setup-gate__recommendation-label">推荐渠道</span>
              <strong className="new-api-setup-gate__recommendation-name">
                {readiness.recommendedProvider.name}
              </strong>
              <span className="new-api-setup-gate__recommendation-copy">
                先注册并获得管理员分配的额度，再创建令牌；回到本机 new-api 的“鲁班 API（推荐）”渠道粘贴令牌并启用。
              </span>
              <span className="new-api-setup-gate__recommendation-links">
                <a
                  className="new-api-setup-gate__recommendation-link"
                  href={readiness.recommendedProvider.registerUrl}
                  target="_blank"
                  rel="noreferrer"
                >注册</a>
                <a
                  className="new-api-setup-gate__recommendation-link"
                  href={readiness.recommendedProvider.topupUrl}
                  target="_blank"
                  rel="noreferrer"
                >兑换额度</a>
                <a
                  className="new-api-setup-gate__recommendation-link"
                  href={readiness.recommendedProvider.tokenUrl}
                  target="_blank"
                  rel="noreferrer"
                >创建令牌</a>
              </span>
            </div>
          ) : null}

          <div className="new-api-setup-gate__credentials">
            <span className="new-api-setup-gate__credentials-label">两个平台的默认管理员账号</span>
            <div className="new-api-setup-gate__credentials-list">
              {DEFAULT_PLATFORM_CREDENTIALS.map((credential) => (
                <div className="new-api-setup-gate__credential" key={credential.platform}>
                  <strong className="new-api-setup-gate__credential-platform">{credential.platform}</strong>
                  <span className="new-api-setup-gate__credential-item">
                    账号：<code className="new-api-setup-gate__credential-code">{credential.username}</code>
                  </span>
                  <span className="new-api-setup-gate__credential-item">
                    密码：<code className="new-api-setup-gate__credential-code">{credential.password}</code>
                  </span>
                </div>
              ))}
            </div>
            <span className="new-api-setup-gate__credentials-note">
              以上仅适用于未覆盖部署变量的首次启动；如果设置了 TAPCANVAS_ADMIN_* 或 NEW_API_ROOT_*，请以部署配置为准。生产环境请立即修改默认密码。
            </span>
          </div>

          {readiness ? (
            <dl className="new-api-setup-gate__facts">
              <div className="new-api-setup-gate__fact">
                <dt className="new-api-setup-gate__fact-label">启用模型</dt>
                <dd className="new-api-setup-gate__fact-value">{readiness.enabledModelCount}</dd>
              </div>
              <div className="new-api-setup-gate__fact">
                <dt className="new-api-setup-gate__fact-label">可用渠道</dt>
                <dd className="new-api-setup-gate__fact-value">{readiness.configuredChannelCount}</dd>
              </div>
              <div className="new-api-setup-gate__fact">
                <dt className="new-api-setup-gate__fact-label">可执行模型</dt>
                <dd className="new-api-setup-gate__fact-value">{readiness.executableModelCount}</dd>
              </div>
            </dl>
          ) : null}

          <div className="new-api-setup-gate__actions">
            {readiness ? (
              <a
                className="new-api-setup-gate__primary-action"
                href={readiness.setupUrl}
                target="_blank"
                rel="noreferrer"
              >
                第 2 步：打开本机 new-api 渠道配置
              </a>
            ) : null}
            <button
              className="new-api-setup-gate__secondary-action"
              type="button"
              onClick={() => void checkReadiness()}
              disabled={checking}
            >
              {checking ? '正在检查…' : readiness ? '我已完成配置' : '重新检查'}
            </button>
          </div>
          <p className="new-api-setup-gate__hint">
            推荐先完成鲁班 API 的注册、额度分配与令牌创建；至少一个已启用模型绑定有效渠道后，本页自动放行。
          </p>
        </div>
      </section>
    </div>
  )
}

export default NewApiSetupGate
