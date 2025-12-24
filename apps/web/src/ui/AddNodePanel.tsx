import React from 'react'
import { Paper, Title, Stack, Button, Transition } from '@mantine/core'
import { IconTypography, IconPhoto, IconVideo, IconUser, IconMovie } from '@tabler/icons-react'
import { useUIStore } from './uiStore'
import { useRFStore } from '../canvas/store'
import { $ } from '../canvas/i18n'
import { calculateSafeMaxHeight } from './utils/panelPosition'

export default function AddNodePanel({ className }: { className?: string }): JSX.Element | null {
  const active = useUIStore(s => s.activePanel)
  const setActivePanel = useUIStore(s => s.setActivePanel)
  const anchorY = useUIStore(s => s.panelAnchorY)
  const addNode = useRFStore(s => s.addNode)

  const mounted = active === 'add'
  const maxHeight = calculateSafeMaxHeight(anchorY, 120)
  const panelClassName = ['add-node-panel', className].filter(Boolean).join(' ')

  return (
    <div className={panelClassName} style={{ position: 'fixed', left: 82, top: (anchorY ? anchorY - 120 : 64), zIndex: 200 }} data-ux-panel>
      <Transition className="add-node-panel-transition" mounted={mounted} transition="pop" duration={140} timingFunction="ease">
        {(styles) => (
          <div className="add-node-panel-transition-inner" style={styles}>
            <Paper
              withBorder
              shadow="md"
              radius="lg"
              className="glass"
              p="md"
              style={{
                width: 320,
                maxHeight: `${maxHeight}px`,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                transformOrigin: 'left center',
              }}
              data-ux-panel
            >
              <div className="add-node-panel-arrow panel-arrow" />
              <div className="add-node-panel-body" style={{ flex: 1, overflowY: 'auto', minHeight: 0, paddingRight: 4 }}>
                <Title className="add-node-panel-title" order={6} mb={8}>{$('添加节点')}</Title>
                <Stack className="add-node-panel-actions" gap={8}>
                  {/* <Button className="add-node-panel__disabled-text-button" variant="light" leftSection={<IconTypography size={16} />} onClick={() => { addNode('taskNode', '文本', { kind: 'text' }); setActivePanel(null) }}>{$('文本')}</Button> */}
                  <Button className="add-node-panel-button" variant="light" leftSection={<IconPhoto className="add-node-panel-icon" size={16} />} onClick={() => { addNode('taskNode', undefined, { kind: 'image' }); setActivePanel(null) }}>{$('图像')}</Button>
                  <Button className="add-node-panel-button" variant="light" leftSection={<IconPhoto className="add-node-panel-icon" size={16} />} onClick={() => { addNode('taskNode', undefined, { kind: 'mosaic' }); setActivePanel(null) }}>{$('拼图')}</Button>
                  <Button className="add-node-panel-button" variant="light" leftSection={<IconVideo className="add-node-panel-icon" size={16} />} onClick={() => { addNode('taskNode', undefined, { kind: 'composeVideo' }); setActivePanel(null) }}>{$('视频')}</Button>
                  <Button className="add-node-panel-button" variant="light" leftSection={<IconMovie className="add-node-panel-icon" size={16} />} onClick={() => { addNode('taskNode', undefined, { kind: 'storyboard' }); setActivePanel(null) }}>{$('分镜beta')}</Button>
                  <Button className="add-node-panel-button" variant="light" leftSection={<IconUser className="add-node-panel-icon" size={16} />} onClick={() => { addNode('taskNode', undefined, { kind: 'character' }); setActivePanel(null) }}>{$('角色')}</Button>
                </Stack>
              </div>
            </Paper>
          </div>
        )}
      </Transition>
    </div>
  )
}
