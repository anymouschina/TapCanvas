import React from 'react'
import { AppShell, ActionIcon, Group, Title, Box, Button, TextInput, Badge, Modal, Stack, Text, Select } from '@mantine/core'
import { notifications } from '@mantine/notifications'
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
import ModelPanel from './ui/ModelPanel'
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
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (useUIStore.getState().isDirty) {
        e.preventDefault(); e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [])

  // 初始化时：根据 URL 中的 projectId 选择项目；否则默认第一个项目
  React.useEffect(() => {
    listProjects()
      .then((ps) => {
        setProjects(ps)
        const existing = useUIStore.getState().currentProject
        const url = new URL(window.location.href)
        const pidFromUrl = url.searchParams.get('projectId')
        const fromUrl = pidFromUrl ? ps.find((p) => p.id === pidFromUrl) : undefined

        if (fromUrl) {
          if (!existing || existing.id !== fromUrl.id) {
            setCurrentProject({ id: fromUrl.id, name: fromUrl.name })
          }
        } else if (!existing && ps.length) {
          const first = ps[0]
          setCurrentProject({ id: first.id, name: first.name })
        }
      })
      .catch(() => {})
  }, [setCurrentProject])

  // 当 currentProject 变化时，将 projectId 同步到 URL
  React.useEffect(() => {
    const pid = currentProject?.id
    const url = new URL(window.location.href)
    const current = url.searchParams.get('projectId')
    if (pid) {
      if (current !== pid) {
        url.searchParams.set('projectId', pid)
        window.history.replaceState(null, '', url.toString())
      }
    } else if (current) {
      url.searchParams.delete('projectId')
      window.history.replaceState(null, '', url.toString())
    }
  }, [currentProject?.id])

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
    if (saving) return
    // 确保项目存在；若无则直接在此创建
    let proj = useUIStore.getState().currentProject
    if (!proj?.id) {
      const name = (currentProject?.name || `未命名项目 ${new Date().toLocaleString()}`).trim()
      try {
        const p = await upsertProject({ name })
        setProjects(prev => [p, ...prev])
        setCurrentProject({ id: p.id, name: p.name })
        proj = { id: p.id, name: p.name }
      } catch (e:any) {
        notifications.show({ title: '创建项目失败', message: e?.message || '网络或服务器错误', color: 'red' })
        return
      }
    }
    // 项目即工作流：名称使用项目名
    const flowName = proj!.name || '未命名'
    const nodes = useRFStore.getState().nodes
    const edges = useRFStore.getState().edges
    const nid = 'saving-' + Date.now()
    notifications.show({ id: nid, title: '保存中', message: '正在保存当前项目…', loading: true, autoClose: false, withCloseButton: false })
    setSaving(true)
    try {
      const saved = await saveProjectFlow({ id: currentFlow.id || undefined, projectId: proj!.id!, name: flowName, nodes, edges })
      setCurrentFlow({ id: saved.id, name: flowName, source: 'server' })
      setDirty(false)
      notifications.update({ id: nid, title: '已保存', message: `项目「${proj!.name}」已保存`, loading: false, autoClose: 1500, color: 'green' })
    } catch (e: any) {
      notifications.update({ id: nid, title: '保存失败', message: e?.message || '网络或服务器错误', loading: false, autoClose: 3000, color: 'red' })
    } finally {
      setSaving(false)
    }
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
            <Button size="xs" onClick={doSave} disabled={!isDirty} loading={saving}>保存</Button>
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
      <ModelPanel />
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
