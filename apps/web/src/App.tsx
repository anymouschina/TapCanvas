import React from 'react'
import { AppShell, ActionIcon, Group, Title, Box, Button, TextInput, Badge, useMantineColorScheme } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconBrandGithub, IconLanguage, IconMoonStars, IconSun } from '@tabler/icons-react'
import Canvas from './canvas/Canvas'
import GithubGate from './auth/GithubGate'
import { useRFStore } from './canvas/store'
import './styles.css'
import KeyboardShortcuts from './KeyboardShortcuts'
import { applyTemplate, captureCurrentSelection, deleteTemplate, listTemplateNames, saveTemplate, renameTemplate } from './templates'
import { ToastHost, toast } from './ui/toast'
import { useUIStore } from './ui/uiStore'
import { listModelProviders, listModelEndpoints, upsertModelProvider, saveProjectFlow, listProjects, upsertProject, listProjectFlows, type ProjectDto } from './api/server'
import { useAuth } from './auth/store'
import { getCurrentLanguage, setLanguage, $ } from './canvas/i18n'
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
import HistoryPanel from './ui/HistoryPanel'
import ParamModal from './ui/ParamModal'
import PreviewModal from './ui/PreviewModal'
import { Background } from 'reactflow'

export default function App(): JSX.Element {
  const { colorScheme, toggleColorScheme } = useMantineColorScheme()
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
  const [saving, setSaving] = React.useState(false)
  const [currentLang, setCurrentLang] = React.useState(getCurrentLanguage())

  React.useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (useUIStore.getState().isDirty) {
        e.preventDefault(); e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [])

  React.useEffect(() => {
    let canceled = false
    const loadVideoEndpoint = async () => {
      try {
        const providers = await listModelProviders()
        let sora = providers.find((p) => p.vendor === 'sora')
        if (!sora) {
          sora = await upsertModelProvider({ name: 'Sora', vendor: 'sora' })
        }
        if (!sora) return
        const endpoints = await listModelEndpoints(sora.id)
        const videos = endpoints.find((e) => e.key === 'videos')
        if (!canceled) {
          useUIStore.getState().setSoraVideoBaseUrl(videos?.baseUrl || null)
        }
      } catch {
        if (!canceled) {
          useUIStore.getState().setSoraVideoBaseUrl(null)
        }
      }
    }
    loadVideoEndpoint()
    return () => {
      canceled = true
    }
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
    notifications.show({ id: nid, title: $('保存中'), message: $('正在保存当前项目…'), loading: true, autoClose: false, withCloseButton: false })
    setSaving(true)
    try {
      const saved = await saveProjectFlow({ id: currentFlow.id || undefined, projectId: proj!.id!, name: flowName, nodes, edges })
      setCurrentFlow({ id: saved.id, name: flowName, source: 'server' })
      setDirty(false)
      notifications.update({ id: nid, title: $('已保存'), message: $('项目「{{name}}」已保存', { name: proj!.name }), loading: false, autoClose: 1500, color: 'green' })
    } catch (e: any) {
      notifications.update({ id: nid, title: $('保存失败'), message: e?.message || $('网络或服务器错误'), loading: false, autoClose: 3000, color: 'red' })
    } finally {
      setSaving(false)
    }
  }

  // 静默保存函数，不显示通知
  const silentSave = async () => {
    if (saving) return

    // 确保项目存在
    let proj = useUIStore.getState().currentProject
    if (!proj?.id) {
      const name = (currentProject?.name || `未命名项目 ${new Date().toLocaleString()}`).trim()
      try {
        const p = await upsertProject({ name })
        setProjects(prev => [p, ...prev])
        setCurrentProject({ id: p.id, name: p.name })
        proj = { id: p.id, name: p.name }
      } catch {
        // 静默保存失败时不抛出错误，避免打扰用户
        return
      }
    }

    const flowName = proj!.name || '未命名'
    const nodes = useRFStore.getState().nodes
    const edges = useRFStore.getState().edges

    try {
      const saved = await saveProjectFlow({ id: currentFlow.id || undefined, projectId: proj!.id!, name: flowName, nodes, edges })
      setCurrentFlow({ id: saved.id, name: flowName, source: 'server' })
      setDirty(false)
    } catch {
      // 静默保存失败时不抛出错误
    }
  }

  // 导出静默保存函数供其他组件使用
  React.useEffect(() => {
    // 将 silentSave 函数挂载到全局，供其他组件调用
    (window as any).silentSaveProject = silentSave
  }, [saving, currentFlow, currentProject])

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
            {isDirty && (<Badge color="red" variant="light">{$('未保存')}</Badge>)}
          </Group>
          <Group gap="xs">
            <TextInput size="xs" placeholder={$('项目名')} value={currentProject?.name || ''} onChange={(e)=> setCurrentProject({ ...(currentProject||{}), name: e.currentTarget.value })} style={{ width: 260 }} onBlur={async ()=>{ if (currentProject?.id && currentProject.name) await upsertProject({ id: currentProject.id, name: currentProject.name }) }} />
            <Button size="xs" onClick={doSave} disabled={!isDirty} loading={saving}>{$('保存')}</Button>
            <ActionIcon
              variant="subtle"
              aria-label={colorScheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              onClick={() => toggleColorScheme()}
            >
              {colorScheme === 'dark' ? <IconSun size={18} /> : <IconMoonStars size={18} />}
            </ActionIcon>
            {/* 历史入口迁移到左侧浮动菜单 */}
            <ActionIcon
              variant="subtle"
              aria-label="Language / 语言"
              onClick={() => {
                const newLang = currentLang === 'zh' ? 'en' : 'zh'
                setLanguage(newLang)
                setCurrentLang(newLang)
              }}
            >
              <IconLanguage size={18} />
            </ActionIcon>
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
      <HistoryPanel />
      <ParamModal />
      <PreviewModal />
      {subflowNodeId && (<SubflowEditor nodeId={subflowNodeId} onClose={closeSubflow} />)}
      {libraryFlowId && (<LibraryEditor flowId={libraryFlowId} onClose={closeLibraryFlow} />)}
    </AppShell>
  )
}
