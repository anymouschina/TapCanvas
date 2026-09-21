import { Modal } from '@mantine/core'

/** Local feedback keeps the existing page or canvas node available while code loads. */
export function AsyncLoadingFeedback(): JSX.Element {
  return (
    <div className="tc-async-loading" role="status" aria-live="polite" aria-busy="true"
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 12 }}>
      <span className="tc-async-loading__text">正在加载…</span>
    </div>
  )
}

export function AsyncDialogLoading({ onClose }: { onClose: () => void }): JSX.Element {
  return (
    <Modal className="tc-async-loading-dialog" opened onClose={onClose} title="正在加载" centered size="sm">
      <AsyncLoadingFeedback />
    </Modal>
  )
}
