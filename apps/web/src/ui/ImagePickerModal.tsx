import React from 'react'
import { Modal, TextInput, SimpleGrid, Box, Text, Overlay, Skeleton } from '@mantine/core'
import { IconSearch } from '@tabler/icons-react'
import { useStylePresets } from '../hooks/useStylePresets'
import type { LlmNodePresetDto } from '../api/server'
import { ManagedImage } from '../domain/resource-runtime'


export interface ImagePickerModalProps {
  opened: boolean
  onClose: () => void
  onSelect: (url: string, title: string) => void
  title?: string
}

export function ImagePickerModal({ opened, onClose, onSelect, title = '从素材库选择参考图' }: ImagePickerModalProps) {
  // 只在真正打开时拉素材库：该 Modal 常驻挂载于每个 TaskNode，关着也拉会白发请求（未登录还 401）
  const { basePresets, loading } = useStylePresets(opened)
  const [query, setQuery] = React.useState('')

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return basePresets.filter((p) => Boolean(p.referenceImageUrl))
    return basePresets.filter(
      (p) =>
        Boolean(p.referenceImageUrl) &&
        (p.title.toLowerCase().includes(q) || (p.description ?? '').toLowerCase().includes(q)),
    )
  }, [basePresets, query])

  const handleSelect = React.useCallback(
    (preset: LlmNodePresetDto) => {
      const url = preset.referenceImageUrl
      if (!url) return
      onSelect(url, preset.title)
      onClose()
    },
    [onClose, onSelect],
  )

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={title}
      size="xl"
      styles={{ body: { height: '70vh', display: 'flex', flexDirection: 'column', gap: 12, overflow: 'hidden' } }}
    >
      <TextInput
        leftSection={<IconSearch size={14} />}
        placeholder="搜索画风名称…"
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
        size="sm"
      />
      <Box style={{ flex: 1, overflowY: 'auto' }}>
        <SimpleGrid cols={4} spacing="sm">
          {loading
            ? Array.from({ length: 8 }, (_, i) => <PickerSkeletonCard key={i} />)
            : filtered.map((preset) => <PickerPresetCard key={preset.id} preset={preset} onSelect={handleSelect} />)}
        </SimpleGrid>
      </Box>
    </Modal>
  )
}

function PickerSkeletonCard() {
  return (
    <Box style={{ borderRadius: 8, overflow: 'hidden', aspectRatio: '1 / 1' }}>
      <Skeleton height="100%" radius={8} />
    </Box>
  )
}

function PickerPresetCard({
  preset,
  onSelect,
}: {
  preset: LlmNodePresetDto
  onSelect: (p: LlmNodePresetDto) => void
}) {
  const [hovered, setHovered] = React.useState(false)
  const [loaded, setLoaded] = React.useState(false)

  return (
    <Box
      style={{
        position: 'relative',
        borderRadius: 8,
        overflow: 'hidden',
        aspectRatio: '1 / 1',
        cursor: 'pointer',
        border: hovered ? '2px solid var(--mantine-color-blue-5)' : '2px solid transparent',
        background: '#1b1b1f',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onSelect(preset)}
    >
      {!loaded && <Skeleton style={{ position: 'absolute', inset: 0 }} radius={0} />}
      <ManagedImage
        className=""
        src={preset.referenceImageUrl ?? ''}
        alt={preset.title}
        priority="visible"
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', opacity: loaded ? 1 : 0 }}
        onLoad={() => setLoaded(true)}
      />
      {hovered && <Overlay color="#000" backgroundOpacity={0.4} zIndex={1} />}
      <Box
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          padding: '4px 6px',
          background: 'rgba(0,0,0,0.6)',
          zIndex: 2,
        }}
      >
        <Text size="xs" c="white" lineClamp={1}>
          {preset.title}
        </Text>
      </Box>
    </Box>
  )
}
