import React from 'react'
import { Popover } from '@mantine/core'
import { IconAdjustmentsHorizontal, IconUserCircle } from '@tabler/icons-react'

type PortraitTextureControlsProps = {
  strength: number
  selectionConfirmed: boolean
  onStrengthChange: (strength: number) => void
}

export function PortraitTextureControls({
  strength,
  selectionConfirmed,
  onStrengthChange,
}: PortraitTextureControlsProps): JSX.Element {
  const [opened, setOpened] = React.useState(false)
  return (
    <div className="tc-portrait-texture-controls nodrag nopan">
      <Popover opened={opened} onChange={setOpened} position="bottom-start" offset={8} withinPortal>
        <Popover.Target>
          <button
            type="button"
            className="tc-portrait-texture-controls__trigger"
            onClick={() => setOpened((current) => !current)}
            aria-label="设置人像质感强度"
          >
            <IconUserCircle size={17} />
            <span>人像质感调节</span>
            <IconAdjustmentsHorizontal size={15} />
          </button>
        </Popover.Target>
        <Popover.Dropdown className="tc-portrait-texture-controls__popover">
          <div className="tc-portrait-texture-controls__header">
            <span>质感强度</span>
            <strong>{strength}</strong>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={strength}
            aria-label="人像质感强度"
            onChange={(event) => onStrengthChange(Number(event.currentTarget.value))}
          />
          <div className="tc-portrait-texture-controls__scale">
            <span>自然保守</span>
            <span>强质感</span>
          </div>
        </Popover.Dropdown>
      </Popover>
      <span className={`tc-portrait-texture-controls__status${selectionConfirmed ? ' is-ready' : ''}`}>
        {selectionConfirmed ? '已选择人物' : '待选择人物'}
      </span>
    </div>
  )
}
