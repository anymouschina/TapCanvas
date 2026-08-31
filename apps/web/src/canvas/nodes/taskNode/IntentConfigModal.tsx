import React, { useEffect, useState } from 'react'
import { Modal, Button, Checkbox, Select, Group, Stack, Switch, Textarea, SegmentedControl, Text } from '@mantine/core'
import type { ChapterCanvasIntent } from '@tapcanvas/chapter-canvas-intents'
import { useModelOptions } from '../../../config/useModelOptions'

const IMAGE_SIZE_OPTIONS = [
  { value: '1K', label: '1K（标准）' },
  { value: '2K', label: '2K（高清）' },
  { value: '4K', label: '4K（超清）' },
]

const SHOT_DURATION_OPTIONS = [
  { label: '5s', value: '5' },
  { label: '10s', value: '10' },
  { label: '15s', value: '15' },
  { label: '30s', value: '30' },
]

const DEFAULT_IMAGE_SIZE = '2K'
const DEFAULT_SHOT_DURATION = '15'

type Props = {
  opened: boolean
  intent?: ChapterCanvasIntent
  onConfirm: (params: {
    imageModel: string
    imageSize: string
    rebuildSceneReferences?: boolean
    userHints?: string
    lineArtMode?: boolean
    shotDuration?: number
  }) => void
  onCancel: () => void
}

function resolveIntentConfigDefaultModel(models: { value: string }[]): string {
  return models[0]?.value ?? ''
}

export function IntentConfigModal({ opened, intent, onConfirm, onCancel }: Props) {
  // 该 Modal 常驻挂载于 TaskNode：只在打开时才拉模型目录（只读/未登录画布会 401）
  const imageModels = useModelOptions('imageEdit', { enabled: opened })
  const modelOptions = imageModels.map((m) => ({ value: m.value, label: m.label }))
  const defaultModel = resolveIntentConfigDefaultModel(imageModels)

  const [imageModel, setImageModel] = useState(defaultModel)
  const [imageSize, setImageSize] = useState(DEFAULT_IMAGE_SIZE)
  const [rebuildSceneReferences, setRebuildSceneReferences] = useState(false)
  const [userHints, setUserHints] = useState('')
  const [lineArtMode, setLineArtMode] = useState(false)
  const [shotDuration, setShotDuration] = useState(DEFAULT_SHOT_DURATION)

  const canRebuildSceneReferences = intent === 'generate_scene_references'
  const isShotPlaceholders = intent === 'generate_shot_placeholders'

  useEffect(() => {
    if (opened && imageModels.length > 0 && !imageModels.find((m) => m.value === imageModel)) {
      setImageModel(resolveIntentConfigDefaultModel(imageModels))
    }
  }, [opened, imageModels, imageModel])

  useEffect(() => {
    if (opened) {
      setRebuildSceneReferences(false)
      setUserHints('')
      setLineArtMode(false)
      setShotDuration(DEFAULT_SHOT_DURATION)
    }
  }, [opened, intent])

  return (
    <Modal
      className="intent-config-modal"
      opened={opened}
      onClose={onCancel}
      title="生成参数"
      size="sm"
      centered
    >
      <Stack className="intent-config-modal-stack" gap="md">
        <Select
          className="intent-config-modal-model-select"
          label="图片模型"
          data={modelOptions}
          value={imageModel}
          onChange={(v) => setImageModel(v ?? defaultModel)}
          placeholder={imageModels.length === 0 ? '加载中…' : undefined}
          disabled={imageModels.length === 0}
        />
        <Select
          className="intent-config-modal-size-select"
          label="分辨率"
          data={IMAGE_SIZE_OPTIONS}
          value={imageSize}
          onChange={(v) => setImageSize(v ?? DEFAULT_IMAGE_SIZE)}
        />

        {isShotPlaceholders && (
          <>
            <Stack gap={6}>
              <Text size="sm" fw={500}>单镜时长</Text>
              <SegmentedControl
                fullWidth
                value={shotDuration}
                onChange={setShotDuration}
                data={SHOT_DURATION_OPTIONS}
              />
            </Stack>

            <Switch
              label="线稿风格"
              description="生成线稿 / 草图占位图，轻量快速"
              checked={lineArtMode}
              onChange={(e) => setLineArtMode(e.currentTarget.checked)}
            />
          </>
        )}

        {canRebuildSceneReferences && (
          <Checkbox
            className="intent-config-modal-rebuild-checkbox"
            checked={rebuildSceneReferences}
            onChange={(event) => setRebuildSceneReferences(event.currentTarget.checked)}
            label="重建参考图"
            description="勾选后忽略书籍元数据中的已有参考图 URL，重新创建待生成节点。"
          />
        )}

        <Textarea
          label="附加提示词（可选）"
          description="追加到生成提示，可描述整体风格、场景基调等"
          placeholder="例：冷色调，极简构图"
          value={userHints}
          onChange={(e) => setUserHints(e.currentTarget.value)}
          minRows={2}
          maxRows={4}
          autosize
        />

        <Group className="intent-config-modal-actions" justify="flex-end" mt="xs">
          <Button className="intent-config-modal-cancel-button" variant="subtle" color="gray" onClick={onCancel}>取消</Button>
          <Button
            className="intent-config-modal-submit-button"
            disabled={!imageModel}
            onClick={() => onConfirm({
              imageModel,
              imageSize,
              ...(canRebuildSceneReferences && rebuildSceneReferences ? { rebuildSceneReferences: true } : {}),
              ...(userHints.trim() ? { userHints: userHints.trim() } : {}),
              ...(isShotPlaceholders && lineArtMode ? { lineArtMode: true } : {}),
              ...(isShotPlaceholders ? { shotDuration: Number(shotDuration) } : {}),
            })}
          >
            开始生成
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
