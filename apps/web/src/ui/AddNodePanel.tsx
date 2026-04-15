import React from 'react'
import { Title, Stack, Button, Transition } from '@mantine/core'
import { IconLayoutGrid, IconPhoto, IconTypography, IconVideo } from '@tabler/icons-react'
import { useUIStore } from './uiStore'
import { useRFStore } from '../canvas/store'
import { $ } from '../canvas/i18n'
import { calculateSafeMaxHeight } from './utils/panelPosition'
import { PanelCard } from './PanelCard'
import { stopPanelWheelPropagation } from './utils/panelWheel'

const ADDABLE_NODE_OPTIONS = [
  { kind: 'text', label: '文本', Icon: IconTypography },
  { kind: 'image', label: '图像', Icon: IconPhoto },
  { kind: 'storyboard', label: '分镜编辑', Icon: IconLayoutGrid },
  { kind: 'video', label: '视频', Icon: IconVideo },
] as const

export default function AddNodePanel({ className }: { className?: string }): JSX.Element | null {
  const active = useUIStore(s => s.activePanel)
  const setActivePanel = useUIStore(s => s.setActivePanel)
  const anchorY = useUIStore(s => s.panelAnchorY)
  const addNode = useRFStore(s => s.addNode)

  const mounted = active === 'add'
  const maxHeight = calculateSafeMaxHeight(anchorY, 120)
  const panelClassName = ['add-node-panel', className].filter(Boolean).join(' ')
  const addTaskNode = React.useCallback((kind: string) => {
    addNode('taskNode', undefined, { kind })
    setActivePanel(null)
  }, [addNode, setActivePanel])

  return (
    <div className={panelClassName} style={{ position: 'fixed', left: 82, top: (anchorY ? anchorY - 120 : 64), zIndex: 200 }} data-ux-panel>
      <Transition className="add-node-panel-transition" mounted={mounted} transition="pop" duration={140} timingFunction="ease">
        {(styles) => (
          <div className="add-node-panel-transition-inner" style={styles}>
            <PanelCard
              className="glass"
              style={{
                width: 320,
                maxHeight: `${maxHeight}px`,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                transformOrigin: 'left center',
              }}
              onWheelCapture={stopPanelWheelPropagation}
              data-ux-panel
            >
              <div className="add-node-panel-arrow panel-arrow" />
              <div className="add-node-panel-body" style={{ flex: 1, overflowY: 'auto', minHeight: 0, paddingRight: 4 }}>
                <Title className="add-node-panel-title" order={6} mb={8}>{$('添加节点')}</Title>
                <Stack className="add-node-panel-actions" gap={8}>
                  {ADDABLE_NODE_OPTIONS.map(({ kind, label, Icon }) => (
                    <Button
                      key={kind}
                      className="add-node-panel-button"
                      variant="light"
                      leftSection={<Icon className="add-node-panel-icon" size={16} />}
                      onClick={() => addTaskNode(kind)}
                    >
                      {$(label)}
                    </Button>
                  ))}
                </Stack>
              </div>
            </PanelCard>
          </div>
        )}
      </Transition>
    </div>
  )
}
