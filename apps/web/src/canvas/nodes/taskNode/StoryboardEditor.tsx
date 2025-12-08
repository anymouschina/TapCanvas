import React from 'react'
import { ActionIcon, Badge, Button, Group, NumberInput, Paper, Select, Stack, Text, TextInput, Textarea } from '@mantine/core'
import { IconPlus, IconTrash } from '@tabler/icons-react'

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
  onTitleChange,
  onAddScene,
  onRemoveScene,
  onDurationDelta,
  onUpdateScene,
  onNotesChange,
}: Props) {
  return (
    <Stack gap="xs">
      <TextInput
        label="分镜标题"
        placeholder="例如：武侠对决 · 紫禁之巅"
        value={title}
        onChange={(e) => onTitleChange(e.currentTarget.value)}
        size="xs"
      />
      <Stack gap="xs">
        {scenes.map((scene, idx) => (
          <Paper
            key={scene.id}
            radius="md"
            p="xs"
            style={{ background: lightContentBackground }}
          >
            <Group justify="space-between" align="flex-start" mb={6}>
              <div>
                <Text size="sm" fw={600}>{`Scene ${idx + 1}`}</Text>
                <Text size="xs" c="dimmed">
                  镜头描述与台词
                </Text>
              </div>
              <Group gap={4}>
                <Badge color="blue" variant="light">
                  {scene.duration.toFixed(1)}s
                </Badge>
                <Button
                  size="compact-xs"
                  variant="light"
                  onClick={() => onDurationDelta(scene.id, 15)}
                  disabled={scene.duration >= STORYBOARD_MAX_DURATION}
                >
                  +15s
                </Button>
                <ActionIcon
                  size="sm"
                  variant="subtle"
                  color="red"
                  onClick={() => onRemoveScene(scene.id)}
                  disabled={scenes.length === 1}
                  title="删除该 Scene"
                >
                  <IconTrash size={14} />
                </ActionIcon>
              </Group>
            </Group>
            <Textarea
              autosize
              minRows={3}
              maxRows={6}
              placeholder="描写镜头构图、动作、情绪、台词，以及需要引用的 @角色……"
              value={scene.description}
              onChange={(e) =>
                onUpdateScene(scene.id, { description: e.currentTarget.value })
              }
            />
            <Group gap="xs" mt={6} align="flex-end" wrap="wrap">
              <Select
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
        variant="light"
        size="xs"
        leftSection={<IconPlus size={14} />}
        onClick={onAddScene}
      >
        添加 Scene
      </Button>
      <Textarea
        label="全局风格 / 备注"
        autosize
        minRows={2}
        maxRows={4}
        placeholder="补充整体风格、镜头节奏、素材要求，或写下 Sora 需要遵循的额外说明。"
        value={notes}
        onChange={(e) => onNotesChange(e.currentTarget.value)}
      />
      <Group justify="space-between">
        <Text size="xs" c="dimmed">
          当前共 {scenes.length} 个镜头。You're using {scenes.length} video gens with current settings.
        </Text>
        <Text
          size="xs"
          c={totalDuration > STORYBOARD_MAX_TOTAL_DURATION ? 'red.4' : 'dimmed'}
        >
          总时长 {totalDuration.toFixed(1)}s / {STORYBOARD_MAX_TOTAL_DURATION}s
        </Text>
      </Group>
    </Stack>
  )
}
