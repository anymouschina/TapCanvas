import React from 'react'
import { ActionIcon, Badge, Button, Group, NumberInput, Paper, Select, Stack, Text, TextInput, Textarea } from '@mantine/core'
import { IconPlus, IconSparkles, IconTrash } from '@tabler/icons-react'

import {
  STORYBOARD_DURATION_STEP,
  STORYBOARD_FRAMING_OPTIONS,
  STORYBOARD_MAX_DURATION,
  STORYBOARD_MAX_TOTAL_DURATION,
  STORYBOARD_MIN_DURATION,
  STORYBOARD_MOVEMENT_OPTIONS,
  type StoryboardScene,
} from '../storyboardUtils'

type Props = {
  scenes: StoryboardScene[]
  title: string
  notes: string
  totalDuration: number
  lightContentBackground: string
  onGenerateScript?: () => void
  generateScriptLoading?: boolean
  generateScriptDisabled?: boolean
  onTitleChange: (value: string) => void
  onAddScene: () => void
  onRemoveScene: (id: string) => void
  onDurationDelta: (id: string, delta: number) => void
  onUpdateScene: (id: string, patch: Partial<StoryboardScene>) => void
  onNotesChange: (value: string) => void
}

export function StoryboardEditor({
  scenes,
  title,
  notes,
  totalDuration,
  lightContentBackground,
  onGenerateScript,
  generateScriptLoading,
  generateScriptDisabled,
  onTitleChange,
  onAddScene,
  onRemoveScene,
  onDurationDelta,
  onUpdateScene,
  onNotesChange,
}: Props) {
  return (
    <Stack className="storyboard-editor" gap="xs">
      <TextInput
        className="storyboard-editor-title-input"
        label="分镜标题"
        placeholder="例如：武侠对决 · 紫禁之巅"
        value={title}
        onChange={(e) => onTitleChange(e.currentTarget.value)}
        size="xs"
      />
      <Group className="storyboard-editor-script-actions" justify="space-between" align="center" wrap="wrap" gap="xs">
        <Text className="storyboard-editor-script-hint" size="xs" c="dimmed">
          可连接文本/图片节点作为参考，自动生成分镜脚本与镜头参数。
        </Text>
        <Button
          className="storyboard-editor-script-generate"
          size="xs"
          variant="light"
          leftSection={<IconSparkles className="storyboard-editor-script-generate-icon" size={14} />}
          onClick={onGenerateScript}
          disabled={!onGenerateScript || !!generateScriptDisabled}
          loading={!!generateScriptLoading}
        >
          生成脚本
        </Button>
      </Group>
      <Stack className="storyboard-editor-scenes" gap="xs">
        {scenes.map((scene, idx) => (
          <Paper
            className="storyboard-editor-scene"
            key={scene.id}
            radius="md"
            p="xs"
            style={{ background: lightContentBackground }}
          >
            <Group className="storyboard-editor-scene-header" justify="space-between" align="flex-start" mb={6}>
              <div className="storyboard-editor-scene-title">
                <Text className="storyboard-editor-scene-name" size="sm" fw={600}>{`Scene ${idx + 1}`}</Text>
                <Text className="storyboard-editor-scene-desc" size="xs" c="dimmed">
                  镜头描述与台词
                </Text>
              </div>
              <Group className="storyboard-editor-scene-actions" gap={4}>
                <Badge className="storyboard-editor-scene-duration" color="blue" variant="light">
                  {scene.duration.toFixed(1)}s
                </Badge>
                <Button
                  className="storyboard-editor-scene-duration-add"
                  size="compact-xs"
                  variant="light"
                  onClick={() => onDurationDelta(scene.id, 15)}
                  disabled={scene.duration >= STORYBOARD_MAX_DURATION}
                >
                  +15s
                </Button>
                <ActionIcon
                  className="storyboard-editor-scene-remove"
                  size="sm"
                  variant="subtle"
                  color="red"
                  onClick={() => onRemoveScene(scene.id)}
                  disabled={scenes.length === 1}
                  title="删除该 Scene"
                >
                  <IconTrash className="storyboard-editor-scene-remove-icon" size={14} />
                </ActionIcon>
              </Group>
            </Group>
            <Textarea
              className="storyboard-editor-scene-text"
              autosize
              minRows={3}
              maxRows={6}
              placeholder="描写镜头构图、动作、情绪、台词，以及需要引用的 @角色……"
              value={scene.description}
              onChange={(e) =>
                onUpdateScene(scene.id, { description: e.currentTarget.value })
              }
            />
            <Group className="storyboard-editor-scene-controls" gap="xs" mt={6} align="flex-end" wrap="wrap">
              <Select
                className="storyboard-editor-scene-select"
                label="镜头景别"
                placeholder="可选"
                data={STORYBOARD_FRAMING_OPTIONS}
                value={scene.framing || null}
                onChange={(value) =>
                  onUpdateScene(scene.id, {
                    framing: (value as StoryboardScene['framing']) || undefined,
                  })
                }
                size="xs"
                withinPortal
                clearable
              />
              <Select
                className="storyboard-editor-scene-select"
                label="镜头运动"
                placeholder="可选"
                data={STORYBOARD_MOVEMENT_OPTIONS}
                value={scene.movement || null}
                onChange={(value) =>
                  onUpdateScene(scene.id, {
                    movement: (value as StoryboardScene['movement']) || undefined,
                  })
                }
                size="xs"
                withinPortal
                clearable
              />
              <NumberInput
                className="storyboard-editor-scene-duration-input"
                label="时长 (秒)"
                size="xs"
                min={STORYBOARD_MIN_DURATION}
                max={STORYBOARD_MAX_DURATION}
                step={STORYBOARD_DURATION_STEP}
                value={scene.duration}
                onChange={(value) => {
                  const next = typeof value === 'number' ? value : Number(value) || scene.duration
                  onUpdateScene(scene.id, { duration: next })
                }}
                style={{ width: 120 }}
              />
            </Group>
          </Paper>
        ))}
      </Stack>
      <Button
        className="storyboard-editor-add"
        variant="light"
        size="xs"
        leftSection={<IconPlus className="storyboard-editor-add-icon" size={14} />}
        onClick={onAddScene}
      >
        添加 Scene
      </Button>
      <Textarea
        className="storyboard-editor-notes"
        label="全局风格 / 备注"
        autosize
        minRows={2}
        maxRows={4}
        placeholder="补充整体风格、镜头节奏、素材要求，或写下 Sora 需要遵循的额外说明。"
        value={notes}
        onChange={(e) => onNotesChange(e.currentTarget.value)}
      />
      <Group className="storyboard-editor-summary" justify="space-between">
        <Text className="storyboard-editor-summary-text" size="xs" c="dimmed">
          当前共 {scenes.length} 个镜头。You're using {scenes.length} video gens with current settings.
        </Text>
        <Text
          className="storyboard-editor-summary-duration"
          size="xs"
          c={totalDuration > STORYBOARD_MAX_TOTAL_DURATION ? 'red.4' : 'dimmed'}
        >
          总时长 {totalDuration.toFixed(1)}s / {STORYBOARD_MAX_TOTAL_DURATION}s
        </Text>
      </Group>
    </Stack>
  )
}
