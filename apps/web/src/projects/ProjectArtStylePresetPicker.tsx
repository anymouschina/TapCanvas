import React from 'react'
import { Badge, Box, Button, Group, SimpleGrid, Stack, Text } from '@mantine/core'
import { PROJECT_ART_STYLE_PRESETS, getArtStylePresetById } from './projectPresetLibrary'
import { PanelCard } from '../ui/PanelCard'

type ProjectArtStylePresetPickerProps = {
  value?: string
  onChange: (value?: string) => void
  description?: string
}

const PRESET_COVER_MAP: Record<string, {
  background: string
  accent: string
  caption: string
}> = {
  'toonflow-2d-chinese-guofeng': {
    background: 'linear-gradient(135deg, #0f3b36 0%, #2f7f74 42%, #efe2b8 100%)',
    accent: '#f4d27a',
    caption: '青绿山水 / 留白云雾',
  },
  'toonflow-2d-flat-design': {
    background: 'linear-gradient(135deg, #ff7a18 0%, #ffd166 48%, #fff2cc 100%)',
    accent: '#a83d00',
    caption: '高纯色块 / 清晰轮廓',
  },
  'toonflow-2d-90s-japanese-anime': {
    background: 'linear-gradient(135deg, #102a71 0%, #ff4f5e 58%, #ffd166 100%)',
    accent: '#fff2cf',
    caption: '高反差 / 热血赛璐璐',
  },
  'toonflow-2d-mature-urban-romance': {
    background: 'linear-gradient(135deg, #42253d 0%, #d57a66 58%, #f7d9cf 100%)',
    accent: '#fff4eb',
    caption: '都市夜色 / 克制情绪',
  },
  'toonflow-realpeople-urban-modern': {
    background: 'linear-gradient(135deg, #1b232c 0%, #75808c 45%, #d9dfe5 100%)',
    accent: '#ffffff',
    caption: '真实空间 / 现代服化道',
  },
  'toonflow-3d-anime-render': {
    background: 'linear-gradient(135deg, #18284a 0%, #45b7d1 42%, #e8fbff 100%)',
    accent: '#f5feff',
    caption: '3D资产 / 稳定复用',
  },
}

export default function ProjectArtStylePresetPicker({
  value,
  onChange,
  description,
}: ProjectArtStylePresetPickerProps): JSX.Element {
  const selected = getArtStylePresetById(value)

  return (
    <Stack gap="xs">
      <Group justify="space-between" align="flex-end" gap="md">
        <Box style={{ flex: 1, minWidth: 220 }}>
          <Text size="sm" fw={600}>画风选择</Text>
          <Text size="xs" c="dimmed" mt={4}>
            {description || '优先用视觉卡片选风格，文字只作为补充说明。'}
          </Text>
        </Box>
        {selected ? (
          <Button size="xs" variant="subtle" onClick={() => onChange(undefined)}>
            清除选择
          </Button>
        ) : null}
      </Group>
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm">
        {PROJECT_ART_STYLE_PRESETS.map((preset) => {
          const cover = PRESET_COVER_MAP[preset.id] || {
            background: 'linear-gradient(135deg, #243b53 0%, #486581 45%, #d9e2ec 100%)',
            accent: '#ffffff',
            caption: preset.tags.join(' / '),
          }
          const active = preset.id === value
          return (
            <PanelCard
              key={preset.id}
              padding="compact"
              style={{
                cursor: 'pointer',
                borderColor: active ? 'var(--mantine-color-blue-5)' : undefined,
                boxShadow: active ? '0 0 0 1px rgba(59, 130, 246, 0.18)' : undefined,
              }}
              onClick={() => onChange(preset.id)}
            >
              <Stack gap="xs">
                <Box
                  style={{
                    minHeight: 128,
                    borderRadius: 0,
                    padding: 14,
                    background: cover.background,
                    color: cover.accent,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    position: 'relative',
                    overflow: 'hidden',
                  }}
                >
                  <Text size="xs" fw={700} style={{ letterSpacing: 1.2, opacity: 0.9 }}>
                    STYLE LOOK
                  </Text>
                  <Box>
                    <Text size="lg" fw={800} style={{ lineHeight: 1.2 }}>
                      {preset.name}
                    </Text>
                    <Text size="xs" mt={6} style={{ opacity: 0.88 }}>
                      {cover.caption}
                    </Text>
                  </Box>
                </Box>
                <Group justify="space-between" align="flex-start" gap="xs">
                  <Box style={{ flex: 1, minWidth: 0 }}>
                    <Text size="sm" fw={700}>{preset.name}</Text>
                    <Text size="xs" c="dimmed" mt={4} lineClamp={2}>{preset.summary}</Text>
                  </Box>
                  <Badge variant={active ? 'filled' : 'light'} color={active ? 'blue' : 'gray'}>
                    {active ? '已选' : '选择'}
                  </Badge>
                </Group>
                <Group gap={6}>
                  {preset.tags.slice(0, 3).map((tag) => (
                    <Badge key={tag} size="xs" variant="outline">{tag}</Badge>
                  ))}
                </Group>
              </Stack>
            </PanelCard>
          )
        })}
      </SimpleGrid>
      {selected ? (
        <PanelCard padding="compact" bg="rgba(59, 130, 246, 0.05)">
          <Text size="sm" fw={700}>{selected.name}</Text>
          <Text size="xs" c="dimmed" mt={4}>{selected.summary}</Text>
          <Text size="xs" mt={8}>{selected.tags.join(' · ')}</Text>
        </PanelCard>
      ) : null}
    </Stack>
  )
}
