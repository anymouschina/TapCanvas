import * as React from 'react'
import type { CodexPreviewResolution } from '@tapcanvas/codex-task-protocol'
import { resolveCodexPreview } from '../api/codex'
import './CodexPreviewPage.css'

type PreviewState =
  | { status: 'loading' }
  | { status: 'ready'; preview: CodexPreviewResolution }
  | { status: 'failed'; message: string }

function message(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message.trim()
    : '无法读取 Codex 构建预览'
}

export default function CodexPreviewPage(input: {
  previewId: string
}): JSX.Element {
  const [state, setState] = React.useState<PreviewState>({ status: 'loading' })

  const load = React.useCallback(async () => {
    setState({ status: 'loading' })
    try {
      const preview = await resolveCodexPreview(input.previewId)
      setState({ status: 'ready', preview })
    } catch (error) {
      setState({ status: 'failed', message: message(error) })
    }
  }, [input.previewId])

  React.useEffect(() => {
    void load()
  }, [load])

  if (state.status === 'loading') {
    return (
      <main className="tc-codex-preview tc-codex-preview--loading">
        <div className="tc-codex-preview__status">
          <span className="tc-codex-preview__spinner" aria-hidden="true" />
          <p className="tc-codex-preview__status-text">
            正在解析已验收的隔离预览…
          </p>
        </div>
      </main>
    )
  }

  if (state.status === 'failed') {
    return (
      <main className="tc-codex-preview tc-codex-preview--failed">
        <section className="tc-codex-preview__failure">
          <h1 className="tc-codex-preview__failure-title">预览不可用</h1>
          <p className="tc-codex-preview__failure-message">{state.message}</p>
          <button
            type="button"
            className="tc-codex-preview__retry"
            onClick={() => void load()}
          >
            重新读取
          </button>
        </section>
      </main>
    )
  }

  return (
    <main className="tc-codex-preview tc-codex-preview--ready">
      <header className="tc-codex-preview__header">
        <div className="tc-codex-preview__identity">
          <span className="tc-codex-preview__mark" aria-hidden="true">T</span>
          <div className="tc-codex-preview__copy">
            <strong className="tc-codex-preview__title">Codex 构建预览</strong>
            <span className="tc-codex-preview__expiry">
              {new Date(state.preview.expiresAt).toLocaleString()} 失效
            </span>
          </div>
        </div>
        <a
          className="tc-codex-preview__external"
          href={state.preview.url}
          target="_blank"
          rel="noreferrer"
        >
          新窗口打开
        </a>
      </header>
      <iframe
        className="tc-codex-preview__frame"
        src={state.preview.url}
        title="Codex isolated build preview"
        sandbox="allow-downloads allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
        referrerPolicy="no-referrer"
      />
    </main>
  )
}
