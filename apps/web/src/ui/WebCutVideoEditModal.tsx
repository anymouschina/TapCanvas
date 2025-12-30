import React from 'react'
import { ActionIcon, Group, Loader, Modal, Text } from '@mantine/core'
import { IconX } from '@tabler/icons-react'

type WebCutVideoEditModalProps = {
  opened: boolean
  iframeSrc: string
  loading?: boolean
  onClose: () => void
}

export function WebCutVideoEditModal(props: WebCutVideoEditModalProps): JSX.Element | null {
  const { opened, iframeSrc, loading = false, onClose } = props

  if (!opened) return null

  return (
    <Modal
      className="webcut-video-edit-modal"
      opened={opened}
      onClose={onClose}
      fullScreen
      withCloseButton={false}
      padding={0}
      styles={{
        content: { background: 'rgba(0,0,0,.95)' },
        body: { padding: 0, height: '100vh', display: 'flex', flexDirection: 'column' },
      }}
    >
      <Group className="webcut-video-edit-modal__header" justify="space-between" px="md" py="sm" style={{ borderBottom: '1px solid rgba(255,255,255,.08)' }}>
        <Group className="webcut-video-edit-modal__header-left" gap="xs">
          <Text className="webcut-video-edit-modal__title" size="sm" fw={600} c="gray.1">
            WebCut · 视频剪辑（仅当前节点）
          </Text>
          {loading && (
            <Group className="webcut-video-edit-modal__uploading" gap={6}>
              <Loader className="webcut-video-edit-modal__uploading-icon" size="xs" />
              <Text className="webcut-video-edit-modal__uploading-text" size="xs" c="dimmed">
                正在上传剪辑结果…
              </Text>
            </Group>
          )}
        </Group>
        <ActionIcon className="webcut-video-edit-modal__close" variant="subtle" color="gray" onClick={onClose} disabled={loading} title="关闭">
          <IconX className="webcut-video-edit-modal__close-icon" size={18} />
        </ActionIcon>
      </Group>
      <div className="webcut-video-edit-modal__frame" style={{ flex: 1, minHeight: 0 }}>
        <iframe
          className="webcut-video-edit-modal__iframe"
          src={iframeSrc}
          title="WebCut Editor"
          style={{ width: '100%', height: '100%', border: 0, background: 'black' }}
          allow="clipboard-read; clipboard-write"
        />
      </div>
    </Modal>
  )
}

