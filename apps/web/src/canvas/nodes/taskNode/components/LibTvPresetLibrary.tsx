import React from 'react'
import { Popover } from '@mantine/core'
import { IconCategoryPlus, IconChevronRight } from '@tabler/icons-react'
import {
  LIBTV_IMAGE_PRESET_GROUPS,
  type LibTvImagePreset,
} from '../libTvImagePresets'

type LibTvPresetLibraryProps = Readonly<{
  disabled?: boolean
  characterFissionEnabled?: boolean
  onSelect: (preset: LibTvImagePreset) => void
}>

export function LibTvPresetLibrary({
  disabled = false,
  characterFissionEnabled = false,
  onSelect,
}: LibTvPresetLibraryProps): JSX.Element {
  const [opened, setOpened] = React.useState(false)

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="top-start"
      offset={10}
      withinPortal
      shadow="xl"
      closeOnClickOutside={false}
      closeOnEscape
      styles={{ dropdown: { padding: 0, border: 0, background: 'transparent' } }}
    >
      <Popover.Target>
        <button
          className="tc-libtv-presets__trigger nodrag nopan"
          type="button"
          aria-label="预设"
          aria-expanded={opened}
          disabled={disabled}
          onClick={(event) => {
            event.stopPropagation()
            setOpened((current) => !current)
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <IconCategoryPlus className="tc-libtv-presets__trigger-icon" size={16} />
          <span className="tc-libtv-presets__trigger-dot" aria-hidden="true" />
        </button>
      </Popover.Target>
      <Popover.Dropdown>
        <section
          className="tc-libtv-presets__panel nodrag nopan"
          aria-label="图片预设能力"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="tc-libtv-presets__groups">
            {LIBTV_IMAGE_PRESET_GROUPS.map((group) => (
              <section className="tc-libtv-presets__group" key={group.key} aria-labelledby={`libtv-preset-group-${group.key}`}>
                <h4 className="tc-libtv-presets__group-title" id={`libtv-preset-group-${group.key}`}>
                  {group.label}
                </h4>
                <div className="tc-libtv-presets__items">
                  {group.presets
                    .filter((preset) => preset.execution !== 'character-fission' || characterFissionEnabled)
                    .map((preset) => (
                    <button
                      className="tc-libtv-presets__item"
                      type="button"
                      key={preset.key}
                      onClick={() => {
                        setOpened(false)
                        onSelect(preset)
                      }}
                    >
                      <span className="tc-libtv-presets__item-copy">
                        <span className="tc-libtv-presets__item-label">{preset.label}</span>
                        <span className="tc-libtv-presets__item-description">{preset.description}</span>
                      </span>
                      <IconChevronRight className="tc-libtv-presets__item-icon" size={15} />
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </section>
      </Popover.Dropdown>
    </Popover>
  )
}
