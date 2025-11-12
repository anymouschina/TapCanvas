import React from 'react'
import { AppShell, Button, Group, Stack, Title, Text, ScrollArea, Divider, NumberInput, Box, Switch } from '@mantine/core'
import { IconPlayerPlay, IconPlayerStop, IconRefresh, IconDeviceFloppy, IconFolderPlus, IconCheckupList } from '@tabler/icons-react'
import Canvas from './canvas/Canvas'
import { useRFStore } from './canvas/store'
import './styles.css'
import KeyboardShortcuts from './KeyboardShortcuts'
import NodeInspector from './inspector/NodeInspector'
import { applyTemplate, captureCurrentSelection, deleteTemplate, listTemplateNames, saveTemplate, renameTemplate } from './templates'
import { ToastHost, toast } from './ui/toast'
import { useUIStore } from './ui/uiStore'
import SubflowEditor from './subflow/Editor'
import LibraryEditor from './flows/LibraryEditor'
import { listFlows, saveFlow, deleteFlow as deleteLibraryFlow, renameFlow, scanCycles } from './flows/registry'
import FloatingNav from './ui/FloatingNav'
import AddNodePanel from './ui/AddNodePanel'
import TemplatePanel from './ui/TemplatePanel'

export default function App(): JSX.Element {
  const addNode = useRFStore((s) => s.addNode)
  const reset = useRFStore((s) => s.reset)
  const load = useRFStore((s) => s.load)
  const state = useRFStore((s) => ({ nodes: s.nodes, edges: s.edges }))
  const runSelected = useRFStore((s) => s.runSelected)
  const runAll = useRFStore((s) => s.runAll)
  const runDag = useRFStore((s) => s.runDag)
  const [concurrency, setConcurrency] = React.useState(2)
  const cancelAll = useRFStore((s) => s.cancelAll)
  const retryFailed = useRFStore((s) => s.retryFailed)
  const subflowNodeId = useUIStore(s => s.subflowNodeId)
  const closeSubflow = useUIStore(s => s.closeSubflow)
  const libraryFlowId = useUIStore(s => s.libraryFlowId)
  const closeLibraryFlow = useUIStore(s => s.closeLibraryFlow)
  const [refresh, setRefresh] = React.useState(0)
  const compact = useUIStore(s => s.compact)
  const toggleCompact = useUIStore(s => s.toggleCompact)
  const setActivePanel = useUIStore(s => s.setActivePanel)

  return (
    <AppShell
      data-compact={compact ? 'true' : 'false'}
      header={{ height: 56 }}
      navbar={{ width: 260, breakpoint: 'sm' }}
      aside={{ width: 320, breakpoint: 'lg' }}
      padding="md"
      styles={{
        main: { paddingTop: 64, background: 'var(--mantine-color-body)' }
      }}
    >
      <AppShell.Header>
        <Group justify="space-between" p="sm">
          <Group>
            <Title order={4}>TapCanvas</Title>
          </Group>
          <Group gap="xs">
            <Button variant="subtle" leftSection={<IconRefresh size={16} />} onClick={() => window.location.reload()}>重置视图</Button>
            <Button variant="subtle" leftSection={<IconDeviceFloppy size={16} />} onClick={() => import('./canvas/store').then(m => m.persistToLocalStorage())}>保存</Button>
            <Button variant="light" leftSection={<IconPlayerPlay size={16} />} onClick={() => runSelected()}>运行选中</Button>
            <Button variant="light" leftSection={<IconPlayerPlay size={16} />} onClick={() => runAll()}>运行全部</Button>
            <NumberInput min={1} max={8} value={concurrency} onChange={(v)=>setConcurrency(Number(v)||2)} w={80} clampBehavior="strict" allowDecimal={false} rightSection={<Text size="xs" c="dimmed">x</Text>} />
            <Button variant="light" leftSection={<IconPlayerPlay size={16} />} onClick={() => runDag(concurrency)}>运行流程(DAG)</Button>
            <Button color="red" variant="subtle" leftSection={<IconPlayerStop size={16} />} onClick={() => cancelAll()}>全部停止</Button>
            <Button variant="subtle" onClick={() => retryFailed()}>重试失败</Button>
            <Switch size="sm" checked={compact} onChange={toggleCompact} label="紧凑" />
          </Group>
        </Group>
      </AppShell.Header>

      {/* 移除左侧固定栏，改为悬浮灵动岛样式 */}

      <AppShell.Main>
        <Box style={{ height: 'calc(100vh - 80px)' }} onClick={(e)=>{
          const el = e.target as HTMLElement
          if (!el.closest('[data-ux-floating]') && !el.closest('[data-ux-panel]')) {
            setActivePanel(null)
          }
        }}>
          <Canvas />
        </Box>
      </AppShell.Main>

      <AppShell.Aside p="sm">
        <ScrollArea h="calc(100vh - 64px)">
          <NodeInspector />
        </ScrollArea>
      </AppShell.Aside>

      <KeyboardShortcuts />
      <ToastHost />
      <FloatingNav />
      <AddNodePanel />
      <TemplatePanel />
      {subflowNodeId && (<SubflowEditor nodeId={subflowNodeId} onClose={closeSubflow} />)}
      {libraryFlowId && (<LibraryEditor flowId={libraryFlowId} onClose={closeLibraryFlow} />)}
    </AppShell>
  )
}
