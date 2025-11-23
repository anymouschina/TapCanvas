import React from 'react'
import { Paper, Title, Stack, Button, Transition } from '@mantine/core'
import { IconTypography, IconPhoto, IconVideo, IconUser } from '@tabler/icons-react'
import { useUIStore } from './uiStore'
import { useRFStore } from '../canvas/store'
import { $ } from '../canvas/i18n'
import { calculateSafeMaxHeight } from './utils/panelPosition'

export default function AddNodePanel(): JSX.Element | null {
  const active = useUIStore(s => s.activePanel)
  const setActivePanel = useUIStore(s => s.setActivePanel)
  const anchorY = useUIStore(s => s.panelAnchorY)
  const addNode = useRFStore(s => s.addNode)

  const mounted = active === 'add'
  const maxHeight = calculateSafeMaxHeight(anchorY, 120)
  return (
    <div style={{ position: 'fixed', left: 82, top: (anchorY ? anchorY - 120 : 64), zIndex: 6001 }} data-ux-panel>
      <Transition mounted={mounted} transition="pop" duration={140} timingFunction="ease">
        {(styles) => (
          <div style={styles}>
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
              <div className="panel-arrow" />
              <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, paddingRight: 4 }}>
                <Title order={6} mb={8}>{$('添加节点')}</Title>
                <Stack gap={8}>
                  <Button variant="light" leftSection={<IconTypography size={16} />} onClick={() => { addNode('taskNode', '文本', { kind: 'textToImage' }); setActivePanel(null) }}>{$('文本')}</Button>
                  <Button variant="light" leftSection={<IconPhoto size={16} />} onClick={() => { addNode('taskNode', 'Image', { kind: 'image' }); setActivePanel(null) }}>{$('图像')}</Button>
                  <Button variant="light" leftSection={<IconVideo size={16} />} onClick={() => { addNode('taskNode', '视频', { kind: 'composeVideo' }); setActivePanel(null) }}>{$('视频')}</Button>
                  <Button variant="light" leftSection={<IconUser size={16} />} onClick={() => { addNode('taskNode', '角色', { kind: 'character' }); setActivePanel(null) }}>{$('角色')}</Button>
                </Stack>
              </div>
            </Paper>
          </div>
        )}
      </Transition>
    </div>
  )
}
