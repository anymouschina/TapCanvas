import React from 'react'
import { ActionIcon, Badge, Button, Group, Modal, Paper, Stack, Text, TextInput } from '@mantine/core'
import { IconTrash } from '@tabler/icons-react'

type VeoCandidateImage = { url: string; label: string; sourceType: 'image' | 'video' }

type VeoImageModalProps = {
  opened: boolean
  mode: 'first' | 'last' | 'reference'
  statusColor: string
  firstFrameLocked: boolean
  trimmedFirstFrameUrl: string
  trimmedLastFrameUrl: string
  veoReferenceImages: string[]
  veoReferenceLimitReached: boolean
  veoCustomImageInput: string
  veoCandidateImages: VeoCandidateImage[]
  mediaFallbackSurface: string
  inlineDividerColor: string
  onClose: () => void
  onCustomImageInputChange: (value: string) => void
  onAddCustomReferenceImage: () => void
  onRemoveReferenceImage: (url: string) => void
  onSetFirstFrameUrl: (url: string) => void
  onSetLastFrameUrl: (url: string) => void
  onToggleReference: (url: string) => void
}

export function VeoImageModal({
  opened,
  mode,
  statusColor,
  firstFrameLocked,
  trimmedFirstFrameUrl,
  trimmedLastFrameUrl,
  veoReferenceImages,
  veoReferenceLimitReached,
  veoCustomImageInput,
  veoCandidateImages,
  mediaFallbackSurface,
  inlineDividerColor,
  onClose,
  onCustomImageInputChange,
  onAddCustomReferenceImage,
  onRemoveReferenceImage,
  onSetFirstFrameUrl,
  onSetLastFrameUrl,
  onToggleReference,
}: VeoImageModalProps) {
  return (
    <Modal
      className="veo-image-modal"
      opened={opened}
      onClose={onClose}
      title={
        mode === 'first'
          ? '选择首帧图片'
          : mode === 'last'
            ? '选择尾帧图片'
            : '管理参考图'
      }
      size="lg"
      centered
      withinPortal
      zIndex={8200}
    >
      <Stack className="veo-image-modal-body" gap="sm">
        {mode === 'reference' && (
          <>
            {firstFrameLocked && (
              <Text className="veo-image-modal-warning" size="xs" c="red">
                已设置首帧时无法添加或选择参考图。请先清空首帧 URL。
              </Text>
            )}
            <Group className="veo-image-modal-input-row" gap="xs" align="flex-end">
              <TextInput
                className="veo-image-modal-input"
                label="添加参考图"
                placeholder="https://example.com/ref.png"
                value={veoCustomImageInput}
                onChange={(e) => onCustomImageInputChange(e.currentTarget.value)}
                style={{ flex: 1 }}
                disabled={firstFrameLocked}
              />
              <Button
                className="veo-image-modal-add"
                size="xs"
                onClick={onAddCustomReferenceImage}
                disabled={firstFrameLocked || !veoCustomImageInput.trim() || veoReferenceLimitReached}
              >
                添加
              </Button>
            </Group>
            {veoReferenceImages.length === 0 ? (
              <Text className="veo-image-modal-empty" size="xs" c="dimmed">
                未选择参考图。
              </Text>
            ) : (
              <Group className="veo-image-modal-reference-list" gap={6} wrap="wrap">
                {veoReferenceImages.map((url) => (
                  <Paper className="veo-image-modal-reference-card" key={url} radius="md" p="xs" withBorder style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div
                      className="veo-image-modal-reference-thumb"
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: 6,
                        overflow: 'hidden',
                        border: `1px solid ${inlineDividerColor}`,
                        background: mediaFallbackSurface,
                      }}
                    >
                      <img className="veo-image-modal-reference-img" src={url} alt="参考图" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </div>
                    <ActionIcon className="veo-image-modal-reference-remove" size="xs" variant="subtle" onClick={() => onRemoveReferenceImage(url)}>
                      <IconTrash className="veo-image-modal-reference-remove-icon" size={12} />
                    </ActionIcon>
                  </Paper>
                ))}
              </Group>
            )}
          </>
        )}
        {veoCandidateImages.length === 0 ? (
          <Text className="veo-image-modal-candidate-empty" size="sm" c="dimmed">
            暂无可用图片，试着连接图像节点。
          </Text>
        ) : (
          <div
            className="veo-image-modal-candidate-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
              gap: 12,
            }}
          >
            {veoCandidateImages.map((candidate) => {
              const isSelected = veoReferenceImages.includes(candidate.url)
              const isFirstFrame = firstFrameLocked && trimmedFirstFrameUrl === candidate.url
              const isLastFrame = firstFrameLocked && trimmedLastFrameUrl === candidate.url
              const isImageSource = candidate.sourceType === 'image'
              const borderColor = isFirstFrame || isLastFrame || isSelected ? statusColor : inlineDividerColor
              return (
                <Paper className="veo-image-modal-candidate-card" key={`${candidate.url}-${candidate.label}`} radius="md" p="xs" withBorder style={{ borderColor }}>
                  <div
                    className="veo-image-modal-candidate-thumb"
                    style={{
                      borderRadius: 6,
                      overflow: 'hidden',
                      marginBottom: 6,
                      border: `1px solid ${inlineDividerColor}`,
                      background: mediaFallbackSurface,
                    }}
                  >
                    <img className="veo-image-modal-candidate-img" src={candidate.url} alt={candidate.label} style={{ width: '100%', height: 120, objectFit: 'cover', display: 'block' }} />
                  </div>
                  <Text className="veo-image-modal-candidate-label" size="xs" c="dimmed" lineClamp={1}>
                    {candidate.label}
                  </Text>
                  <Group className="veo-image-modal-candidate-actions" gap={4} mt={6} wrap="wrap">
                    {mode === 'first' && (
                      <Button
                        className="veo-image-modal-candidate-action"
                        size="compact-xs"
                        variant="subtle"
                        disabled={!isImageSource}
                        onClick={() => {
                          onSetFirstFrameUrl(candidate.url)
                          onClose()
                        }}
                      >
                        {isFirstFrame ? '已设首帧' : '设为首帧'}
                      </Button>
                    )}
                    {mode === 'last' && (
                      <Button
                        className="veo-image-modal-candidate-action"
                        size="compact-xs"
                        variant="subtle"
                        disabled={!firstFrameLocked || !isImageSource}
                        onClick={() => {
                          onSetLastFrameUrl(candidate.url)
                          onClose()
                        }}
                      >
                        {isLastFrame ? '已设尾帧' : '设为尾帧'}
                      </Button>
                    )}
                    {mode === 'reference' && (
                      <Button
                        className="veo-image-modal-candidate-action"
                        size="compact-xs"
                        variant={isSelected ? 'filled' : 'subtle'}
                        disabled={firstFrameLocked || (!isSelected && veoReferenceLimitReached)}
                        onClick={() => onToggleReference(candidate.url)}
                      >
                        {isSelected ? '已选参考' : '添加参考'}
                      </Button>
                    )}
                  </Group>
                </Paper>
              )
            })}
          </div>
        )}
        {mode === 'first' && trimmedFirstFrameUrl && (
          <Button className="veo-image-modal-clear" variant="subtle" size="xs" onClick={() => onSetFirstFrameUrl('')}>
            清除首帧
          </Button>
        )}
        {mode === 'last' && trimmedLastFrameUrl && (
          <Button className="veo-image-modal-clear" variant="subtle" size="xs" onClick={() => onSetLastFrameUrl('')} disabled={!firstFrameLocked}>
            清除尾帧
          </Button>
        )}
      </Stack>
    </Modal>
  )
}
