import React from 'react'
import { Badge, Box, Group, Skeleton, Stack, Text } from '@mantine/core'
import { IconCheck } from '@tabler/icons-react'
import { ManagedImage } from '../../domain/resource-runtime/components/ManagedImage'
import type { LlmNodePresetDto } from '../../api/server'
import { getPrimaryStyleReferenceCategoryLabel } from '../styleReferenceFacets'

// 风格库单卡：封面图 + 来源/分类徽标 + 标题；selected 时紫框高亮（对标 mockup）。
export function StyleRefCard({
  preset,
  selected,
  onSelect,
}: {
  preset: LlmNodePresetDto
  selected: boolean
  onSelect: (p: LlmNodePresetDto) => void
}) {
  const [loaded, setLoaded] = React.useState(false)
  return (
    <Stack
      className="style-library-card"
      gap={4}
      style={{ cursor: 'pointer' }}
      onClick={() => { void onSelect(preset) }}
    >
      <Box
        className="style-library-card-preview"
        style={{
          position: 'relative',
          height: 112,
          borderRadius: 8,
          overflow: 'hidden',
          border: selected ? '2px solid var(--mantine-color-violet-5)' : '1px solid var(--mantine-color-gray-3)',
          boxShadow: selected ? '0 0 0 2px var(--mantine-color-violet-2)' : 'none',
        }}
      >
        {!loaded && <Skeleton style={{ position: 'absolute', inset: 0 }} radius={0} />}
        <ManagedImage
          className="style-library-card-image"
          src={preset.referenceImageUrl ?? ''}
          alt={preset.title}
          priority="visible"
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', opacity: loaded ? 1 : 0 }}
          onLoad={() => setLoaded(true)}
        />
        {selected ? (
          <div
            className="style-library-card-check"
            style={{
              position: 'absolute',
              top: 6,
              right: 6,
              width: 22,
              height: 22,
              borderRadius: '50%',
              background: 'var(--mantine-color-violet-6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <IconCheck size={14} color="white" stroke={3} />
          </div>
        ) : null}
      </Box>
      <Group className="style-library-card-meta" gap={4} wrap="nowrap">
        <Badge size="xs" variant="light" color={preset.scope === 'user' ? 'yellow' : 'blue'}>
          {preset.scope === 'user' ? '收藏' : '官方'}
        </Badge>
        <Badge size="xs" variant="outline">
          {getPrimaryStyleReferenceCategoryLabel(preset)}
        </Badge>
      </Group>
      <Text className="style-library-card-title" size="xs" lineClamp={1} c={selected ? 'violet' : 'dimmed'}>
        {preset.title}
      </Text>
    </Stack>
  )
}
