import React from 'react'
import { ActionIcon, Button, Menu, Popover } from '@mantine/core'
import { IconArrowUp, IconBrain, IconCube, IconLanguage, IconPlayerStop, IconPhoto, IconCamera, IconSparkles, IconX } from '@tabler/icons-react'
import {
  GenerationSettingsPopover,
  type GenerationSettingsPopoverProps,
} from './GenerationSettingsPopover'

function ChipWithClear({
  active,
  onClear,
  children,
  title,
}: {
  active: boolean
  onClear?: () => void
  children: React.ReactNode
  title: string
}) {
  const canClear = active && typeof onClear === 'function'
  if (!canClear) return <>{children}</>
  return (
    <span className="control-chips-clear-wrap">
      {children}
      <button
        type="button"
        aria-label={`清除${title}`}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onClear?.()
        }}
        onMouseDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
        }}
        className="control-chips-clear-btn"
      >
        <IconX size={10} stroke={2.4} />
      </button>
    </span>
  )
}

const DEFAULT_IMAGE_ASPECT_RATIO_OPTIONS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9'].map((value) => ({
  value,
  label: value,
  disabled: false,
}))

const DEFAULT_IMAGE_SIZE_OPTIONS = ['1K', '2K', '4K'].map((value) => ({
  value,
  label: value,
  disabled: false,
}))

type ControlChipsProps = {
  summaryChipStyles: React.CSSProperties
  controlValueStyle: React.CSSProperties
  summaryModelLabel: string
  summaryDuration: string
  summaryQuality?: string
  summaryResolution: string
  summaryExec: string
  showModelMenu: boolean
  modelList: { value: string; label: string; vendor?: string | null }[]
  onModelChange: (value: string) => void
  showTimeMenu: boolean
  durationOptions: ReadonlyArray<{ value: string; label: string }>
  onDurationChange: (value: number) => void
  showQualityMenu?: boolean
  qualityOptions?: { value: string; label: string }[]
  onQualityChange?: (value: string) => void
  showResolutionMenu: boolean
  resolutionTitle?: string
  resolutionOptions?: ReadonlyArray<{ value: string; label: string; disabled?: boolean }>
  onResolutionChange: (value: string) => void
  showImageSizeMenu: boolean
  imageSize: string
  imageSizeOptions?: ReadonlyArray<{ value: string; label: string; disabled?: boolean }>
  onImageSizeChange: (value: string) => void
  showOrientationMenu: boolean
  orientation: 'portrait' | 'landscape'
  onOrientationChange: (value: 'portrait' | 'landscape') => void
  orientationOptions?: ReadonlyArray<{ value: 'portrait' | 'landscape'; label: string }>
  showSampleMenu: boolean
  sampleOptions: ReadonlyArray<number>
  sampleCount: number
  onSampleChange: (value: number) => void
  mappedControls?: ReadonlyArray<{
    key: string
    title: string
    summary: string
    options: ReadonlyArray<{ value: string; label: string; disabled?: boolean }>
    onChange: (value: string) => void
    /** 自定义渲染（提供时不渲染默认下拉芯片，直接渲染该节点，如富音色选择器）。 */
    render?: React.ReactNode
  }>
  showStyleChip?: boolean
  styleImageCount?: number
  onStyleClick?: () => void
  onStyleClear?: () => void
  showCameraChip?: boolean
  cameraChipLabel?: string
  cameraChipActive?: boolean
  cameraChipOpen?: boolean
  onCameraChipChange?: (open: boolean) => void
  onCameraClear?: () => void
  cameraChipContent?: React.ReactNode
  presetLibrary?: React.ReactNode
  isCharacterNode: boolean
  isRunning: boolean
  smartAction?: {
    title: string
    onClick: () => void
    loading?: boolean
    disabled?: boolean
  } | null
  requiredCreditsLabel?: string | null
  onCancelRun: () => void
  onRun: () => void
  onTranslate?: (() => void) | null
  translateLoading?: boolean
  show3dChip?: boolean
  on3dClick?: () => void
  showEnhanceChip?: boolean
  onEnhanceClick?: () => void
  /** 单次点击生成份数（>1 时克隆同节点并行执行，继承上下游连线） */
  showRunCountMenu?: boolean
  runCount?: number
  runCountOptions?: ReadonlyArray<number>
  onRunCountChange?: (value: number) => void
  /** 图片/视频选中态使用的统一生成参数面板。存在时不再渲染分散的参数菜单。 */
  generationSettings?: GenerationSettingsPopoverProps | null
}

function ControlChips({
  summaryChipStyles,
  controlValueStyle,
  summaryModelLabel,
  summaryDuration,
  summaryQuality,
  summaryResolution,
  summaryExec,
  showModelMenu,
  modelList,
  onModelChange,
  showTimeMenu,
  durationOptions,
  onDurationChange,
  showQualityMenu,
  qualityOptions,
  onQualityChange,
  showResolutionMenu,
  resolutionTitle = '分辨率',
  resolutionOptions,
  onResolutionChange,
  showImageSizeMenu,
  imageSize,
  imageSizeOptions,
  onImageSizeChange,
  showOrientationMenu,
  orientation,
  onOrientationChange,
  orientationOptions,
  showSampleMenu,
  sampleOptions,
  sampleCount,
  onSampleChange,
  mappedControls = [],
  showStyleChip = false,
  styleImageCount = 0,
  onStyleClick,
  onStyleClear,
  showCameraChip = false,
  cameraChipLabel,
  cameraChipActive = false,
  cameraChipOpen = false,
  onCameraChipChange,
  onCameraClear,
  cameraChipContent,
  presetLibrary = null,
  isCharacterNode,
  isRunning,
  smartAction = null,
  requiredCreditsLabel = null,
  onCancelRun,
  onRun,
  onTranslate,
  translateLoading = false,
  show3dChip = false,
  on3dClick,
  showEnhanceChip = false,
  onEnhanceClick,
  showRunCountMenu = false,
  runCount = 1,
  runCountOptions = [1, 2, 3, 4],
  onRunCountChange,
  generationSettings = null,
}: ControlChipsProps) {
  const resolvedResolutionOptions = resolutionOptions || DEFAULT_IMAGE_ASPECT_RATIO_OPTIONS
  const resolvedImageSizeOptions = imageSizeOptions || DEFAULT_IMAGE_SIZE_OPTIONS
  const [runCountOpen, setRunCountOpen] = React.useState(false)

  return (
    <div className="control-chips" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'nowrap', minWidth: 0, width: '100%' }}>
      <div className="control-chips-main" style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 auto', minWidth: 0 }}>
      {showModelMenu && (
        <Menu className="control-chips-menu control-chips-menu--model" withinPortal position="bottom-start" transition="pop-top-left">
          <Menu.Target className="control-chips-menu-target">
            <Button
              className="control-chips-button"
              type="button"
              variant="transparent"
              radius={0}
              size="compact-sm"
              style={{
                ...summaryChipStyles,
                minWidth: 0,
                maxWidth: 220,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={`模型 · ${summaryModelLabel}`}
            >
              <span
                className="control-chips-value"
                style={{ ...controlValueStyle, display: 'block', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >
                {summaryModelLabel}
              </span>
            </Button>
          </Menu.Target>
          <Menu.Dropdown className="control-chips-menu-dropdown">
            {modelList.map((option) => (
              <Menu.Item className="control-chips-menu-item" key={option.value} onClick={() => onModelChange(option.value)}>
                {option.label}
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
      )}
      {generationSettings ? (
        <GenerationSettingsPopover
          {...generationSettings}
          disabled={generationSettings.disabled || isRunning}
        />
      ) : null}
      {!generationSettings && mappedControls.map((control) =>
        control.render ? (
          <React.Fragment key={control.key}>{control.render}</React.Fragment>
        ) : (
        <Menu
          className="control-chips-menu"
          key={control.key}
          withinPortal
          position="bottom-start"
          transition="pop-top-left"
        >
          <Menu.Target className="control-chips-menu-target">
            <Button
              className="control-chips-button"
              type="button"
              variant="transparent"
              radius={0}
              size="compact-sm"
              style={{
                ...summaryChipStyles,
                minWidth: 0,
              }}
              title={control.title}
            >
              <span className="control-chips-value" style={controlValueStyle}>
                {control.summary}
              </span>
            </Button>
          </Menu.Target>
          <Menu.Dropdown className="control-chips-menu-dropdown">
            {control.options.map((option) => (
              <Menu.Item
                className="control-chips-menu-item"
                key={option.value}
                disabled={option.disabled}
                onClick={() => control.onChange(option.value)}
              >
                {option.label}
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
        ),
      )}
      {!generationSettings && showTimeMenu && (
        <Menu className="control-chips-menu" withinPortal position="bottom-start" transition="pop-top-left">
          <Menu.Target className="control-chips-menu-target">
            <Button
              className="control-chips-button"
              type="button"
              variant="transparent"
              radius={0}
              size="compact-sm"
              style={{
                ...summaryChipStyles,
                minWidth: 0,
              }}
              title="时长"
            >
              <span className="control-chips-value" style={controlValueStyle}>{summaryDuration}</span>
            </Button>
          </Menu.Target>
          <Menu.Dropdown className="control-chips-menu-dropdown">
            {durationOptions.map((option) => (
              <Menu.Item className="control-chips-menu-item" key={option.value} onClick={() => onDurationChange(Number(option.value))}>
                {option.label}
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
      )}
      {!generationSettings && showQualityMenu && summaryQuality && (
        <Menu className="control-chips-menu" withinPortal position="bottom-start" transition="pop-top-left">
          <Menu.Target className="control-chips-menu-target">
            <Button
              className="control-chips-button"
              type="button"
              variant="transparent"
              radius={0}
              size="compact-sm"
              style={{
                ...summaryChipStyles,
                minWidth: 0,
              }}
              title="质量"
            >
              <span className="control-chips-value" style={controlValueStyle}>{summaryQuality}</span>
            </Button>
          </Menu.Target>
          <Menu.Dropdown className="control-chips-menu-dropdown">
            {(qualityOptions || []).map((option) => (
              <Menu.Item className="control-chips-menu-item" key={option.value} onClick={() => onQualityChange?.(option.value)}>
                {option.label}
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
      )}
      {!generationSettings && showResolutionMenu && (
        <Menu className="control-chips-menu" withinPortal position="bottom-start" transition="pop-top-left">
          <Menu.Target className="control-chips-menu-target">
            <Button
              className="control-chips-button"
              type="button"
              variant="transparent"
              radius={0}
              size="compact-sm"
              style={summaryChipStyles}
              title={resolutionTitle}
            >
              <span className="control-chips-value" style={controlValueStyle}>{summaryResolution}</span>
            </Button>
          </Menu.Target>
          <Menu.Dropdown className="control-chips-menu-dropdown">
            {resolvedResolutionOptions.map((option) => (
              <Menu.Item className="control-chips-menu-item" key={option.value} disabled={option.disabled} onClick={() => onResolutionChange(option.value)}>
                {option.label}
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
      )}
      {!generationSettings && showImageSizeMenu && (
        <Menu className="control-chips-menu" withinPortal position="bottom-start" transition="pop-top-left">
          <Menu.Target className="control-chips-menu-target">
            <Button
              className="control-chips-button"
              type="button"
              variant="transparent"
              radius={0}
              size="compact-sm"
              style={summaryChipStyles}
              title="图像尺寸"
            >
              <span className="control-chips-value" style={controlValueStyle}>{imageSize}</span>
            </Button>
          </Menu.Target>
          <Menu.Dropdown className="control-chips-menu-dropdown">
            {resolvedImageSizeOptions.map((option) => (
              <Menu.Item className="control-chips-menu-item" key={option.value} disabled={option.disabled} onClick={() => onImageSizeChange(option.value)}>
                {option.label}
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
      )}
      {!generationSettings && showOrientationMenu && (
        <Menu className="control-chips-menu" withinPortal position="bottom-start" transition="pop-top-left">
          <Menu.Target className="control-chips-menu-target">
            <Button
              className="control-chips-button"
              type="button"
              variant="transparent"
              radius={0}
              size="compact-sm"
              style={{
                ...summaryChipStyles,
                minWidth: 0,
              }}
              title="方向"
            >
              <span className="control-chips-value" style={controlValueStyle}>{orientation === 'portrait' ? '竖屏' : '横屏'}</span>
            </Button>
          </Menu.Target>
          <Menu.Dropdown className="control-chips-menu-dropdown">
            {(orientationOptions || [
              { value: 'landscape', label: '横屏' },
              { value: 'portrait', label: '竖屏' },
            ]).map((option) => (
              <Menu.Item className="control-chips-menu-item" key={option.value} onClick={() => onOrientationChange(option.value as 'portrait' | 'landscape')}>
                {option.label}
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
      )}
      {!generationSettings && showSampleMenu && (
        <Menu className="control-chips-menu" withinPortal position="bottom-start" transition="pop-top-left">
          <Menu.Target className="control-chips-menu-target">
            <Button
              className="control-chips-button"
              type="button"
              variant="transparent"
              radius={0}
              size="compact-sm"
              style={{
                ...summaryChipStyles,
                minWidth: 0,
              }}
              title="生成次数"
            >
              <span className="control-chips-value" style={controlValueStyle}>{summaryExec}</span>
            </Button>
          </Menu.Target>
          <Menu.Dropdown className="control-chips-menu-dropdown">
            {sampleOptions.map((value) => (
              <Menu.Item className="control-chips-menu-item" key={value} onClick={() => onSampleChange(value)}>
                {value}x
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
      )}
      {showStyleChip && (
        <ChipWithClear active={styleImageCount > 0} onClear={onStyleClear} title="风格">
          <Button
            className="control-chips-button control-chips-button--style"
            type="button"
            variant="transparent"
            radius={0}
            size="compact-sm"
            onClick={onStyleClick}
            title="风格基底"
            style={{
              ...summaryChipStyles,
              minWidth: 0,
              ...(styleImageCount > 0 ? { color: 'var(--mantine-color-blue-4)' } : {}),
            }}
          >
            <IconPhoto size={12} style={{ marginRight: 4, flexShrink: 0 }} />
            <span className="control-chips-value" style={controlValueStyle}>
              风格{styleImageCount > 0 ? ` · ${styleImageCount}` : ''}
            </span>
          </Button>
        </ChipWithClear>
      )}
      {showCameraChip && (
        <ChipWithClear active={cameraChipActive} onClear={onCameraClear} title="摄影机">
          <Popover
            opened={cameraChipOpen}
            onChange={onCameraChipChange}
            position="top-start"
            offset={8}
            withinPortal
            shadow="xl"
            styles={{ dropdown: { padding: 0, background: 'transparent', border: 'none', overflow: 'visible', boxShadow: 'none' } }}
          >
            <Popover.Target>
              <Button
                className="control-chips-button control-chips-button--camera"
                type="button"
                variant="transparent"
                radius={0}
                size="compact-sm"
                onClick={() => onCameraChipChange?.(!cameraChipOpen)}
                title="摄影机控制"
                style={{
                  ...summaryChipStyles,
                  minWidth: 0,
                  ...(cameraChipActive ? { color: 'var(--mantine-color-blue-4)' } : {}),
                }}
              >
                <IconCamera size={12} style={{ marginRight: 4, flexShrink: 0 }} />
                <span className="control-chips-value" style={{ ...controlValueStyle, maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {cameraChipLabel || '摄影机控制'}
                </span>
              </Button>
            </Popover.Target>
            <Popover.Dropdown>
              {cameraChipContent}
            </Popover.Dropdown>
          </Popover>
        </ChipWithClear>
      )}
      {presetLibrary}
      </div>
      {!isCharacterNode && (
        <div className="control-chips-actions" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 'auto', flex: '0 0 auto' }}>
          {smartAction && (
            <ActionIcon
              className="control-chips-smart"
              size="md"
              title={smartAction.title}
              disabled={isRunning || !!smartAction.disabled}
              loading={!!smartAction.loading}
              onClick={smartAction.onClick}
              radius="md"
              style={{
                width: 20,
                height: 20,
                background: 'rgba(122, 129, 140, 0.12)',
                color: '#7a8190',
              }}
            >
              <IconBrain className="control-chips-smart-icon" size={16} />
            </ActionIcon>
          )}
          {onTranslate && !isRunning && (
            <ActionIcon
              className="control-chips-translate"
              size="sm"
              variant="subtle"
              color="gray"
              title="AI 翻译为英文提示词"
              loading={translateLoading}
              disabled={translateLoading}
              onClick={onTranslate}
              style={{ width: 20, height: 20, minWidth: 20 }}
            >
              <IconLanguage className="control-chips-translate-icon" size={14} />
            </ActionIcon>
          )}
          {show3dChip && on3dClick && !isRunning && (
            <ActionIcon className="control-chips-3d" size="sm" variant="subtle" color="gray"
              title="转 3D 模型" onClick={on3dClick} style={{ width: 20, height: 20, minWidth: 20 }}>
              <IconCube size={14} />
            </ActionIcon>
          )}
          {showEnhanceChip && onEnhanceClick && !isRunning && (
            <ActionIcon className="control-chips-enhance" size="sm" variant="subtle" color="gray"
              title="画质增强" onClick={onEnhanceClick} style={{ width: 20, height: 20, minWidth: 20 }}>
              <IconSparkles size={14} />
            </ActionIcon>
          )}
          {isRunning && (
            <ActionIcon className="control-chips-stop" size="md" variant="light" color="red" title="停止当前任务" onClick={onCancelRun}>
              <IconPlayerStop className="control-chips-stop-icon" size={16} />
            </ActionIcon>
          )}
          {/* 份数 chip（pill 外独立放置，对标参考设计）：弹出竖向胶囊 4×/3×/2×/1×，
              >1 时点击生成会克隆 N-1 个同节点并行执行（继承上下游连线）。 */}
          {!generationSettings && showRunCountMenu && onRunCountChange && (
            <Popover
              withinPortal
              position="top"
              offset={8}
              shadow="xl"
              opened={runCountOpen}
              onChange={setRunCountOpen}
              styles={{ dropdown: { padding: 4, background: 'rgba(40, 42, 46, 0.97)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 22 } }}
            >
              <Popover.Target>
                <button
                  type="button"
                  title="单次生成份数（>1 时克隆同节点并行生成，继承上下游连线）"
                  disabled={isRunning}
                  onClick={() => setRunCountOpen((o) => !o)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: 28,
                    minWidth: 34,
                    padding: '0 8px',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                    borderRadius: 10,
                    background: 'rgba(58, 60, 66, 0.92)',
                    color: '#e7e9ee',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: isRunning ? 'not-allowed' : 'pointer',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}
                >
                  {runCount}<span style={{ fontSize: 10, fontWeight: 600, opacity: 0.7 }}>×</span>
                </button>
              </Popover.Target>
              <Popover.Dropdown>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {[...runCountOptions].sort((a, b) => b - a).map((opt) => {
                    const active = opt === runCount
                    return (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => {
                          onRunCountChange(opt)
                          setRunCountOpen(false)
                        }}
                        style={{
                          width: 44,
                          height: 34,
                          border: 'none',
                          borderRadius: 17,
                          background: active ? 'rgba(255, 255, 255, 0.14)' : 'transparent',
                          color: active ? '#ffffff' : 'rgba(255, 255, 255, 0.42)',
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: 'pointer',
                          transition: 'background 100ms ease, color 100ms ease',
                        }}
                        onMouseEnter={(e) => {
                          if (!active) (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.8)'
                        }}
                        onMouseLeave={(e) => {
                          if (!active) (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.42)'
                        }}
                      >
                        {opt}×
                      </button>
                    )
                  })}
                </div>
              </Popover.Dropdown>
            </Popover>
          )}
          {/* 运行 pill：深色胶囊 [积分 · 浅色圆形↑]，整体可点击 */}
          <button
            className="control-chips-run-pill"
            type="button"
            title={requiredCreditsLabel ? `生成（消耗 ${requiredCreditsLabel}）` : '执行节点'}
            disabled={isRunning}
            onClick={onRun}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              height: 28,
              padding: '3px 3px 3px 12px',
              borderRadius: 999,
              background: 'rgba(58, 60, 66, 0.92)',
              border: '1px solid rgba(255, 255, 255, 0.06)',
              opacity: isRunning ? 0.65 : 1,
              cursor: isRunning ? 'not-allowed' : 'pointer',
              transition: 'opacity 140ms ease',
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              if (isRunning) return
              const circle = e.currentTarget.querySelector('.control-chips-run-toggle') as HTMLElement | null
              if (circle) circle.style.background = '#ffffff'
            }}
            onMouseLeave={(e) => {
              if (isRunning) return
              const circle = e.currentTarget.querySelector('.control-chips-run-toggle') as HTMLElement | null
              if (circle) circle.style.background = '#d8dade'
            }}
          >
            {requiredCreditsLabel && (
              <span
                className="control-chips-run-credits"
                style={{
                  color: 'rgba(214, 217, 224, 0.78)',
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: 0.2,
                  whiteSpace: 'nowrap',
                }}
              >
                {requiredCreditsLabel}
              </span>
            )}
            <span
              className="control-chips-run-toggle"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 22,
                height: 22,
                borderRadius: 999,
                background: isRunning ? 'rgba(170, 173, 180, 0.35)' : '#d8dade',
                color: '#27292e',
                transition: 'transform 120ms ease, background 120ms ease',
                flexShrink: 0,
              }}
            >
              <IconArrowUp className="control-chips-run-icon" size={14} stroke={2.4} />
            </span>
          </button>
        </div>
      )}
    </div>
  )
}

const _ControlChips = React.memo(ControlChips)
export { _ControlChips as ControlChips }
