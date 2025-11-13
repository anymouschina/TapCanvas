import React from 'react'
import { AppShell, ActionIcon, Group, Title, Box, Button, TextInput, Badge, Avatar, Modal, Stack, Text } from '@mantine/core'
import { IconBrandGithub } from '@tabler/icons-react'
import Canvas from './canvas/Canvas'
import GithubGate from './auth/GithubGate'
import { useRFStore } from './canvas/store'
import './styles.css'
import KeyboardShortcuts from './KeyboardShortcuts'
import { applyTemplate, captureCurrentSelection, deleteTemplate, listTemplateNames, saveTemplate, renameTemplate } from './templates'
import { ToastHost, toast } from './ui/toast'
import { useUIStore } from './ui/uiStore'
import { saveServerFlow, listFlowVersions, rollbackFlow, getServerFlow } from './api/server'
import { useAuth } from './auth/store'
import SubflowEditor from './subflow/Editor'
import LibraryEditor from './flows/LibraryEditor'
import { listFlows, saveFlow, deleteFlow as deleteLibraryFlow, renameFlow, scanCycles } from './flows/registry'
import FloatingNav from './ui/FloatingNav'
import AddNodePanel from './ui/AddNodePanel'
import TemplatePanel from './ui/TemplatePanel'
import AccountPanel from './ui/AccountPanel'
import AssetPanel from './ui/AssetPanel'
import ParamModal from './ui/ParamModal'
import PreviewModal from './ui/PreviewModal'

export default function App(): JSX.Element {
  const addNode = useRFStore((s) => s.addNode)
  const subflowNodeId = useUIStore(s => s.subflowNodeId)
  const closeSubflow = useUIStore(s => s.closeSubflow)
  const libraryFlowId = useUIStore(s => s.libraryFlowId)
  const closeLibraryFlow = useUIStore(s => s.closeLibraryFlow)
  const [refresh, setRefresh] = React.useState(0)
  const setActivePanel = useUIStore(s => s.setActivePanel)
  const { currentFlow, isDirty } = useUIStore()
  const setDirty = useUIStore(s => s.setDirty)
  const setCurrentFlow = useUIStore(s => s.setCurrentFlow)
  const rfState = useRFStore()
  const auth = useAuth()
  const [showHistory, setShowHistory] = React.useState(false)
  const [versions, setVersions] = React.useState<Array<{ id: string; createdAt: string; name: string }>>([])

  React.useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (useUIStore.getState().isDirty) {
        e.preventDefault(); e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [])

  // mark dirty on any node/edge change via polling change (simple and safe)
  React.useEffect(() => { setDirty(true) }, [rfState.nodes, rfState.edges, setDirty])

  const doSave = async () => {
    const name = currentFlow.name?.trim() || prompt('工作流名称：')?.trim() || '未命名'
    const nodes = useRFStore.getState().nodes
    const edges = useRFStore.getState().edges
    const saved = await saveServerFlow({ id: currentFlow.id || undefined, name, nodes, edges })
    setCurrentFlow({ id: saved.id, name, source: 'server' })
    setDirty(false)
  }

  return (
    <AppShell
      data-compact={'false'}
      header={{ height: 56 }}
      padding={0}
      styles={{
        main: { paddingTop: 56, paddingLeft: 0, paddingRight: 0, background: 'var(--mantine-color-body)' }
      }}
    >
      <AppShell.Header>
        <Group justify="space-between" p="sm">
          <Group>
            <Title order={4}>TapCanvas</Title>
            {isDirty && (<Badge color="red" variant="light">未保存</Badge>)}
          </Group>
          <Group gap="xs">
            <TextInput size="xs" placeholder="名称" value={currentFlow.name} onChange={(e)=> setCurrentFlow({ name: e.currentTarget.value })} style={{ width: 200 }} />
            <Button size="xs" onClick={doSave} disabled={!isDirty}>保存</Button>
            {currentFlow.id && (
              <Button size="xs" variant="light" onClick={async ()=>{ setShowHistory(true); try { setVersions(await listFlowVersions(currentFlow.id!)) } catch { setVersions([]) } }}>历史</Button>
            )}
            {auth.user ? (
              <Group gap={6}>
                <Avatar size={24} src={auth.user.avatarUrl} alt={auth.user.login} />
                <Text size="sm">{auth.user.login}</Text>
                <Button size="xs" variant="subtle" onClick={()=> auth.clear()}>退出</Button>
              </Group>
            ) : null}
            <ActionIcon component="a" href="https://github.com/anymouschina/TapCanvas" target="_blank" rel="noopener noreferrer" variant="subtle" aria-label="GitHub">
              <IconBrandGithub size={18} />
            </ActionIcon>
          </Group>
        </Group>
      </AppShell.Header>

      {/* 移除左侧固定栏，改为悬浮灵动岛样式 */}

      <AppShell.Main>
        <Box style={{ height: 'calc(100vh - 56px)', width: '100vw' }} onClick={(e)=>{
          const el = e.target as HTMLElement
          if (!el.closest('[data-ux-floating]') && !el.closest('[data-ux-panel]')) {
            setActivePanel(null)
          }
        }}>
          <GithubGate>
            <Canvas />
          </GithubGate>
        </Box>
      </AppShell.Main>

      {/* 右侧属性栏已移除：节点采取顶部操作条 + 参数弹窗 */}

      <KeyboardShortcuts />
      <ToastHost />
      <FloatingNav />
      <AddNodePanel />
      <TemplatePanel />
      <AccountPanel />
      <AssetPanel />
      <ParamModal />
      <PreviewModal />
      {subflowNodeId && (<SubflowEditor nodeId={subflowNodeId} onClose={closeSubflow} />)}
      {libraryFlowId && (<LibraryEditor flowId={libraryFlowId} onClose={closeLibraryFlow} />)}
      <Modal opened={showHistory} onClose={()=>setShowHistory(false)} title="保存历史" size="lg" centered>
        <Stack>
          {versions.length === 0 && <Text size="sm" c="dimmed">暂无历史</Text>}
          {versions.map(v => (
            <Group key={v.id} justify="space-between">
              <Text size="sm">{new Date(v.createdAt).toLocaleString()} - {v.name}</Text>
              <Button size="xs" variant="light" onClick={async ()=>{
                if (!confirm('回滚到该版本？当前更改将丢失')) return
                await rollbackFlow(currentFlow.id!, v.id)
                const r = await getServerFlow(currentFlow.id!)
                const data: any = r?.data || {}
                useRFStore.setState({ nodes: Array.isArray(data.nodes)?data.nodes:[], edges: Array.isArray(data.edges)?data.edges:[] })
                setCurrentFlow({ name: r.name })
                setDirty(false)
                setShowHistory(false)
              }}>回滚</Button>
            </Group>
          ))}
        </Stack>
      </Modal>
    </AppShell>
  )
}
