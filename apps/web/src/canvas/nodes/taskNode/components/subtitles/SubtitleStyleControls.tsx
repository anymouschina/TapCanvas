import { Group, NumberInput, Select, Stack, Switch } from '@mantine/core'
import { resolveSubtitleStyle, type SubtitleFontSizeTier, type SubtitleStyle } from './subtitleStyle'
import { SubtitleColorPicker } from './SubtitleColorPicker'
import './SubtitleStyleControls.css'

type Props = { style?: SubtitleStyle; fontTier: SubtitleFontSizeTier; onChange: (style: SubtitleStyle) => void }
export function SubtitleStyleControls({ style, fontTier, onChange }: Props) {
  const resolved = resolveSubtitleStyle(fontTier, style)
  const patch = (next: Partial<SubtitleStyle>) => onChange({ ...style, ...next })
  return <Stack className="subtitle-style-controls" gap={12}>
    <SubtitleColorPicker className="subtitle-style-controls__colors" colors={resolved} onChange={patch} />
    <Select className="subtitle-style-controls__font" label="字幕字体" size="xs" value={resolved.fontFamily} allowDeselect={false} comboboxProps={{ zIndex: 8400 }}
      data={[{ value: 'sans-serif', label: '无衬线' }, { value: 'serif', label: '衬线' }, { value: 'monospace', label: '等宽' }]}
      onChange={(value) => { if (value === 'sans-serif' || value === 'serif' || value === 'monospace') patch({ fontFamily: value }) }} />
    <NumberInput className="subtitle-style-controls__font-size" label="字号（画面高度百分比）" size="xs" value={resolved.fontSizeRatio * 100} min={1.5} max={15} step={0.1} decimalScale={1} suffix="%" onChange={(value) => { if (typeof value === 'number' && Number.isFinite(value) && value >= 1.5 && value <= 15) patch({ fontSizeRatio: value / 100 }) }} />
    <Group className="subtitle-style-controls__stroke" grow><NumberInput className="subtitle-style-controls__stroke-width" label="描边宽度" size="xs" value={resolved.strokeWidth} min={0} max={12} step={0.5} onChange={(value) => { if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 12) patch({ strokeWidth: value }) }} /><Switch className="subtitle-style-controls__bold" label="粗体" checked={resolved.bold} onChange={(event) => patch({ bold: event.currentTarget.checked })} /></Group>
    <NumberInput className="subtitle-style-controls__opacity" label="背景不透明度" size="xs" value={resolved.backgroundOpacity} min={0} max={1} step={0.1} decimalScale={2} onChange={(value) => { if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1) patch({ backgroundOpacity: value }) }} />
    <Select className="subtitle-style-controls__position" label="字幕位置" size="xs" value={resolved.position} allowDeselect={false} comboboxProps={{ zIndex: 8400 }} data={[{ value: 'top', label: '顶部' }, { value: 'center', label: '居中' }, { value: 'bottom', label: '底部' }]} onChange={(value) => { if (value === 'top' || value === 'center' || value === 'bottom') patch({ position: value }) }} />
    <Select className="subtitle-style-controls__alignment" label="文字对齐" size="xs" value={resolved.alignment} allowDeselect={false} comboboxProps={{ zIndex: 8400 }} data={[{ value: 'left', label: '左对齐' }, { value: 'center', label: '居中' }, { value: 'right', label: '右对齐' }]} onChange={(value) => { if (value === 'left' || value === 'center' || value === 'right') patch({ alignment: value }) }} />
    <NumberInput className="subtitle-style-controls__margin" label="上下边距（画面高度百分比）" size="xs" value={resolved.verticalMarginRatio * 100} min={0} max={40} step={1} suffix="%" onChange={(value) => { if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 40) patch({ verticalMarginRatio: value / 100 }) }} />
  </Stack>
}
