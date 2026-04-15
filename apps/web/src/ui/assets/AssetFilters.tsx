import React from 'react'
import {
  Accordion,
  Group,
  Select,
  SegmentedControl,
  TextInput,
  Button,
} from '@mantine/core'
import { IconAdjustments, IconUpload } from '@tabler/icons-react'

export type MaterialCategory = 'roleCards' | 'docs' | 'all'

export default function AssetFilters(props: {
  className?: string
  currentProjectLabel: string
  isUploadLocked: boolean
  uploading: boolean
  onUploadText: () => void
  storyboardOutputAspectRatio: string
  onStoryboardOutputAspectRatioChange: (v: string) => void
  materialChapterFilter: string
  materialChapterOptions: Array<{ value: string; label: string }>
  onMaterialChapterFilterChange: (v: string) => void
  materialCategory: MaterialCategory
  onMaterialCategoryChange: (v: MaterialCategory) => void
  roleCardKeyword: string
  onRoleCardKeywordChange: (v: string) => void
  books: Array<{ value: string; label: string }>
  selectedBookId: string
  onSelectedBookIdChange: (v: string) => void
  chapters: Array<{ value: string; label: string }>
  selectedBookChapter: string
  onSelectedBookChapterChange: (v: string) => void
  disableBookChapter: boolean
}): JSX.Element {
  const {
    className,
    currentProjectLabel,
    isUploadLocked,
    uploading,
    onUploadText,
    storyboardOutputAspectRatio,
    onStoryboardOutputAspectRatioChange,
    materialChapterFilter,
    materialChapterOptions,
    onMaterialChapterFilterChange,
    materialCategory,
    onMaterialCategoryChange,
    roleCardKeyword,
    onRoleCardKeywordChange,
    books,
    selectedBookId,
    onSelectedBookIdChange,
    chapters,
    selectedBookChapter,
    onSelectedBookChapterChange,
    disableBookChapter,
  } = props

  return (
    <div className={className}>
      <Accordion className="asset-panel-filters-accordion" variant="contained" radius="md">
        <Accordion.Item className="asset-panel-filters-item" value="filters">
          <Accordion.Control
            className="asset-panel-filters-control"
            icon={<IconAdjustments size={16} />}
          >
            {currentProjectLabel}
          </Accordion.Control>
          <Accordion.Panel className="asset-panel-filters-panel">
            <Group className="asset-panel-filters-actions" gap="xs" wrap="wrap">
              <Button
                className="asset-panel-filters-upload-text"
                size="xs"
                variant="light"
                leftSection={<IconUpload size={14} />}
                loading={uploading}
                disabled={uploading || isUploadLocked}
                onClick={onUploadText}
              >
                上传文本
              </Button>

              <Select
                className="asset-panel-filters-aspect"
                value={storyboardOutputAspectRatio}
                onChange={(v) => onStoryboardOutputAspectRatioChange(v || '16:9')}
                data={[
                  { value: '16:9', label: '输出画幅 16:9' },
                  { value: '9:16', label: '输出画幅 9:16' },
                  { value: '4:3', label: '输出画幅 4:3' },
                  { value: '3:4', label: '输出画幅 3:4' },
                  { value: '1:1', label: '输出画幅 1:1' },
                ]}
                allowDeselect={false}
                styles={{ input: { width: 160 } }}
              />

              <Select
                className="asset-panel-filters-chapter"
                value={materialChapterFilter}
                onChange={(v) => onMaterialChapterFilterChange(v || 'all')}
                data={materialChapterOptions}
                allowDeselect={false}
                searchable
                styles={{ input: { width: 160 } }}
              />

              <SegmentedControl
                className="asset-panel-filters-category"
                size="xs"
                value={materialCategory}
                onChange={(v) => onMaterialCategoryChange((v as MaterialCategory) || 'roleCards')}
                data={[
                  { value: 'roleCards', label: '角色卡' },
                  { value: 'docs', label: '文档素材' },
                  { value: 'all', label: '全部' },
                ]}
              />

              <TextInput
                className="asset-panel-filters-role-search"
                value={roleCardKeyword}
                onChange={(e) => onRoleCardKeywordChange(e.currentTarget.value)}
                placeholder="筛选角色卡：角色名"
                styles={{ input: { width: 200 } }}
              />
            </Group>

            <Group className="asset-panel-filters-book" gap="xs" wrap="wrap" mt="sm">
              <Select
                className="asset-panel-filters-book-select"
                value={selectedBookId}
                onChange={(v) => onSelectedBookIdChange(v || '')}
                data={[{ value: '', label: '选择小说' }, ...books]}
                searchable
                styles={{ input: { width: 240 } }}
              />
              <Select
                className="asset-panel-filters-book-chapter"
                value={selectedBookChapter}
                onChange={(v) => onSelectedBookChapterChange(v || '1')}
                data={chapters}
                disabled={disableBookChapter}
                styles={{ input: { width: 160 } }}
              />
            </Group>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </div>
  )
}
