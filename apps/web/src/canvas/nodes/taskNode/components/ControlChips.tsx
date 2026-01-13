import React from 'react'
import { ActionIcon, Button, Menu } from '@mantine/core'
import { IconPlayerPlay, IconPlayerStop } from '@tabler/icons-react'

type ControlChipsProps = {
  summaryChipStyles: React.CSSProperties
  controlValueStyle: React.CSSProperties
  summaryModelLabel: string
  summaryDuration: string
  summaryResolution: string
  summaryExec: string
  showModelMenu: boolean
  modelList: { value: string; label: string; vendor?: string | null }[]
  onModelChange: (value: string) => void
  showTimeMenu: boolean
  durationOptions: { value: string; label: string }[]
  onDurationChange: (value: number) => void
  showResolutionMenu: boolean
  onAspectChange: (value: string) => void
  showImageSizeMenu: boolean
  imageSize: string
  onImageSizeChange: (value: string) => void
  showOrientationMenu: boolean
  orientation: 'portrait' | 'landscape'
  onOrientationChange: (value: 'portrait' | 'landscape') => void
  showSampleMenu: boolean
  sampleOptions: number[]
  sampleCount: number
  onSampleChange: (value: number) => void
  isCharacterNode: boolean
  isRunning: boolean
  onCancelRun: () => void
  onRun: () => void
}

export function ControlChips({
  summaryChipStyles,
  controlValueStyle,
  summaryModelLabel,
  summaryDuration,
  summaryResolution,
  summaryExec,
  showModelMenu,
  modelList,
  onModelChange,
  showTimeMenu,
  durationOptions,
  onDurationChange,
  showResolutionMenu,
  onAspectChange,
  showImageSizeMenu,
  imageSize,
  onImageSizeChange,
  showOrientationMenu,
  orientation,
  onOrientationChange,
  showSampleMenu,
  sampleOptions,
  sampleCount,
  onSampleChange,
  isCharacterNode,
  isRunning,
  onCancelRun,
  onRun,
}: ControlChipsProps) {
  return (
    <div className="control-chips" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      {showModelMenu && (
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
                maxWidth: 220,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              title={`模型 · ${summaryModelLabel}`}
            >
              <span className="control-chips-value" style={controlValueStyle}>{summaryModelLabel}</span>
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
      {showTimeMenu && (
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
      {showResolutionMenu && (
        <Menu className="control-chips-menu" withinPortal position="bottom-start" transition="pop-top-left">
          <Menu.Target className="control-chips-menu-target">
            <Button
              className="control-chips-button"
              type="button"
              variant="transparent"
              radius={0}
              size="compact-sm"
              style={summaryChipStyles}
              title="分辨率"
            >
              <span className="control-chips-value" style={controlValueStyle}>{summaryResolution}</span>
            </Button>
          </Menu.Target>
          <Menu.Dropdown className="control-chips-menu-dropdown">
            {['auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9'].map((value) => (
              <Menu.Item className="control-chips-menu-item" key={value} onClick={() => onAspectChange(value)}>
                {value}
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
      )}
      {showImageSizeMenu && (
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
            {['1K', '2K', '4K'].map((value) => (
              <Menu.Item className="control-chips-menu-item" key={value} onClick={() => onImageSizeChange(value)}>
                {value}
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
      )}
      {showOrientationMenu && (
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
            {[
              { value: 'landscape', label: '横屏' },
              { value: 'portrait', label: '竖屏' },
            ].map((option) => (
              <Menu.Item className="control-chips-menu-item" key={option.value} onClick={() => onOrientationChange(option.value as 'portrait' | 'landscape')}>
                {option.label}
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
      )}
      {showSampleMenu && (
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
      {!isCharacterNode && (
        <>
          {isRunning && (
            <ActionIcon className="control-chips-stop" size="md" variant="light" color="red" title="停止当前任务" onClick={onCancelRun}>
              <IconPlayerStop className="control-chips-stop-icon" size={16} />
            </ActionIcon>
          )}
          <ActionIcon
            className="control-chips-run"
            size="md"
            title="执行节点"
            disabled={isRunning}
            onClick={onRun}
            radius="md"
            style={{
              width: 20,
              height: 20,
              background: 'linear-gradient(135deg, #4c6ef5, #60a5fa)',
              boxShadow: '0 18px 30px rgba(76, 110, 245, 0.35)',
            }}
          >
            <IconPlayerPlay className="control-chips-run-icon" size={18} />
          </ActionIcon>
        </>
      )}
    </div>
  )
}
