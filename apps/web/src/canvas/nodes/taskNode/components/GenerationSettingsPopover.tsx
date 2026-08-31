import React from 'react'
import { createPortal } from 'react-dom'
import { IconChevronUp } from '@tabler/icons-react'
import './GenerationSettingsPopover.css'

export type GenerationSettingOption = {
  value: string
  label: string
  disabled?: boolean
}

export type GenerationSettingSection = {
  key: string
  label: string
  value: string
  options: ReadonlyArray<GenerationSettingOption>
  layout?: 'aspect' | 'segmented'
  onChange: (value: string) => void
}

export type GenerationDurationSetting = {
  value: number
  options: ReadonlyArray<{ value: string; label: string }>
  onChange: (value: number) => void
}

export type GenerationQuantitySetting = {
  value: number
  options: ReadonlyArray<number>
  unit: '个' | '张'
  onChange: (value: number) => void
}

export type GenerationAudioSetting = {
  value: boolean
  onChange: (value: boolean) => void
}

export type GenerationSettingsPopoverProps = {
  kind: 'image' | 'video'
  summary: string
  aspectValue: string
  sections: ReadonlyArray<GenerationSettingSection>
  duration?: GenerationDurationSetting | null
  audio?: GenerationAudioSetting | null
  quantity: GenerationQuantitySetting
  disabled?: boolean
}

type AspectDimensions = {
  width: number
  height: number
}

type GenerationSettingsAnchor = {
  left: number
  top?: number
  bottom?: number
  maxHeight: number
}

function anchorsEqual(
  current: GenerationSettingsAnchor | null,
  next: GenerationSettingsAnchor,
): boolean {
  return current?.left === next.left
    && current.top === next.top
    && current.bottom === next.bottom
    && current.maxHeight === next.maxHeight
}

function isCanvasInteractionTarget(target: EventTarget | null): boolean {
  return target instanceof Element
    && target.closest('.tc-canvas, .react-flow, .react-flow__pane, .react-flow__viewport') !== null
}

export function resolveAspectDimensions(value: string): AspectDimensions {
  if (value.trim().toLowerCase() === 'auto') return { width: 13, height: 9 }
  const [rawWidth, rawHeight] = value.split(':')
  const width = Number(rawWidth)
  const height = Number(rawHeight)
  if (!(width > 0) || !(height > 0)) return { width: 13, height: 9 }
  const ratio = width / height
  if (ratio >= 1) {
    return {
      width: 17,
      height: Math.max(6, Math.round(17 / ratio)),
    }
  }
  return {
    width: Math.max(6, Math.round(17 * ratio)),
    height: 17,
  }
}

function findClosestDurationIndex(options: ReadonlyArray<number>, value: number): number {
  if (options.length === 0) return 0
  let bestIndex = 0
  let bestDistance = Math.abs(options[0] - value)
  options.forEach((candidate, index) => {
    const distance = Math.abs(candidate - value)
    if (distance < bestDistance || (distance === bestDistance && candidate > options[bestIndex])) {
      bestIndex = index
      bestDistance = distance
    }
  })
  return bestIndex
}

function AspectIcon({ value }: { value: string }): JSX.Element {
  const dimensions = resolveAspectDimensions(value)
  return (
    <span className="tc-generation-settings__aspect-icon" aria-hidden="true">
      <span
        className="tc-generation-settings__aspect-shape"
        style={{ width: dimensions.width, height: dimensions.height }}
      />
    </span>
  )
}

function OptionSection({ section }: { section: GenerationSettingSection }): JSX.Element | null {
  if (section.options.length === 0) return null
  const isAspect = section.layout === 'aspect'
  return (
    <section className="tc-generation-settings__section" aria-label={section.label}>
      <h3 className="tc-generation-settings__label">{section.label}</h3>
      <div
        className={[
          'tc-generation-settings__options',
          isAspect ? 'tc-generation-settings__options--aspect' : 'tc-generation-settings__options--segmented',
        ].join(' ')}
      >
        {section.options.map((option) => {
          const selected = option.value === section.value
          return (
            <button
              className={[
                'tc-generation-settings__option',
                isAspect ? 'tc-generation-settings__option--aspect' : '',
                selected ? 'tc-generation-settings__option--selected' : '',
              ].filter(Boolean).join(' ')}
              type="button"
              key={option.value}
              disabled={option.disabled}
              aria-pressed={selected}
              onClick={() => section.onChange(option.value)}
            >
              {isAspect ? <AspectIcon value={option.label.includes(':') ? option.label : option.value} /> : null}
              <span className="tc-generation-settings__option-label">{option.label}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

function DurationSection({ setting }: { setting: GenerationDurationSetting }): JSX.Element | null {
  const numericOptions = React.useMemo(
    () => Array.from(new Set(setting.options
      .map((option) => Number(option.value))
      .filter((value) => Number.isFinite(value) && value > 0)))
      .sort((left, right) => left - right),
    [setting.options],
  )
  const selectedIndex = findClosestDurationIndex(numericOptions, setting.value)
  const [draftValue, setDraftValue] = React.useState(String(setting.value))

  React.useEffect(() => {
    setDraftValue(String(setting.value))
  }, [setting.value])

  if (numericOptions.length === 0) return null

  const commitDuration = () => {
    const parsed = Number(draftValue)
    const nextIndex = findClosestDurationIndex(numericOptions, parsed)
    const nextValue = numericOptions[nextIndex]
    setDraftValue(String(nextValue))
    if (nextValue !== setting.value) setting.onChange(nextValue)
  }

  return (
    <section className="tc-generation-settings__section" aria-label="视频时长">
      <h3 className="tc-generation-settings__label">视频时长</h3>
      <div className="tc-generation-settings__duration-row">
        <input
          className="tc-generation-settings__duration-slider"
          type="range"
          min={0}
          max={Math.max(0, numericOptions.length - 1)}
          step={1}
          value={selectedIndex}
          disabled={numericOptions.length <= 1}
          aria-label="视频时长"
          onChange={(event) => {
            const nextValue = numericOptions[Number(event.currentTarget.value)]
            if (typeof nextValue === 'number') setting.onChange(nextValue)
          }}
        />
        <label className="tc-generation-settings__duration-value">
          <span className="tc-generation-settings__sr-only">视频时长秒数</span>
          <input
            className="tc-generation-settings__duration-input"
            type="number"
            aria-label="视频时长秒数"
            min={numericOptions[0]}
            max={numericOptions[numericOptions.length - 1]}
            step={1}
            value={draftValue}
            onChange={(event) => setDraftValue(event.currentTarget.value)}
            onBlur={commitDuration}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                commitDuration()
                event.currentTarget.blur()
              }
            }}
          />
          <span className="tc-generation-settings__duration-unit">s</span>
        </label>
      </div>
    </section>
  )
}

function QuantitySection({ setting }: { setting: GenerationQuantitySetting }): JSX.Element {
  return (
    <section className="tc-generation-settings__section" aria-label="生成数量">
      <h3 className="tc-generation-settings__label">生成数量</h3>
      <div className="tc-generation-settings__options tc-generation-settings__options--segmented">
        {setting.options.map((option) => {
          const selected = option === setting.value
          return (
            <button
              className={[
                'tc-generation-settings__option',
                selected ? 'tc-generation-settings__option--selected' : '',
              ].filter(Boolean).join(' ')}
              type="button"
              key={option}
              aria-pressed={selected}
              onClick={() => setting.onChange(option)}
            >
              <span className="tc-generation-settings__option-label">{option}{setting.unit}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

function AudioSection({ setting }: { setting: GenerationAudioSetting }): JSX.Element {
  return (
    <section className="tc-generation-settings__section" aria-label="生成音频">
      <h3 className="tc-generation-settings__label">生成音频</h3>
      <div className="tc-generation-settings__options tc-generation-settings__options--segmented">
        {[
          { value: true, label: '开启' },
          { value: false, label: '关闭' },
        ].map((option) => (
          <button
            className={`tc-generation-settings__option${option.value === setting.value ? ' tc-generation-settings__option--selected' : ''}`}
            type="button"
            key={option.label}
            aria-pressed={option.value === setting.value}
            onClick={() => setting.onChange(option.value)}
          >
            <span className="tc-generation-settings__option-label">{option.label}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

export function GenerationSettingsPopover({
  kind,
  summary,
  aspectValue,
  sections,
  duration,
  audio,
  quantity,
  disabled = false,
}: GenerationSettingsPopoverProps): JSX.Element {
  const [opened, setOpened] = React.useState(false)
  const [anchor, setAnchor] = React.useState<GenerationSettingsAnchor | null>(null)
  const triggerRef = React.useRef<HTMLButtonElement | null>(null)
  const dropdownRef = React.useRef<HTMLDivElement | null>(null)
  const dropdownId = React.useId()

  const updateAnchor = React.useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const panelWidth = 340
    const margin = 12
    const spaceAbove = rect.top - margin - 8
    const spaceBelow = viewportHeight - rect.bottom - margin - 8
    const placeAbove = spaceAbove >= 220 || spaceAbove >= spaceBelow
    const nextAnchor: GenerationSettingsAnchor = placeAbove
      ? {
          left: Math.max(margin, Math.min(rect.left, viewportWidth - panelWidth - margin)),
          bottom: Math.max(margin, viewportHeight - rect.top + 8),
          maxHeight: Math.max(120, Math.min(560, spaceAbove)),
        }
      : {
          left: Math.max(margin, Math.min(rect.left, viewportWidth - panelWidth - margin)),
          top: Math.max(margin, rect.bottom + 8),
          maxHeight: Math.max(120, Math.min(560, spaceBelow)),
        }
    setAnchor((current) => anchorsEqual(current, nextAnchor) ? current : nextAnchor)
  }, [])

  React.useLayoutEffect(() => {
    if (!opened) {
      setAnchor(null)
      return
    }
    updateAnchor()
    let frameId = 0
    const trackAnchor = () => {
      updateAnchor()
      frameId = window.requestAnimationFrame(trackAnchor)
    }
    frameId = window.requestAnimationFrame(trackAnchor)
    const handleViewportChange = () => updateAnchor()
    window.addEventListener('resize', handleViewportChange)
    window.addEventListener('scroll', handleViewportChange, true)
    return () => {
      window.cancelAnimationFrame(frameId)
      window.removeEventListener('resize', handleViewportChange)
      window.removeEventListener('scroll', handleViewportChange, true)
    }
  }, [opened, updateAnchor])

  React.useEffect(() => {
    if (!opened) return
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (triggerRef.current?.contains(target) || dropdownRef.current?.contains(target)) return
      // Canvas panning starts with a pointer-down outside this portal. That is
      // viewport navigation, not an intent to close or reset the focused node's
      // controls. A true pane click still clears node focus through Canvas and
      // naturally unmounts this popover with the focused node.
      if (isCanvasInteractionTarget(target)) return
      setOpened(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpened(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [opened])

  const dropdown = opened && anchor && typeof document !== 'undefined'
    ? createPortal(
        <div
          className="tc-generation-settings__dropdown"
          id={dropdownId}
          ref={dropdownRef}
          role="dialog"
          aria-label={`${kind === 'video' ? '视频' : '图片'}生成参数`}
          style={{
            left: anchor.left,
            top: anchor.top,
            bottom: anchor.bottom,
            maxHeight: anchor.maxHeight,
          }}
        >
          <div className="tc-generation-settings__content" style={{ maxHeight: anchor.maxHeight }}>
            {sections.map((section) => <OptionSection section={section} key={section.key} />)}
            {kind === 'video' && duration ? <DurationSection setting={duration} /> : null}
            {kind === 'video' && audio ? <AudioSection setting={audio} /> : null}
            <QuantitySection setting={quantity} />
          </div>
        </div>,
        document.body,
      )
    : null

  return (
    <span className="tc-generation-settings">
        <button
          className="tc-generation-settings__trigger"
          type="button"
          ref={triggerRef}
          disabled={disabled}
          aria-label={`打开${kind === 'video' ? '视频' : '图片'}生成参数`}
          aria-expanded={opened}
          aria-controls={opened ? dropdownId : undefined}
          aria-haspopup="dialog"
          onClick={() => setOpened((current) => !current)}
        >
          <AspectIcon value={aspectValue} />
          <span className="tc-generation-settings__summary" title={summary}>{summary}</span>
          <IconChevronUp
            className={[
              'tc-generation-settings__chevron',
              opened ? 'tc-generation-settings__chevron--opened' : '',
            ].filter(Boolean).join(' ')}
            size={14}
            stroke={1.8}
            aria-hidden="true"
          />
        </button>
        {dropdown}
    </span>
  )
}
