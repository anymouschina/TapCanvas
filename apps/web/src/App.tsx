import React from 'react'
import { AppShell, ActionIcon, Group, Title, Box, Button, TextInput, Badge, Modal, Stack, Text, Select } from '@mantine/core'
import { IconBrandGithub } from '@tabler/icons-react'
import Canvas from './canvas/Canvas'
import GithubGate from './auth/GithubGate'
import { useRFStore } from './canvas/store'
import './styles.css'
import KeyboardShortcuts from './KeyboardShortcuts'
import { applyTemplate, captureCurrentSelection, deleteTemplate, listTemplateNames, saveTemplate, renameTemplate } from './templates'
import { ToastHost, toast } from './ui/toast'
import { useUIStore } from './ui/uiStore'
import { saveProjectFlow, listFlowVersions, rollbackFlow, getServerFlow, listProjects, upsertProject, listProjectFlows, type ProjectDto } from './api/server'
import { useAuth } from './auth/store'
import SubflowEditor from './subflow/Editor'
import LibraryEditor from './flows/LibraryEditor'
import { listFlows, saveFlow, deleteFlow as deleteLibraryFlow, renameFlow, scanCycles } from './flows/registry'
import FloatingNav from './ui/FloatingNav'
import AddNodePanel from './ui/AddNodePanel'
import TemplatePanel from './ui/TemplatePanel'
import AccountPanel from './ui/AccountPanel'
import ProjectPanel from './ui/ProjectPanel'
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
  const currentProject = useUIStore(s => s.currentProject)
  const setCurrentProject = useUIStore(s => s.setCurrentProject)
  const [projects, setProjects] = React.useState<ProjectDto[]>([])
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

  React.useEffect(() => { listProjects().then((ps)=>{
    setProjects(ps)
    if (!useUIStore.getState().currentProject && ps.length) setCurrentProject({ id: ps[0].id, name: ps[0].name })
  }).catch(()=>{}) }, [setCurrentProject])

  // When switching project, sync flow name to project name and clear current flow id (project即工作流)
  React.useEffect(() => {
    if (currentProject?.name) setCurrentFlow({ id: null, name: currentProject.name })
  }, [currentProject?.id])

  // Auto load latest project flow on project switch
  React.useEffect(() => {
    const pid = currentProject?.id
    if (!pid) return
    listProjectFlows(pid).then((list) => {
      if (list.length > 0) {
        const f = list[0]
        const data: any = f.data || {}
        useRFStore.setState({ nodes: Array.isArray(data.nodes)?data.nodes:[], edges: Array.isArray(data.edges)?data.edges:[] })
        setCurrentFlow({ id: f.id, name: f.name, source: 'server' })
        setDirty(false)
      } else {
        // empty project -> clear canvas
        useRFStore.setState({ nodes: [], edges: [], nextId: 1 })
        setCurrentFlow({ id: null, name: currentProject?.name || '未命名', source: 'server' })
        setDirty(false)
      }
    }).catch(()=>{})
  }, [currentProject?.id])

  // mark dirty on any node/edge change via polling change (simple and safe)
  React.useEffect(() => { setDirty(true) }, [rfState.nodes, rfState.edges, setDirty])

  const doSave = async () => {
    // 确保项目存在
    let proj = useUIStore.getState().currentProject
    if (!proj?.id) {
      const name = prompt('项目名称：')?.trim(); if (!name) return
      const p = await upsertProject({ name }); setProjects([p, ...projects]); setCurrentProject({ id: p.id, name: p.name }); proj = { id: p.id, name: p.name }
    }
    // 项目即工作流：名称使用项目名
    const flowName = proj!.name || '未命名'
    const nodes = useRFStore.getState().nodes
    const edges = useRFStore.getState().edges
    const saved = await saveProjectFlow({ id: currentFlow.id || undefined, projectId: proj!.id!, name: flowName, nodes, edges })
    setCurrentFlow({ id: saved.id, name: flowName, source: 'server' })
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
            <TextInput size="xs" placeholder="项目名" value={currentProject?.name || ''} onChange={(e)=> setCurrentProject({ ...(currentProject||{}), name: e.currentTarget.value })} style={{ width: 260 }} onBlur={async ()=>{ if (currentProject?.id && currentProject.name) await upsertProject({ id: currentProject.id, name: currentProject.name }) }} />
            <Button size="xs" onClick={doSave} disabled={!isDirty}>保存</Button>
            {currentFlow.id && (
              <Button size="xs" variant="light" onClick={async ()=>{ setShowHistory(true); try { setVersions(await listFlowVersions(currentFlow.id!)) } catch { setVersions([]) } }}>历史</Button>
            )}
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
      <ProjectPanel />
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
