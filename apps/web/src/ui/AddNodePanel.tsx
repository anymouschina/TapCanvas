import React, { useRef } from 'react'
import { Paper, Title, Stack, Group, Button } from '@mantine/core'
import { IconTypography, IconPhoto, IconVideo, IconMusic, IconUpload } from '@tabler/icons-react'
import { useUIStore } from './uiStore'
import { useRFStore } from '../canvas/store'

export default function AddNodePanel(): JSX.Element | null {
  const active = useUIStore(s => s.activePanel)
  const setActivePanel = useUIStore(s => s.setActivePanel)
  const anchorY = useUIStore(s => s.panelAnchorY)
  const addNode = useRFStore(s => s.addNode)
  const fileRef = useRef<HTMLInputElement|null>(null)

  if (active !== 'add') return null
  return (
    <div style={{ position: 'fixed', left: 76, top: (anchorY ? anchorY - 120 : 64), zIndex: 75 }} data-ux-panel>
      <Paper withBorder shadow="md" radius="lg" className="glass" p="md" style={{ width: 320 }} data-ux-panel>
        <Title order={6} mb={8}>添加节点</Title>
        <Stack gap={8}>
          <Button variant="light" leftSection={<IconTypography size={16} />} onClick={() => { addNode('taskNode','文本',{kind:'textToImage'}); setActivePanel(null) }}>文本</Button>
          <Group grow>
            <Button variant="light" leftSection={<IconPhoto size={16} />} onClick={() => { addNode('taskNode','图片',{kind:'textToImage'}); setActivePanel(null) }}>图片</Button>
            <Button variant="light" leftSection={<IconVideo size={16} />} onClick={() => { addNode('taskNode','视频',{kind:'composeVideo'}); setActivePanel(null) }}>视频</Button>
          </Group>
          <Group grow>
            <Button variant="light" leftSection={<IconMusic size={16} />} onClick={() => { addNode('taskNode','音频',{kind:'tts'}); setActivePanel(null) }}>音频</Button>
            <Button variant="light" leftSection={<IconUpload size={16} />} onClick={() => fileRef.current?.click()}>上传</Button>
          </Group>
        </Stack>
        <input ref={fileRef} type="file" hidden onChange={() => setActivePanel(null)} />
      </Paper>
    </div>
  )
}
