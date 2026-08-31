import React from 'react'
import { Select } from '@mantine/core'
import { IconCheck } from '@tabler/icons-react'

export type PromptModelSelectOption = Readonly<{
  slug: string
  name: string
  count: number
}>

type PromptModelSelectProps = Readonly<{
  value: string
  options: readonly PromptModelSelectOption[]
  allCount: number
  onChange: (value: string) => void
  onOpenChange?: (open: boolean) => void
}>

type PromptModelOptionMetadata = Readonly<{
  name: string
  count: number
}>

const ALL_MODELS_VALUE = '__tapcanvas_all_prompt_models__'

export function PromptModelSelect(props: PromptModelSelectProps): JSX.Element {
  const metadata = React.useMemo(() => {
    const entries = new Map<string, PromptModelOptionMetadata>()
    entries.set(ALL_MODELS_VALUE, { name: '全部模型', count: props.allCount })
    for (const option of props.options) entries.set(option.slug, { name: option.name, count: option.count })
    return entries
  }, [props.allCount, props.options])
  const data = React.useMemo(
    () => Array.from(metadata.entries()).map(([value, option]) => ({
      value,
      label: `${option.name} · ${option.count.toLocaleString('zh-CN')} 条`,
    })),
    [metadata],
  )

  return (
    <Select
      className="prompt-model-select"
      classNames={{
        input: 'prompt-model-select__input',
        dropdown: 'prompt-model-select__dropdown',
        options: 'prompt-model-select__options',
        option: 'prompt-model-select__option',
        empty: 'prompt-model-select__empty',
      }}
      aria-label="模型筛选"
      data={data}
      value={props.value || ALL_MODELS_VALUE}
      onChange={(nextValue) => props.onChange(nextValue === ALL_MODELS_VALUE ? '' : nextValue ?? '')}
      onDropdownOpen={() => props.onOpenChange?.(true)}
      onDropdownClose={() => props.onOpenChange?.(false)}
      renderOption={({ option, checked }) => {
        const optionMetadata = metadata.get(option.value)
        return (
          <div className="prompt-model-select__option-content">
            <span className="prompt-model-select__option-name">{optionMetadata?.name ?? option.label}</span>
            <span className="prompt-model-select__option-count">{optionMetadata?.count.toLocaleString('zh-CN') ?? '0'} 条</span>
            {checked ? <IconCheck className="prompt-model-select__check" size={14} aria-hidden="true" /> : <span className="prompt-model-select__check-space" aria-hidden="true" />}
          </div>
        )
      }}
      searchable
      nothingFoundMessage="没有匹配模型"
      allowDeselect={false}
      withCheckIcon={false}
      maxDropdownHeight={280}
      comboboxProps={{ withinPortal: true, zIndex: 1200 }}
      size="xs"
    />
  )
}
