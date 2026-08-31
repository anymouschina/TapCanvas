import React from 'react'
import { ActionIcon, Box, Button, Center, Group, SegmentedControl, Stack, Text, TextInput, Textarea, Tooltip } from '@mantine/core'
import { IconSearch, IconSparkles, IconBan, IconCheck, IconX } from '@tabler/icons-react'
import type { LlmNodePresetDto } from '../../api/server'
import { useStylePresets } from '../../hooks/useStylePresets'
import { StyleRefGrid } from './StyleRefGrid'
import { StyleMaterialLibraryTab, MATERIAL_STYLE_ID_PREFIX } from './StyleMaterialLibraryTab'
import {
  COARSE_STYLE_CATEGORY_OPTIONS,
  filterStyleLibraryPresets,
  resolveCoarseStyleCategories,
  type CoarseStyleCategory,
} from './coarseCategory'
import type { LockedStyle } from '../../canvas/projectImageSettingsStore'

// 风格库面板：两个来源页——「风格预设」(全部/真人/2D/3D + 搜索 + 自定义提示词卡 + 预设网格)
// 与「素材库」(个人/团队素材点选即锁定)。单选锁定：点预设/自定义/素材即 onPick，点「无风格」onClear。
// selectedStyleId 高亮当前锁定（素材来源的 id 带 material: 前缀）。
export function StyleLibraryPanel({
  selectedStyleId,
  onPickPreset,
  onPickCustom,
  onClear,
  scopeLabel = '全局',
  initialCustomText = '',
  onClose,
}: {
  selectedStyleId: string | null
  onPickPreset: (lock: LockedStyle) => void
  onPickCustom: (stylePrompt: string) => void
  onClear: () => void
  scopeLabel?: string
  initialCustomText?: string
  onClose?: () => void
}) {
  const { basePresets, userPresets, loading } = useStylePresets()
  // 当前锁定来自素材库时默认落在素材库页，方便定位。
  const [source, setSource] = React.useState<'presets' | 'materials'>(
    selectedStyleId?.startsWith(MATERIAL_STYLE_ID_PREFIX) ? 'materials' : 'presets',
  )
  const [category, setCategory] = React.useState<CoarseStyleCategory>('all')
  const [query, setQuery] = React.useState('')
  const [customOpen, setCustomOpen] = React.useState(selectedStyleId === 'custom')
  const [customText, setCustomText] = React.useState(initialCustomText)

  React.useEffect(() => {
    setCustomText(initialCustomText)
  }, [initialCustomText, selectedStyleId])

  const presets = React.useMemo(
    () => [...basePresets, ...userPresets].filter((p) => Boolean(p.referenceImageUrl)),
    [basePresets, userPresets],
  )
  const visible = React.useMemo(
    () => filterStyleLibraryPresets({ presets, category, query }),
    [presets, category, query],
  )

  const handlePickPreset = (preset: LlmNodePresetDto) => {
    const url = preset.referenceImageUrl?.trim() || ''
    if (!url) return
    onPickPreset({
      styleId: preset.id,
      styleName: preset.title,
      referenceImageUrl: url,
      // 预设以封面图为风格锚（图为主），不强行注入预设文字，避免改变既有出图行为。
      stylePrompt: '',
      category: resolveCoarseStyleCategories(preset)[0] || 'all',
    })
  }

  return (
    <Stack className="style-library-panel" gap="sm" style={{ width: '100%', maxWidth: '100%' }}>
      <Group className="style-library-panel-heading" justify="space-between" align="center">
        <Group className="style-library-panel-heading-main" gap={10} align="center">
          <Text className="style-library-panel-title" fw={600} size="sm">风格库</Text>
          <SegmentedControl
            className="style-library-panel-source"
            size="xs"
            data={[{ value: 'presets', label: '风格预设' }, { value: 'materials', label: '素材库' }]}
            value={source}
            onChange={(v) => setSource(v as 'presets' | 'materials')}
          />
        </Group>
        <Group className="style-library-panel-heading-actions" gap={4} wrap="nowrap">
          <Button
            className="style-library-panel-clear"
            size="compact-xs"
            variant="subtle"
            color="gray"
            leftSection={<IconBan size={14} />}
            onClick={() => { setCustomOpen(false); onClear() }}
            disabled={!selectedStyleId}
          >
            {scopeLabel === '全局' ? '无风格' : `清除${scopeLabel}风格`}
          </Button>
          {onClose ? (
            <Tooltip className="style-library-panel-close-tooltip" label="关闭" withArrow>
              <ActionIcon
                className="style-library-panel-close"
                size="sm"
                variant="subtle"
                color="gray"
                onClick={onClose}
                aria-label="关闭风格库"
              >
                <IconX className="style-library-panel-close-icon" size={15} />
              </ActionIcon>
            </Tooltip>
          ) : null}
        </Group>
      </Group>

      {source === 'materials' ? (
        <StyleMaterialLibraryTab selectedStyleId={selectedStyleId} onPick={onPickPreset} />
      ) : (
      <>
      <Group className="style-library-panel-tabs" gap={6} wrap="wrap">
        {COARSE_STYLE_CATEGORY_OPTIONS.map((option) => (
          <Button
            key={option.key}
            size="compact-sm"
            radius="xl"
            variant={category === option.key ? 'filled' : 'default'}
            color={category === option.key ? 'dark' : 'gray'}
            onClick={() => setCategory(option.key)}
          >
            {option.label}
          </Button>
        ))}
        <TextInput
          className="style-library-panel-search"
          leftSection={<IconSearch size={14} />}
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          placeholder="搜索风格"
          size="xs"
          style={{ flex: '1 1 160px', minWidth: 120 }}
        />
      </Group>

      {/* 自定义风格提示词卡：纯文字风格，无参考图。 */}
      <Box
        className="style-library-custom-card"
        style={{
          border: selectedStyleId === 'custom'
            ? '2px solid var(--mantine-color-violet-5)'
            : '1px dashed var(--mantine-color-gray-4)',
          borderRadius: 8,
          padding: customOpen ? 12 : '10px 12px',
        }}
      >
        {!customOpen ? (
          <Group
            justify="space-between"
            style={{ cursor: 'pointer' }}
            onClick={() => setCustomOpen(true)}
          >
            <Group gap={8}>
              <IconSparkles size={16} />
              <Text size="sm">自定义风格提示词</Text>
            </Group>
            {selectedStyleId === 'custom' ? <IconCheck size={16} color="var(--mantine-color-violet-6)" /> : null}
          </Group>
        ) : (
          <Stack gap={8}>
            <Group gap={8}>
              <IconSparkles size={16} />
              <Text size="sm" fw={500}>自定义风格提示词</Text>
            </Group>
            <Textarea
              value={customText}
              onChange={(e) => setCustomText(e.currentTarget.value)}
              placeholder={`用文字描述${scopeLabel}画风，如：低饱和胶片质感、柔和侧光、颗粒感、复古色调`}
              autosize
              minRows={2}
              maxRows={5}
            />
            <Group justify="flex-end" gap={8}>
              <Button size="compact-sm" variant="subtle" color="gray" onClick={() => setCustomOpen(false)}>
                取消
              </Button>
              <Button
                size="compact-sm"
                disabled={!customText.trim()}
                onClick={() => onPickCustom(customText.trim())}
              >
                锁定为{scopeLabel}风格
              </Button>
            </Group>
          </Stack>
        )}
      </Box>

      {loading ? (
        <Center h={200}><Text size="sm" c="dimmed">加载风格库…</Text></Center>
      ) : visible.length === 0 ? (
        <Center h={200}><Text size="sm" c="dimmed">没有匹配的风格</Text></Center>
      ) : (
        <StyleRefGrid assets={visible} selectedId={selectedStyleId} onSelect={handlePickPreset} cols={4} />
      )}
      </>
      )}
    </Stack>
  )
}
