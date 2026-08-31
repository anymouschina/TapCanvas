import React from 'react'
import { ColorPicker, Popover, Slider } from '@mantine/core'
import { IconArrowUp, IconHelp, IconLoader2, IconPhotoPlus, IconRefresh, IconTrash, IconX } from '@tabler/icons-react'
import { NodeToolbar, Position, useViewport } from '@xyflow/react'
import type { ImageLightingRigConfig } from '@tapcanvas/image-view-controls'
import { hostedAssetUrl } from '../../../config/objectStorageAssets'
import { ManagedImage } from '../../../domain/resource-runtime'
import {
  findClosestLightDirection,
  LIBTV_BRIGHTNESS_LEVELS,
  LIBTV_MAIN_LIGHT_DIRECTIONS,
  LIBTV_RIM_LIGHT_DIRECTIONS,
  snapBrightnessToLibTvLevel,
  type LibTvLightDirectionPreset,
} from './imageViewEditorContract'
import { resolveLibTvEditorScale } from './libTvEditorDisplay'
import './LibTvImageEditorSurface.css'

export type LibTvLightingControlState = Readonly<{
  directionEnabled: boolean
  brightnessEnabled: boolean
  colorEnabled: boolean
  rimEnabled: boolean
  smartMode: boolean
}>

export type LightingPreviewMode = 'perspective' | 'front'

export const DEFAULT_LIBTV_LIGHTING_CONTROL_STATE: LibTvLightingControlState = {
  directionEnabled: true,
  brightnessEnabled: true,
  colorEnabled: false,
  rimEnabled: false,
  smartMode: false,
}

type SmartLightingPreset = Readonly<{
  key: string
  label: string
  prompt: string
  previewUrl: string
  brightness?: number
  mainDirectionKey?: string
  colorHex?: string
  referenceUrl?: string
}>

type LibTvLightingEditorToolbarProps = {
  isOpen: boolean
  lightingRig: ImageLightingRigConfig
  controlState: LibTvLightingControlState
  smartPrompt: string
  lightingReferenceImageUrl: string | null
  lightingReferenceUploading: boolean
  applying: boolean
  creditCost?: number
  preview: (mode: LightingPreviewMode) => React.ReactNode
  onLightingRigChange: React.Dispatch<React.SetStateAction<ImageLightingRigConfig>>
  onControlStateChange: React.Dispatch<React.SetStateAction<LibTvLightingControlState>>
  onSmartPromptChange: (value: string) => void
  onSelectLightingReferenceImage: (file: File) => void
  onRemoveLightingReferenceImage: () => void
  onLightingReferenceImageUrlChange: (url: string | null) => void
  onReset: () => void
  onClose: () => void
  onApply: () => void
}

const PRESET_THUMB_BASE = hostedAssetUrl('tapcanvas/lighting-presets')
const SMART_LIGHTING_PRESETS: SmartLightingPreset[] = [
  { key: 'overexposed-film', label: '过曝胶片', prompt: '柯达胶片质感', brightness: 100, previewUrl: `${PRESET_THUMB_BASE}/overexposed-film-v1.png` },
  { key: 'blue-backlight', label: '蓝色逆光', prompt: '', mainDirectionKey: 'low-back', colorHex: '#2d34fa', previewUrl: `${PRESET_THUMB_BASE}/blue-backlight-v1.png` },
  { key: 'rembrandt', label: '伦勃朗光', prompt: '', mainDirectionKey: 'high-front-left', previewUrl: `${PRESET_THUMB_BASE}/rembrandt-v1.png` },
  { key: 'cyberpunk', label: '赛博朋克', prompt: '让画面拥有《银翼杀手2045》同款打光，极简背景', previewUrl: `${PRESET_THUMB_BASE}/cyberpunk-v1.png` },
  { key: 'sunset', label: '落日迷幻', prompt: '', referenceUrl: `${PRESET_THUMB_BASE}/sunset-v1.png`, previewUrl: `${PRESET_THUMB_BASE}/sunset-v1.png` },
  { key: 'dark-mystery', label: '神秘暗调', prompt: '百叶窗打光，神秘优雅', brightness: 10, previewUrl: `${PRESET_THUMB_BASE}/dark-mystery-v1.png` },
  { key: 'golden-hour', label: '黄金时刻', prompt: '让画面光影变成“黄金时刻”', previewUrl: `${PRESET_THUMB_BASE}/golden-hour-v1.png` },
  { key: 'nolan-cold', label: '诺兰冷灰', prompt: '让画面质感变成诺兰同款冷灰色调', previewUrl: `${PRESET_THUMB_BASE}/nolan-cold-v1.png` },
]

const PRIMARY_DIRECTION_KEYS = ['left', 'top', 'right', 'front', 'bottom', 'back'] as const
const PRIMARY_DIRECTIONS = PRIMARY_DIRECTION_KEYS.map((key) => {
  const preset = LIBTV_MAIN_LIGHT_DIRECTIONS.find((candidate) => candidate.key === key)
  if (!preset) throw new Error(`缺少 LibTV 主光源方向预设：${key}`)
  return preset
})

function updateLightSlot(
  rig: ImageLightingRigConfig,
  slot: 'main' | 'fill',
  patch: Partial<ImageLightingRigConfig['main']>,
): ImageLightingRigConfig {
  return { ...rig, [slot]: { ...rig[slot], ...patch } }
}

function CompactSwitch(input: {
  checked: boolean
  label: string
  disabled?: boolean
  onChange: (checked: boolean) => void
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      className="tc-libtv-switch"
      aria-label={input.label}
      aria-checked={input.checked}
      disabled={input.disabled}
      onClick={() => input.onChange(!input.checked)}
    />
  )
}

function HelpDot({ label }: { label: string }): JSX.Element {
  return (
    <Popover withinPortal position="top" withArrow shadow="md">
      <Popover.Target>
        <span className="tc-libtv-help" aria-label={label}>
          <IconHelp size={14} />
        </span>
      </Popover.Target>
      <Popover.Dropdown style={{ maxWidth: 220, fontSize: 12 }}>{label}</Popover.Dropdown>
    </Popover>
  )
}

export function LibTvLightingEditorToolbar(props: LibTvLightingEditorToolbarProps): JSX.Element {
  const { zoom } = useViewport()
  const displayScale = resolveLibTvEditorScale(zoom)
  const [colorPickerOpen, setColorPickerOpen] = React.useState(false)
  const [previewMode, setPreviewMode] = React.useState<LightingPreviewMode>('perspective')
  const referenceInputRef = React.useRef<HTMLInputElement | null>(null)

  const mainDirection = findClosestLightDirection(PRIMARY_DIRECTIONS, props.lightingRig.main)
  const rimDirection = findClosestLightDirection(LIBTV_RIM_LIGHT_DIRECTIONS, props.lightingRig.fill)
  const intensity = snapBrightnessToLibTvLevel(props.lightingRig.main.intensity)
  const colorHex = props.lightingRig.main.colorHex || '#ffffff'
  const mainDirectionIsRear = mainDirection.key.includes('back')

  const selectDirection = React.useCallback((preset: LibTvLightDirectionPreset) => {
    props.onLightingRigChange((current) => updateLightSlot(current, 'main', {
      enabled: true,
      presetId: preset.presetId,
      azimuthDeg: preset.azimuthDeg,
      elevationDeg: preset.elevationDeg,
    }))
    const selectedDirectionIsRear = preset.key.includes('back')
    props.onControlStateChange((current) => ({
      ...current,
      directionEnabled: true,
      rimEnabled: selectedDirectionIsRear ? false : current.rimEnabled,
    }))
  }, [props])

  const applyPreset = React.useCallback((preset: SmartLightingPreset) => {
    props.onSmartPromptChange(preset.prompt)
    if (preset.brightness != null) {
      props.onLightingRigChange((current) => updateLightSlot(current, 'main', { intensity: preset.brightness }))
    }
    if (preset.colorHex) {
      props.onLightingRigChange((current) => updateLightSlot(current, 'main', { colorHex: preset.colorHex }))
    }
    if (preset.mainDirectionKey) {
      const direction = LIBTV_MAIN_LIGHT_DIRECTIONS.find((candidate) => candidate.key === preset.mainDirectionKey)
      if (direction) selectDirection(direction)
    }
    if (preset.referenceUrl) props.onLightingReferenceImageUrlChange(preset.referenceUrl)
    props.onControlStateChange((current) => ({
      ...current,
      smartMode: true,
      brightnessEnabled: preset.brightness != null || current.brightnessEnabled,
      colorEnabled: Boolean(preset.colorHex) || current.colorEnabled,
    }))
  }, [props, selectDirection])

  const smartMode = props.controlState.smartMode
  return (
    <NodeToolbar isVisible={props.isOpen} position={Position.Bottom} align="center" offset={8} className="tc-lighting-toolbar nodrag nopan">
      <section
        aria-label="打光效果"
        className={`tc-libtv-editor-scale tc-libtv-editor-surface tc-lighting-toolbar__surface${smartMode ? ' tc-lighting-toolbar__surface--smart' : ''}`}
        style={{ transform: `scale(${displayScale})` }}
      >
        <header className="tc-libtv-editor-header">
          <h2 className="tc-libtv-editor-title">打光效果</h2>
          <button type="button" className="tc-libtv-icon-button" aria-label="关闭打光效果" onClick={props.onClose}>
            <IconX size={20} />
          </button>
        </header>

        <div className="tc-lighting-toolbar__body">
          <div className="tc-lighting-toolbar__preview-column">
            <div className="tc-lighting-toolbar__preview-tabs" role="tablist" aria-label="打光预览模式">
              {([
                ['perspective', '透视'],
                ['front', '正面'],
              ] as const).map(([mode, label]) => (
                <button
                  type="button"
                  role="tab"
                  key={mode}
                  className="tc-libtv-segment tc-lighting-toolbar__preview-tab"
                  aria-selected={previewMode === mode}
                  onClick={() => setPreviewMode(mode)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="tc-lighting-toolbar__preview">{props.preview(previewMode)}</div>
          </div>

          <div className="tc-lighting-toolbar__controls">
            <div className="tc-lighting-toolbar__global">
              <strong>全局</strong>
              <span style={{ flex: 1 }} />
              <span className="tc-lighting-toolbar__mode-label" style={{ marginRight: 8 }}>智能模式</span>
              <CompactSwitch
                checked={smartMode}
                label="智能模式"
                onChange={(nextSmartMode) => {
                  localStorage.setItem('light-editor-smart-mode', nextSmartMode ? '1' : '0')
                  props.onControlStateChange((current) => ({ ...current, smartMode: nextSmartMode }))
                }}
              />
            </div>

            <div className="tc-lighting-toolbar__control-row">
              <span className="tc-lighting-toolbar__label">亮度</span>
              <HelpDot label="5档可选；最低档可营造暗调氛围，最高档为过曝效果；不设置则不生效" />
              <Slider
                style={{ flex: 1 }}
                min={10}
                max={100}
                step={1}
                marks={LIBTV_BRIGHTNESS_LEVELS.map((level) => ({ value: level.value }))}
                value={intensity}
                onChange={(value) => {
                  const snapped = snapBrightnessToLibTvLevel(value)
                  props.onLightingRigChange((current) => updateLightSlot(current, 'main', { intensity: snapped }))
                  props.onControlStateChange((current) => ({ ...current, brightnessEnabled: true }))
                }}
                size="xs"
                color="gray"
              />
              <span className="tc-lighting-toolbar__brightness-value">{intensity}%</span>
            </div>

            <div className="tc-lighting-toolbar__control-row">
              <span className="tc-lighting-toolbar__label">颜色</span>
              <HelpDot label="设置灯光颜色；不启用时不向模型提交颜色参数" />
              <Popover withinPortal opened={colorPickerOpen} onClose={() => setColorPickerOpen(false)} position="right-start">
                <Popover.Target>
                  <button
                    type="button"
                    aria-label="选择灯光颜色"
                    className="tc-lighting-toolbar__color-button"
                    style={{ background: colorHex }}
                    onClick={() => setColorPickerOpen((open) => !open)}
                  />
                </Popover.Target>
                <Popover.Dropdown>
                  <ColorPicker
                    format="hex"
                    value={colorHex}
                    onChange={(value) => {
                      props.onLightingRigChange((current) => updateLightSlot(current, 'main', { colorHex: value }))
                      props.onControlStateChange((current) => ({ ...current, colorEnabled: true }))
                    }}
                  />
                </Popover.Dropdown>
              </Popover>
              <span style={{ flex: 1 }} />
              <CompactSwitch
                checked={props.controlState.colorEnabled}
                label="启用灯光颜色"
                onChange={(colorEnabled) => props.onControlStateChange((current) => ({ ...current, colorEnabled }))}
              />
            </div>

            <div>
              <div className="tc-lighting-toolbar__direction-title">
                <span className="tc-lighting-toolbar__label">主光源</span>
                <span style={{ flex: 1 }} />
                <span className="tc-lighting-toolbar__direction-value">{mainDirection.label}</span>
              </div>
              <div className="tc-lighting-toolbar__direction-grid" role="group" aria-label="主光源方向">
                {PRIMARY_DIRECTIONS.map((preset) => (
                  <button
                    key={preset.key}
                    type="button"
                    className="tc-libtv-direction-button tc-lighting-toolbar__direction-button"
                    aria-pressed={preset.key === mainDirection.key}
                    onClick={() => selectDirection(preset)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="tc-lighting-toolbar__rim-title">
                <span className="tc-lighting-toolbar__label">轮廓光</span>
                <HelpDot label="主光源位于背后时不能同时开启轮廓光" />
                <span style={{ flex: 1 }} />
                <CompactSwitch
                  checked={props.controlState.rimEnabled}
                  label="轮廓光"
                  disabled={mainDirectionIsRear}
                  onChange={(rimEnabled) => {
                    props.onLightingRigChange((current) => updateLightSlot(current, 'fill', { enabled: rimEnabled }))
                    props.onControlStateChange((current) => ({ ...current, rimEnabled }))
                  }}
                />
              </div>
              {props.controlState.rimEnabled && !mainDirectionIsRear ? (
                <select
                  className="tc-lighting-toolbar__rim-select"
                  aria-label="轮廓光方向"
                  value={rimDirection.key}
                  onChange={(event) => {
                    const preset = LIBTV_RIM_LIGHT_DIRECTIONS.find((candidate) => candidate.key === event.currentTarget.value)
                    if (preset) {
                      props.onLightingRigChange((current) => updateLightSlot(current, 'fill', {
                        enabled: true,
                        presetId: preset.presetId,
                        azimuthDeg: preset.azimuthDeg,
                        elevationDeg: preset.elevationDeg,
                      }))
                    }
                  }}
                >
                  {LIBTV_RIM_LIGHT_DIRECTIONS.map((preset) => (
                    <option key={preset.key} value={preset.key}>{preset.label}</option>
                  ))}
                </select>
              ) : null}
            </div>
          </div>

          {smartMode ? (
            <aside className="tc-lighting-toolbar__smart" aria-label="智能打光">
              <div className="tc-lighting-toolbar__smart-inputs">
                <textarea
                  className="tc-lighting-toolbar__smart-prompt"
                  value={props.smartPrompt}
                  onChange={(event) => props.onSmartPromptChange(event.currentTarget.value)}
                  placeholder="简单描述你想实现的打光效果，或者情绪风格"
                />
                <div className="tc-lighting-toolbar__reference">
                  {props.lightingReferenceImageUrl ? (
                    <>
                      <ManagedImage
                        className="tc-lighting-toolbar__reference-image"
                        src={props.lightingReferenceImageUrl}
                        alt="打光参考图"
                        priority="visible"
                        ownerSurface="task-node-upstream-reference"
                      />
                      <button type="button" className="tc-lighting-toolbar__reference-remove" aria-label="移除参考图" onClick={props.onRemoveLightingReferenceImage}>
                        <IconTrash size={12} />
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="tc-libtv-reference-button tc-lighting-toolbar__reference-button"
                      disabled={props.lightingReferenceUploading}
                      onClick={() => referenceInputRef.current?.click()}
                    >
                      {props.lightingReferenceUploading
                        ? <IconLoader2 className="tc-portrait-select__spinner" size={17} />
                        : <IconPhotoPlus size={17} />}
                      <span>打光参考图</span>
                    </button>
                  )}
                  <input
                    ref={referenceInputRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0]
                      event.currentTarget.value = ''
                      if (file) props.onSelectLightingReferenceImage(file)
                    }}
                  />
                </div>
              </div>

              <div className="tc-lighting-toolbar__presets">
                {SMART_LIGHTING_PRESETS.map((preset) => (
                  <button
                    type="button"
                    key={preset.key}
                    title={preset.label}
                    className="tc-libtv-preset-button tc-lighting-toolbar__preset"
                    onClick={() => applyPreset(preset)}
                  >
                    <ManagedImage
                      className="tc-lighting-toolbar__preset-image"
                      src={preset.previewUrl}
                      alt={preset.label}
                      priority="visible"
                      ownerSurface="task-node-candidate"
                      ownerRequestKey={`lighting-preset:${preset.key}`}
                    />
                    <span className="tc-lighting-toolbar__preset-label">{preset.label}</span>
                  </button>
                ))}
              </div>
            </aside>
          ) : null}
        </div>

        <footer className="tc-libtv-editor-footer tc-lighting-toolbar__footer">
          <button type="button" className="tc-libtv-reset-button" onClick={props.onReset}>
            <IconRefresh size={16} />
            重置参数
          </button>
          <span style={{ flex: 1 }} />
          {props.creditCost != null && props.creditCost > 0 ? (
            <span className="tc-libtv-credit" style={{ marginRight: 10 }}>⚡ {props.creditCost}</span>
          ) : null}
          <button
            type="button"
            className="tc-libtv-action-button"
            disabled={props.applying || props.lightingReferenceUploading}
            aria-label={props.applying ? '打光生成中' : '生成打光图片'}
            onClick={props.onApply}
          >
            {props.applying
              ? <IconLoader2 className="tc-portrait-select__spinner" size={17} />
              : <IconArrowUp size={21} />}
          </button>
        </footer>
      </section>
    </NodeToolbar>
  )
}
