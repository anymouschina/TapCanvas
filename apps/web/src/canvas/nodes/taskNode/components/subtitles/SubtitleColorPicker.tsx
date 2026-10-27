import { useEffect, useState } from 'react'
import { ColorPicker, ColorSwatch, Group, SegmentedControl, Stack, Text, TextInput } from '@mantine/core'
import type { SubtitleStyle } from './types'
import './SubtitleColorPicker.css'

type ColorTarget = 'color' | 'strokeColor' | 'backgroundColor'
type Colors = Required<Pick<SubtitleStyle, ColorTarget>>
type Props = { className?: string; colors: Colors; onChange: (patch: Pick<SubtitleStyle, ColorTarget>) => void }

const targets = [
  { value: 'color', label: '文字', inputLabel: '文字颜色' },
  { value: 'strokeColor', label: '描边', inputLabel: '描边颜色' },
  { value: 'backgroundColor', label: '背景', inputLabel: '背景颜色' },
] as const
const swatches = ['#FFFFFF', '#000000', '#F1F3F5', '#868E96', '#FF6B6B', '#FF922B', '#FFD43B', '#69DB7C', '#38D9A9', '#4DABF7', '#748FFC', '#DA77F2']
const isHexColor = (value: string) => /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(value)

function useHexDraft(value: string, onChange: (color: string) => void) {
  const [input, setInput] = useState(value)
  const [error, setError] = useState<string>()
  useEffect(() => { setInput(value); setError(undefined) }, [value])
  return {
    input,
    error,
    update(color: string) {
      setInput(color)
      setError(undefined)
      if (isHexColor(color)) onChange(color)
    },
    validate() {
      if (!isHexColor(input)) setError('请输入 #RGB 或 #RRGGBB 颜色')
    },
  }
}

export function SubtitleColorPicker({ className, colors, onChange }: Props) {
  const [target, setTarget] = useState<ColorTarget>('color')
  const drafts = {
    color: useHexDraft(colors.color, (color) => onChange({ color })),
    strokeColor: useHexDraft(colors.strokeColor, (strokeColor) => onChange({ strokeColor })),
    backgroundColor: useHexDraft(colors.backgroundColor, (backgroundColor) => onChange({ backgroundColor })),
  }
  const active = targets.find((option) => option.value === target)!
  const draft = drafts[target]
  return <Stack className={`subtitle-color-picker ${className ?? ''}`} gap={8}>
    <SegmentedControl className="subtitle-color-picker__targets" fullWidth size="xs" radius="sm" value={target}
      aria-label="选择字幕颜色目标"
      data={targets.map((option) => ({ value: option.value, label: <Group className="subtitle-color-picker__target-label" gap={6} justify="center" wrap="nowrap">
        <ColorSwatch className="subtitle-color-picker__target-swatch" color={colors[option.value]} size={14} radius={2} />
        <span className="subtitle-color-picker__target-name">{option.label}</span>
      </Group> }))}
      onChange={(value) => { if (value === 'color' || value === 'strokeColor' || value === 'backgroundColor') setTarget(value) }} />
    <Text className="subtitle-color-picker__label" size="xs">{active.inputLabel} · 拖动选色或选择常用色</Text>
    <ColorPicker className="subtitle-color-picker__palette" key={target} fullWidth format="hex" size="sm" value={colors[target]}
      saturationLabel={`${active.inputLabel}饱和度与明度`} hueLabel={`${active.inputLabel}色相`}
      swatches={swatches} swatchesPerRow={6} onChange={draft.update} />
    <TextInput className="subtitle-color-picker__hex" label={active.inputLabel} description="HEX · #RGB / #RRGGBB" size="xs"
      value={draft.input} error={draft.error} spellCheck={false} onChange={(event) => draft.update(event.currentTarget.value)} onBlur={draft.validate} />
  </Stack>
}
