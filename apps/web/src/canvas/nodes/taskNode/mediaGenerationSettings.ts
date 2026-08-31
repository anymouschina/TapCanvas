import type {
  GenerationSettingOption,
  GenerationSettingSection,
  GenerationSettingsPopoverProps,
} from './components/GenerationSettingsPopover'

export type MediaGenerationControlBinding =
  | 'durationSeconds'
  | 'resolution'
  | 'size'
  | 'orientation'
  | 'aspectRatio'
  | 'imageSize'
  | 'quality'
  | 'videoReferType'

export type MediaGenerationMappedControl = {
  key: string
  binding: MediaGenerationControlBinding
  title: string
  summary: string
  options: ReadonlyArray<GenerationSettingOption>
  onChange: (value: string) => void
}

type BuildMediaGenerationSettingsInput = {
  kind: 'image' | 'video'
  aspect: string
  videoSize: string
  orientation: string
  effectiveVideoResolution: string
  imageResolution: string
  imageSize: string
  imageQuality?: string
  videoReferType: string
  mappedControls: ReadonlyArray<MediaGenerationMappedControl>
  fallbackAspectOptions: ReadonlyArray<GenerationSettingOption>
  onFallbackAspectChange: (value: string) => void
  duration: {
    value: number
    options: ReadonlyArray<{ value: string; label: string }>
    onChange: (value: number) => void
  } | null
  audio?: {
    value: boolean
    onChange: (value: boolean) => void
  } | null
  summaryAspect: string
  summaryResolution: string
  summaryDuration: string
  quantity: number
  onQuantityChange: (value: number) => void
}

function resolveControlValue(
  control: MediaGenerationMappedControl,
  input: BuildMediaGenerationSettingsInput,
): string {
  if (control.binding === 'size') return input.videoSize || input.aspect
  if (control.binding === 'orientation') return input.orientation
  if (control.binding === 'resolution') {
    return input.kind === 'video' ? input.effectiveVideoResolution : input.imageResolution
  }
  if (control.binding === 'aspectRatio') return input.aspect
  if (control.binding === 'imageSize') return input.imageSize
  if (control.binding === 'quality') return input.imageQuality || ''
  if (control.binding === 'videoReferType') return input.videoReferType
  return ''
}

function buildSections(input: BuildMediaGenerationSettingsInput): GenerationSettingSection[] {
  const sections = input.mappedControls
    .filter((control) => control.binding !== 'durationSeconds')
    .map((control): GenerationSettingSection => ({
      key: control.key,
      label: control.binding === 'size' || control.binding === 'aspectRatio' ? '比例' : control.title,
      value: resolveControlValue(control, input),
      options: control.options,
      layout: control.binding === 'size' || control.binding === 'aspectRatio' ? 'aspect' : 'segmented',
      onChange: control.onChange,
    }))

  if (!sections.some((section) => section.layout === 'aspect') && input.fallbackAspectOptions.length > 0) {
    sections.unshift({
      key: `${input.kind}_aspect_fallback`,
      label: '比例',
      value: input.kind === 'video' ? input.videoSize || input.aspect : input.aspect,
      options: input.fallbackAspectOptions,
      layout: 'aspect',
      onChange: input.onFallbackAspectChange,
    })
  }

  return sections
}

function buildSummary(
  input: BuildMediaGenerationSettingsInput,
  sections: ReadonlyArray<GenerationSettingSection>,
): string {
  const parts = input.kind === 'video'
    ? [
        input.summaryAspect,
        input.summaryResolution === '未设定' ? '' : input.summaryResolution,
        input.summaryDuration,
        `${input.quantity}个`,
      ]
    : [
        input.summaryAspect,
        ...sections
          .filter((section) => section.layout !== 'aspect')
          .map((section) => section.options.find((option) => option.value === section.value)?.label || section.value),
        `${input.quantity}张`,
      ]
  return Array.from(new Set(parts.map((part) => part.trim()).filter(Boolean))).join(' · ')
}

export function buildMediaGenerationSettings(
  input: BuildMediaGenerationSettingsInput,
): GenerationSettingsPopoverProps {
  const sections = buildSections(input)
  return {
    kind: input.kind,
    summary: buildSummary(input, sections),
    aspectValue: input.aspect,
    sections,
    duration: input.kind === 'video' ? input.duration : null,
    audio: input.kind === 'video' ? input.audio ?? null : null,
    quantity: {
      value: input.quantity,
      options: Array.from(new Set([1, 2, 4, input.quantity])).sort((left, right) => left - right),
      unit: input.kind === 'video' ? '个' : '张',
      onChange: input.onQuantityChange,
    },
  }
}
