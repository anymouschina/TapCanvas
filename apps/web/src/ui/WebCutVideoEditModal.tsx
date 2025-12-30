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
        content: { background: 'rgba(0,0,0,.95)', overflow: 'hidden' },
        body: {
          padding: 0,
          height: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        },
      }}
    >
      <div className="webcut-video-edit-modal__frame" style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <div className="webcut-video-edit-modal__overlay" style={{ position: 'absolute', top: 10, left: 10, right: 10, zIndex: 2, pointerEvents: 'none' }}>
          <Group className="webcut-video-edit-modal__overlay-bar" justify="space-between" wrap="nowrap">
            <div className="webcut-video-edit-modal__overlay-left" style={{ pointerEvents: 'none' }}>
              {loading && (
                <Group className="webcut-video-edit-modal__uploading" gap={6} style={{ pointerEvents: 'none' }}>
                  <Loader className="webcut-video-edit-modal__uploading-icon" size="xs" />
                  <Text className="webcut-video-edit-modal__uploading-text" size="xs" c="dimmed">
                    正在上传剪辑结果…
                  </Text>
                </Group>
              )}
            </div>
            <ActionIcon
              className="webcut-video-edit-modal__close"
              variant="subtle"
              color="gray"
              onClick={onClose}
              disabled={loading}
              title="关闭"
              style={{ pointerEvents: 'auto', background: 'rgba(0,0,0,.35)' }}
            >
              <IconX className="webcut-video-edit-modal__close-icon" size={18} />
            </ActionIcon>
          </Group>
        </div>
        <iframe
          className="webcut-video-edit-modal__iframe"
          src={iframeSrc}
          title="WebCut Editor"
          style={{ width: '100%', height: '100%', border: 0, background: 'black', display: 'block' }}
          allow="clipboard-read; clipboard-write"
        />
      </div>
    </Modal>
  )
}
