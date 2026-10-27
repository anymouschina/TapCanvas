import { lazy, Suspense, useCallback, useState } from 'react'
import { IconHistory } from '@tabler/icons-react'
import { LATEST_CHANGELOG_ID } from './entries'
import './ChangelogLauncher.css'

const ChangelogDialog = lazy(() => import('./ChangelogDialog'))
export const CHANGELOG_READ_STORAGE_KEY = 'tapcanvas.community.changelog.read'

type ReadState = { id: string | null; error: string | null }

function storageFailure(action: string, error: unknown): string {
  console.error(`[changelog] failed to ${action} read state`, error)
  return `无法${action === 'read' ? '读取' : '保存'}更新日志已读状态：${error instanceof Error ? error.message : String(error)}`
}

function readStoredState(): ReadState {
  try {
    return { id: window.localStorage.getItem(CHANGELOG_READ_STORAGE_KEY), error: null }
  } catch (error: unknown) {
    return { id: null, error: storageFailure('read', error) }
  }
}

export function ChangelogLauncher(): JSX.Element {
  const [opened, setOpened] = useState(false)
  const [readState, setReadState] = useState(readStoredState)
  const unread = !readState.error && readState.id !== LATEST_CHANGELOG_ID

  const markRead = useCallback((): void => {
    try {
      window.localStorage.setItem(CHANGELOG_READ_STORAGE_KEY, LATEST_CHANGELOG_ID)
      setReadState({ id: LATEST_CHANGELOG_ID, error: null })
    } catch (error: unknown) {
      const message = storageFailure('write', error)
      setReadState((current) => ({ ...current, error: message }))
    }
  }, [])

  return (
    <>
      <button
        className="portal-changelog-launcher"
        type="button"
        aria-label={unread ? '更新日志（有新内容）' : '更新日志'}
        title={unread ? '更新日志（有新内容）' : '更新日志'}
        aria-haspopup="dialog"
        aria-expanded={opened}
        onClick={() => setOpened(true)}
      >
        <IconHistory className="portal-changelog-launcher__icon" size={18} stroke={1.8} aria-hidden="true" />
        {unread ? <span className="portal-changelog-launcher__unread" aria-hidden="true" /> : null}
      </button>
      {opened ? (
        <Suspense fallback={<span className="portal-changelog-launcher__loading" role="status">正在加载更新日志…</span>}>
          <ChangelogDialog onClose={() => setOpened(false)} onRead={markRead} storageError={readState.error} />
        </Suspense>
      ) : null}
    </>
  )
}
