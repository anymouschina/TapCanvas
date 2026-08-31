import React from 'react'
import { Loader, Select } from '@mantine/core'

export type PromptGenerationSelectOption = Readonly<{
  value: string
  label: string
}>

type PromptGenerationSelectProps = Readonly<{
  label: string
  value: string
  options: readonly PromptGenerationSelectOption[]
  placeholder: string
  disabled: boolean
  onChange: (value: string) => void
  loading?: boolean
  searchable?: boolean
  nothingFoundMessage?: string
  primary?: boolean
}>

export function PromptGenerationSelect(props: PromptGenerationSelectProps): JSX.Element {
  const data = React.useMemo(
    () => props.options.map((option) => ({ value: option.value, label: option.label })),
    [props.options],
  )

  return (
    <Select
      className={`prompt-generation-panel__control${props.primary ? ' prompt-generation-panel__control--primary' : ''}`}
      classNames={{
        label: 'prompt-generation-panel__field-label',
        input: 'prompt-generation-panel__select-input',
        dropdown: 'prompt-generation-panel__select-dropdown',
        options: 'prompt-generation-panel__select-options',
        option: 'prompt-generation-panel__select-option',
        empty: 'prompt-generation-panel__select-empty',
      }}
      label={props.label}
      aria-label={props.label}
      data={data}
      value={props.value || null}
      onChange={(value) => props.onChange(value ?? '')}
      placeholder={props.placeholder}
      disabled={props.disabled}
      searchable={props.searchable}
      nothingFoundMessage={props.nothingFoundMessage}
      allowDeselect={false}
      rightSection={props.loading ? <Loader className="prompt-generation-panel__select-loader" size={13} /> : undefined}
      comboboxProps={{ withinPortal: true, zIndex: 1200 }}
      checkIconPosition="right"
      size="sm"
    />
  )
}
