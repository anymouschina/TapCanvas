import React from 'react'
import { IconAlertTriangle, IconRefresh } from '@tabler/icons-react'
import './AppErrorBoundary.css'

type AppErrorBoundaryProps = {
  children: React.ReactNode
  title?: string
  onDismiss?: () => void
}

type AppErrorBoundaryState = {
  error: Error | null
}

function normalizeError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

export class AppErrorBoundary extends React.Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    return { error: normalizeError(error) }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[app-error-boundary] render failed', {
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
    })
  }

  render(): React.ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="tc-app-error" role="alert">
        <div className="tc-app-error__panel">
          <IconAlertTriangle className="tc-app-error__icon" size={26} />
          <div className="tc-app-error__copy">
            <strong className="tc-app-error__title">{this.props.title || '页面加载失败'}</strong>
            <span className="tc-app-error__message">{error.message || '发生未知渲染错误'}</span>
          </div>
          <div className="tc-app-error__actions">
            {this.props.onDismiss ? (
              <button className="tc-app-error__button tc-app-error__button--subtle" type="button" onClick={this.props.onDismiss}>
                关闭
              </button>
            ) : null}
            <button className="tc-app-error__button" type="button" onClick={() => window.location.reload()}>
              <IconRefresh className="tc-app-error__button-icon" size={15} />
              <span className="tc-app-error__button-label">重新加载</span>
            </button>
          </div>
        </div>
      </div>
    )
  }
}
