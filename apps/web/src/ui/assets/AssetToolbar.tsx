import React from 'react'
import {
  Group,
  TextInput,
  SegmentedControl,
  Select,
  ActionIcon,
  Tooltip,
  Button,
  Divider,
} from '@mantine/core'
import {
  IconSearch,
  IconLayoutGrid,
  IconList,
  IconX,
  IconTrash,
  IconPencil,
  IconCopy,
} from '@tabler/icons-react'

export type AssetViewMode = 'grid' | 'list'
export type AssetDensity = 'comfortable' | 'compact'

export type AssetSort = 'updated_desc' | 'created_desc' | 'name_asc'

export default function AssetToolbar(props: {
  className?: string
  query: string
  onQueryChange: (v: string) => void
  sort: AssetSort
  onSortChange: (v: AssetSort) => void
  viewMode: AssetViewMode
  onViewModeChange: (v: AssetViewMode) => void
  density: AssetDensity
  onDensityChange: (v: AssetDensity) => void
  selectionCount: number
  canRenameSingle: boolean
  onClearFilters: () => void
  onSelectAllPage: () => void
  onBatchDelete: () => void
  onRenameSingle: () => void
  onCopyLinks: () => void
}): JSX.Element {
  const {
    className,
    query,
    onQueryChange,
    sort,
    onSortChange,
    viewMode,
    onViewModeChange,
    density,
    onDensityChange,
    selectionCount,
    canRenameSingle,
    onClearFilters,
    onSelectAllPage,
    onBatchDelete,
    onRenameSingle,
    onCopyLinks,
  } = props

  return (
    <Group className={className} justify="space-between" gap="sm" wrap="wrap">
      <Group className="asset-panel-toolbar-left" gap="sm" wrap="wrap">
        <TextInput
          className="asset-panel-toolbar-search"
          value={query}
          onChange={(e) => onQueryChange(e.currentTarget.value)}
          placeholder="搜索资产：名称 / prompt / tag"
          leftSection={<IconSearch size={16} />}
          rightSection={
            query ? (
              <Tooltip label="清空搜索" withArrow>
                <ActionIcon
                  className="asset-panel-toolbar-clear-search"
                  size="sm"
                  variant="subtle"
                  onClick={() => onQueryChange('')}
                >
                  <IconX size={16} />
                </ActionIcon>
              </Tooltip>
            ) : null
          }
          styles={{ input: { width: 260 } }}
        />

        <Select
          className="asset-panel-toolbar-sort"
          value={sort}
          onChange={(v) => onSortChange((v as AssetSort) || 'updated_desc')}
          data={[
            { value: 'updated_desc', label: '按更新时间' },
            { value: 'created_desc', label: '按创建时间' },
            { value: 'name_asc', label: '按名称 A-Z' },
          ]}
          allowDeselect={false}
          styles={{ input: { width: 160 } }}
        />

        <SegmentedControl
          className="asset-panel-toolbar-view"
          value={viewMode}
          onChange={(v) => onViewModeChange((v as AssetViewMode) || 'grid')}
          data={[
            {
              value: 'grid',
              label: (
                <Group className="asset-panel-toolbar-view-grid" gap={6} wrap="nowrap">
                  <IconLayoutGrid size={16} />
                </Group>
              ),
            },
            {
              value: 'list',
              label: (
                <Group className="asset-panel-toolbar-view-list" gap={6} wrap="nowrap">
                  <IconList size={16} />
                </Group>
              ),
            },
          ]}
          size="xs"
        />

        <SegmentedControl
          className="asset-panel-toolbar-density"
          value={density}
          onChange={(v) => onDensityChange((v as AssetDensity) || 'comfortable')}
          data={[
            { value: 'comfortable', label: '舒展' },
            { value: 'compact', label: '紧凑' },
          ]}
          size="xs"
        />

        <Divider className="asset-panel-toolbar-divider" orientation="vertical" />

        <Button
          className="asset-panel-toolbar-clear"
          size="xs"
          variant="subtle"
          onClick={onClearFilters}
          leftSection={<IconX size={14} />}
        >
          清空筛选
        </Button>
      </Group>

      <Group className="asset-panel-toolbar-right" gap="xs" wrap="wrap">
        {selectionCount > 0 ? (
          <>
            <Button
              className="asset-panel-toolbar-select-all"
              size="xs"
              variant="light"
              onClick={onSelectAllPage}
            >
              全选当前页
            </Button>
            <Tooltip label="复制选中项链接" withArrow>
              <ActionIcon
                className="asset-panel-toolbar-copy"
                size="sm"
                variant="light"
                onClick={onCopyLinks}
              >
                <IconCopy size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label={canRenameSingle ? '重命名（仅单选）' : '重命名仅支持单选'} withArrow>
              <ActionIcon
                className="asset-panel-toolbar-rename"
                size="sm"
                variant="light"
                disabled={!canRenameSingle}
                onClick={onRenameSingle}
              >
                <IconPencil size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="删除选中" withArrow>
              <ActionIcon
                className="asset-panel-toolbar-delete"
                size="sm"
                color="red"
                variant="light"
                onClick={onBatchDelete}
              >
                <IconTrash size={16} />
              </ActionIcon>
            </Tooltip>
          </>
        ) : null}
      </Group>
    </Group>
  )
}
