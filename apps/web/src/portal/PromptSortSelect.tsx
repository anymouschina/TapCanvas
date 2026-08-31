import { Select } from '@mantine/core'
import type { PromptLibrarySort } from '../api/promptLibrary'

type PromptSortSelectProps = Readonly<{
  value: PromptLibrarySort
  onChange: (value: PromptLibrarySort) => void
  onOpenChange?: (open: boolean) => void
}>

const SORT_OPTIONS: ReadonlyArray<{ value: PromptLibrarySort; label: string }> = [
  { value: 'likes_desc', label: '点赞最多' },
  { value: 'name_asc', label: '名称首字母' },
  { value: 'time_asc', label: '时间正序' },
  { value: 'time_desc', label: '时间倒序' },
]

function isPromptLibrarySort(value: string | null): value is PromptLibrarySort {
  return SORT_OPTIONS.some((option) => option.value === value)
}

export function PromptSortSelect(props: PromptSortSelectProps): JSX.Element {
  return (
    <Select
      className="prompt-sort-select"
      classNames={{
        input: 'prompt-sort-select__input',
        dropdown: 'prompt-sort-select__dropdown',
        options: 'prompt-sort-select__options',
        option: 'prompt-sort-select__option',
      }}
      aria-label="排序方式"
      data={SORT_OPTIONS}
      value={props.value}
      onChange={(value) => {
        if (isPromptLibrarySort(value)) props.onChange(value)
      }}
      onDropdownOpen={() => props.onOpenChange?.(true)}
      onDropdownClose={() => props.onOpenChange?.(false)}
      allowDeselect={false}
      withCheckIcon={false}
      comboboxProps={{ withinPortal: true, zIndex: 1200 }}
      size="xs"
    />
  )
}
