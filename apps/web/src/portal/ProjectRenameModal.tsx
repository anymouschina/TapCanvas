import React from 'react'
import { Button, Group, Modal, TextInput } from '@mantine/core'
import type { ProjectDto } from '../api/server'
import './ProjectRenameModal.css'

type ProjectRenameModalProps = {
  project: ProjectDto | null
  draft: string
  busy: boolean
  onDraftChange: (name: string) => void
  onClose: () => void
  onSubmit: () => Promise<void>
}

export function ProjectRenameModal({ project, draft, busy, onDraftChange, onClose, onSubmit }: ProjectRenameModalProps): JSX.Element {
  return (
    <Modal className="project-rename-modal" opened={Boolean(project)} onClose={onClose} title="重命名画布" centered>
      <form className="project-rename-modal__form" onSubmit={(event) => { event.preventDefault(); void onSubmit() }}>
        <TextInput
          className="project-rename-modal__input"
          label="画布名称"
          value={draft}
          maxLength={120}
          autoFocus
          onChange={(event) => onDraftChange(event.currentTarget.value)}
        />
        <Group className="project-rename-modal__actions" justify="flex-end" mt="md">
          <Button className="project-rename-modal__cancel" variant="subtle" onClick={onClose} disabled={busy}>取消</Button>
          <Button className="project-rename-modal__submit" type="submit" loading={busy}>保存</Button>
        </Group>
      </form>
    </Modal>
  )
}
