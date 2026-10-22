import { ActionIcon, Tooltip } from '@mantine/core'
import { IconLayoutDashboard, IconSchema } from '@tabler/icons-react'
import { useWorkbenchViewStore } from './workbenchViewStore'
import './workbench.css'

export function CanvasViewSwitcher(): JSX.Element {
  const view = useWorkbenchViewStore((state) => state.view)
  const setView = useWorkbenchViewStore((state) => state.setView)
  const label = view === 'canvas' ? '切换到流水线' : '切换到画布'
  return (
    <Tooltip className="tc-workspace-mode-tooltip" label={label} openDelay={180}>
      <ActionIcon className="tc-workspace-mode-switch" variant="subtle" size={32} aria-label={label}
        aria-pressed={view === 'workbench'}
        onMouseEnter={() => { void import('./CanvasWorkbench') }}
        onClick={() => setView(view === 'canvas' ? 'workbench' : 'canvas')}>
        {view === 'canvas'
          ? <IconLayoutDashboard className="tc-workspace-switch__icon" size={19} />
          : <IconSchema className="tc-workspace-switch__icon" size={19} />}
      </ActionIcon>
    </Tooltip>
  )
}
