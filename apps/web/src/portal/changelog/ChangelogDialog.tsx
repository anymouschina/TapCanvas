import { useEffect } from 'react'
import { Modal } from '@mantine/core'
import { CHANGELOG_ENTRIES } from './entries'
import './ChangelogDialog.css'

type ChangelogDialogProps = {
  onClose: () => void
  onRead: () => void
  storageError: string | null
}

export default function ChangelogDialog({ onClose, onRead, storageError }: ChangelogDialogProps): JSX.Element {
  useEffect(onRead, [onRead])

  return (
    <Modal
      className="portal-changelog-modal"
      opened
      onClose={onClose}
      title="更新日志"
      centered
      size={560}
      radius={8}
      classNames={{ content: 'portal-changelog', title: 'portal-changelog__title', body: 'portal-changelog__body' }}
      closeButtonProps={{ 'aria-label': '关闭更新日志' }}
    >
      <p className="portal-changelog__intro">TapCanvas 社区版的功能与体验更新</p>
      {storageError ? <p className="portal-changelog__error" role="alert">{storageError}</p> : null}
      <ol className="portal-changelog__entries">
        {CHANGELOG_ENTRIES.map(({ id, date, title, changes }, index) => (
          <li className="portal-changelog__entry" key={id}>
            <div className="portal-changelog__meta">
              <time className="portal-changelog__date" dateTime={date}>{date.split('-').join('.')}</time>
              {index === 0 ? <span className="portal-changelog__latest">最近更新</span> : null}
            </div>
            <h3 className="portal-changelog__heading">{title}</h3>
            <ul className="portal-changelog__changes">
              {changes.map((change) => <li className="portal-changelog__change" key={change}>{change}</li>)}
            </ul>
          </li>
        ))}
      </ol>
    </Modal>
  )
}
