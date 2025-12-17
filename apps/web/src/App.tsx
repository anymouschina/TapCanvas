import React from 'react'
import { AppShell, ActionIcon, Group, Title, Box, Button, TextInput, Badge, useMantineColorScheme, Text, Tooltip, Popover, Loader, Stack, Image, Modal } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconBrandGithub, IconLanguage, IconMoonStars, IconSun, IconRefresh, IconHeartbeat, IconAlertCircle } from '@tabler/icons-react'
import Canvas from './canvas/Canvas'
import GithubGate from './auth/GithubGate'
import { useRFStore } from './canvas/store'
import './styles.css'
import KeyboardShortcuts from './KeyboardShortcuts'
import { applyTemplate, captureCurrentSelection, deleteTemplate, listTemplateNames, saveTemplate, renameTemplate } from './templates'
import { ToastHost, toast } from './ui/toast'
import { useUIStore } from './ui/uiStore'
import {
  listModelProviders,
  listModelEndpoints,
  upsertModelProvider,
  saveProjectFlow,
  listProjects,
  upsertProject,
  listProjectFlows,
  getProxyConfig,
  getProxyCredits,
  getProxyModelStatus,
  unwatermarkSoraVideo,
  type ProjectDto,
  type ProxyConfigDto,
  uploadSora2ApiCharacter,
  fetchSora2ApiCharacterResult,
} from './api/server'
import { useAuth } from './auth/store'
import { getCurrentLanguage, setLanguage, $, $t } from './canvas/i18n'
import SubflowEditor from './subflow/Editor'
import LibraryEditor from './flows/LibraryEditor'
import { listFlows, saveFlow, deleteFlow as deleteLibraryFlow, renameFlow, scanCycles } from './flows/registry'
import FloatingNav from './ui/FloatingNav'
import AddNodePanel from './ui/AddNodePanel'
import TemplatePanel from './ui/TemplatePanel'
import AccountPanel from './ui/AccountPanel'
import ProjectPanel from './ui/ProjectPanel'
import AssetPanel from './ui/AssetPanel'
import TapshowPanel from './ui/TapshowPanel'
import { CharacterCreatorModal } from './ui/CharacterCreatorModal'
import { VideoTrimModalHost } from './ui/VideoTrimModalHost'
import ModelPanel from './ui/ModelPanel'
import HistoryPanel from './ui/HistoryPanel'
import ParamModal from './ui/ParamModal'
import PreviewModal from './ui/PreviewModal'
import TapshowFullPage from './ui/TapshowFullPage'
import ShareFullPage from './ui/ShareFullPage'
import StatsFullPage from './ui/StatsFullPage'
import { runNodeRemote } from './runner/remoteRunner'
import { Background } from 'reactflow'
import { GRSAI_PROXY_VENDOR, GRSAI_PROXY_UPDATED_EVENT, GRSAI_STATUS_MODELS, type GrsaiStatusModel } from './constants/grsai'

function CanvasApp(): JSX.Element {
  const { colorScheme, toggleColorScheme } = useMantineColorScheme()
  const addNode = useRFStore((s) => s.addNode)
  const subflowNodeId = useUIStore(s => s.subflowNodeId)
  const closeSubflow = useUIStore(s => s.closeSubflow)
  const libraryFlowId = useUIStore(s => s.libraryFlowId)
  const closeLibraryFlow = useUIStore(s => s.closeLibraryFlow)
  const characterCreatorRequest = useUIStore(s => s.characterCreatorRequest)
  const clearCharacterCreatorRequest = useUIStore(s => s.clearCharacterCreatorRequest)
  const langGraphChatOpen = useUIStore(s => s.langGraphChatOpen)
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
  const [grsaiProxy, setGrsaiProxy] = React.useState<ProxyConfigDto | null>(null)
  const [grsaiCredits, setGrsaiCredits] = React.useState<number | null>(null)
  const [grsaiCreditsLoading, setGrsaiCreditsLoading] = React.useState(false)
  const [grsaiCreditsError, setGrsaiCreditsError] = React.useState<string | null>(null)
  const [statusPopoverOpened, setStatusPopoverOpened] = React.useState(false)
  const [grsaiStatuses, setGrsaiStatuses] = React.useState<Record<string, { status: boolean; error?: string }>>({})
  const [grsaiStatusLoading, setGrsaiStatusLoading] = React.useState(false)
  const [grsaiStatusError, setGrsaiStatusError] = React.useState<string | null>(null)
  const isGrsaiProxyActive = React.useMemo(() => !!(grsaiProxy?.enabled && grsaiProxy?.hasApiKey && grsaiProxy?.baseUrl), [grsaiProxy])
  const grsaiCreditsFormatted = React.useMemo(() => {
    if (typeof grsaiCredits === 'number') {
      try {
        return grsaiCredits.toLocaleString()
      } catch {
        return String(grsaiCredits)
      }
    }
    return null
  }, [grsaiCredits])
  const grsaiCreditsDisplay = React.useMemo(() => {
    if (typeof grsaiCredits === 'number') {
      const s = grsaiCreditsFormatted || String(grsaiCredits)
      if (s.length > 6) {
        return { text: `${s.slice(0, 6)}…`, full: s }
      }
      return { text: s, full: s }
    }
    if (grsaiCreditsLoading) return { text: '加载中…', full: '加载中…' }
    return { text: '--', full: '--' }
  }, [grsaiCredits, grsaiCreditsFormatted, grsaiCreditsLoading])
  const grsaiStatusGroups = React.useMemo(() => {
    const map = new Map<string, GrsaiStatusModel[]>()
    GRSAI_STATUS_MODELS.forEach((model) => {
      if (!map.has(model.group)) {
        map.set(model.group, [])
      }
      map.get(model.group)!.push(model)
    })
    return Array.from(map.entries()).map(([group, models]) => ({ group, models }))
  }, [])

  React.useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (useUIStore.getState().isDirty) {
        e.preventDefault(); e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [])

  const loadGrsaiProxyConfig = React.useCallback(async () => {
    try {
      const cfg = await getProxyConfig(GRSAI_PROXY_VENDOR)
      setGrsaiProxy(cfg)
      return cfg
    } catch (error) {
      console.error('加载 grsai 代理配置失败', error)
      setGrsaiProxy(null)
      return null
    }
  }, [])

  const fetchGrsaiCredits = React.useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!isGrsaiProxyActive) return
      setGrsaiCreditsLoading(true)
      if (!opts?.silent) setGrsaiCreditsError(null)
      try {
        const resp = await getProxyCredits(GRSAI_PROXY_VENDOR)
        setGrsaiCredits(typeof resp?.credits === 'number' ? resp.credits : 0)
        setGrsaiCreditsError(null)
      } catch (error: any) {
        const msg = error?.message || '获取积分失败'
        setGrsaiCreditsError(msg)
        if (!opts?.silent) {
          notifications.show({ color: 'red', title: '获取积分失败', message: msg })
        }
      } finally {
        setGrsaiCreditsLoading(false)
      }
    },
    [isGrsaiProxyActive],
  )

  const fetchGrsaiStatuses = React.useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!isGrsaiProxyActive) return
      setGrsaiStatusLoading(true)
      setGrsaiStatusError(null)
      try {
        const entries = await Promise.all(
          GRSAI_STATUS_MODELS.map(async (model) => {
            try {
              const result = await getProxyModelStatus(GRSAI_PROXY_VENDOR, model.value)
              return [model.value, { status: !!result.status, error: result.error || '' }] as const
            } catch (error: any) {
              const msg = error?.message || '查询失败'
              return [model.value, { status: false, error: msg }] as const
            }
          }),
        )
        const next = Object.fromEntries(entries) as Record<string, { status: boolean; error?: string }>
        setGrsaiStatuses(next)
      } catch (error: any) {
        const msg = error?.message || '获取模型状态失败'
        setGrsaiStatusError(msg)
        if (!opts?.silent) {
          notifications.show({ color: 'red', title: '获取模型状态失败', message: msg })
        }
      } finally {
        setGrsaiStatusLoading(false)
      }
    },
    [isGrsaiProxyActive],
  )

  React.useEffect(() => {
    // 登录用户变化时，重新拉取 grsai 代理配置；未登录则清空本地状态
    if (!auth.user) {
      setGrsaiProxy(null)
      setGrsaiCredits(null)
      setGrsaiCreditsError(null)
      setGrsaiStatuses({})
      setGrsaiStatusError(null)
      setStatusPopoverOpened(false)
      return
    }
    loadGrsaiProxyConfig().catch(() => {})
  }, [auth.user?.sub, loadGrsaiProxyConfig])

  React.useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<ProxyConfigDto | null>).detail ?? null
      setGrsaiProxy(detail)
    }
    window.addEventListener(GRSAI_PROXY_UPDATED_EVENT, handler)
    return () => window.removeEventListener(GRSAI_PROXY_UPDATED_EVENT, handler)
  }, [])

  React.useEffect(() => {
    if (!isGrsaiProxyActive) {
      setGrsaiCredits(null)
      setGrsaiCreditsError(null)
      setGrsaiStatuses({})
      setGrsaiStatusError(null)
      setStatusPopoverOpened(false)
      return
    }
    fetchGrsaiCredits({ silent: true })
  }, [isGrsaiProxyActive, fetchGrsaiCredits])

  React.useEffect(() => {
    if (statusPopoverOpened && isGrsaiProxyActive) {
      fetchGrsaiStatuses({ silent: true })
    }
  }, [statusPopoverOpened, isGrsaiProxyActive, fetchGrsaiStatuses])

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

    if (!auth.user) {
      useUIStore.getState().setSoraVideoBaseUrl(null)
      return
    }

    loadVideoEndpoint()
    return () => {
      canceled = true
    }
  }, [auth.user?.sub])

  // Sora 视频去水印工具（基于 sora2api /get-sora-link）
  const [unwatermarkOpen, setUnwatermarkOpen] = React.useState(false)
  const [unwatermarkUrl, setUnwatermarkUrl] = React.useState('')
  const [unwatermarkLoading, setUnwatermarkLoading] = React.useState(false)
  const [unwatermarkError, setUnwatermarkError] = React.useState<string | null>(null)
  const [unwatermarkResult, setUnwatermarkResult] = React.useState<string | null>(null)
  const openPreview = useUIStore(s => s.openPreview)

  const handleOpenUnwatermark = React.useCallback(() => {
    setUnwatermarkError(null)
    setUnwatermarkResult(null)
    setUnwatermarkUrl('')
    setUnwatermarkOpen(true)
  }, [])

  // 角色创建（Sora2API / grsai）
  React.useEffect(() => {
    if (!characterCreatorRequest?.timestamp) return
    const payload = characterCreatorRequest.payload
    if (!payload) {
      clearCharacterCreatorRequest()
      return
    }
    const vendor = (payload.videoVendor || '').toLowerCase()
    const isSora2Api = vendor === 'sora2api' || vendor === 'grsai'
    if (!isSora2Api) {
      toast('当前只支持 Sora2API / grsai 角色创建', 'error')
      clearCharacterCreatorRequest()
      return
    }
    const timestamps = payload.clipRange
      ? `${Math.max(0, payload.clipRange.start).toFixed(2)},${Math.max(
          payload.clipRange.start,
          payload.clipRange.end,
        ).toFixed(2)}`
      : '0,3'
    const videoUrl =
      (typeof payload.videoUrl === 'string' && payload.videoUrl.trim()) ||
      null
    if (!videoUrl) {
      toast('缺少视频 URL，无法创建角色', 'error')
      clearCharacterCreatorRequest()
      return
    }
    let disposed = false
    const run = async () => {
      try {
        notifications.show({
          id: 'character-create',
          title: '提交角色创建',
          message: '正在调用 Sora2API 创建角色…',
          loading: true,
        })
    const created = await uploadSora2ApiCharacter({
      url: videoUrl,
      timestamps,
      webHook: '-1',
      shutProgress: false,
      vendor: vendor === 'grsai' ? 'grsai' : 'sora2api',
    })
        if (disposed) return
        const taskId = created?.id || created?.taskId || null
        if (!taskId) {
          throw new Error('上游未返回任务 ID')
        }
        notifications.update({
          id: 'character-create',
          title: '已创建角色任务',
          message: vendor === 'grsai' ? '上游已返回创建结果' : `任务 ID：${taskId}，开始轮询结果…`,
          loading: vendor !== 'grsai',
        })

        if (vendor === 'grsai') {
          const characterId =
            created?.character_id ||
            created?.characterId ||
            (Array.isArray(created?.results) && (created as any).results[0]?.character_id) ||
            taskId
          const msg = characterId ? `创建成功，角色 ID：${characterId}` : '创建完成'
          notifications.update({
            id: 'character-create',
            title: '角色创建完成',
            message: msg,
            loading: false,
            color: characterId ? 'teal' : 'yellow',
          })
          return
        }

        let attempts = 0
        let done = false
        while (!done && attempts < 40 && !disposed) {
          attempts += 1
          await new Promise((r) => setTimeout(r, 2000))
          try {
            const res = await fetchSora2ApiCharacterResult(taskId)
            const status = (res?.status || '').toLowerCase()
            if (status !== 'running') {
              done = true
              const characterId =
                res?.characterId ||
                (Array.isArray(res?.results) && res.results[0]?.character_id) ||
                res?.raw?.results?.[0]?.character_id
              const msg = characterId
                ? `创建成功，角色 ID：${characterId}`
                : '创建完成'
              notifications.update({
                id: 'character-create',
                title: '角色创建完成',
                message: msg,
                loading: false,
                color: characterId ? 'teal' : 'yellow',
              })
              return
            }
          } catch (err: any) {
            if (attempts > 3) {
              throw err
            }
          }
        }
        if (!disposed) {
          notifications.update({
            id: 'character-create',
            title: '角色创建超时',
            message: '请稍后在角色列表查看结果',
            loading: false,
            color: 'yellow',
          })
        }
      } catch (err: any) {
        if (disposed) return
        notifications.update({
          id: 'character-create',
          title: '创建角色失败',
          message: err?.message || '未知错误',
          loading: false,
          color: 'red',
        })
      } finally {
        if (!disposed) clearCharacterCreatorRequest()
      }
    }
    run().catch(() => {})
    return () => {
      disposed = true
    }
  }, [characterCreatorRequest, clearCharacterCreatorRequest])

  const handleRunUnwatermark = React.useCallback(async () => {
    const rawUrl = unwatermarkUrl.trim()
    if (!rawUrl) {
      setUnwatermarkError('请输入 Sora 分享链接（https://sora.chatgpt.com/p/s_xxx）')
      return
    }
    setUnwatermarkError(null)
    setUnwatermarkLoading(true)
    setUnwatermarkResult(null)
    try {
      const { downloadUrl } = await unwatermarkSoraVideo(rawUrl)
      setUnwatermarkResult(downloadUrl.trim())
    } catch (err: any) {
      setUnwatermarkError(err?.message || '解析失败，请稍后重试')
    } finally {
      setUnwatermarkLoading(false)
    }
  }, [unwatermarkUrl])

  // 初始化时：根据 URL 中的 projectId 选择项目；否则默认第一个项目
  React.useEffect(() => {
    // 根据当前登录用户加载其项目；退出登录时清空项目和画布
    if (!auth.user) {
      setProjects([])
      setCurrentProject(null)
      useRFStore.setState({ nodes: [], edges: [], nextId: 1 })
      setCurrentFlow({ id: null, name: '未命名', source: 'local' })
      setDirty(false)
      return
    }

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
        } else if (!ps.length) {
          // 没有任何项目时清空当前项目与画布
          setCurrentProject(null)
          useRFStore.setState({ nodes: [], edges: [], nextId: 1 })
          setCurrentFlow({ id: null, name: '未命名', source: 'local' })
          setDirty(false)
        }
      })
      .catch(() => {
        // 加载失败时保持现有状态，不影响当前会话
      })
  }, [auth.user?.sub, setCurrentProject, setCurrentFlow, setDirty])

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

  const autoResumeSora2ApiTasks = React.useCallback(() => {
    try {
      const state = useRFStore.getState()
      const nodes = (state.nodes || []) as any[]
      if (!nodes.length) return
      const globalAny = window as any
      if (!globalAny.__sora2apiAutoResumed) {
        globalAny.__sora2apiAutoResumed = new Set<string>()
      }
      const resumed: Set<string> = globalAny.__sora2apiAutoResumed

      nodes.forEach((n) => {
        const data: any = n.data || {}
        const vendor = (data.videoModelVendor || '').toLowerCase()
        const taskId = typeof data.videoTaskId === 'string' ? data.videoTaskId.trim() : ''
        const status = (data.status as string | undefined) || ''
        const isPendingStatus = status === 'running' || status === 'queued'
        if (vendor !== 'sora2api') return
        if (!taskId || !taskId.startsWith('task_')) return
        if (!isPendingStatus) return
        if (resumed.has(n.id)) return
        resumed.add(n.id)
        // 自动重启该节点的远程任务（runNodeRemote 会内部复用既有 taskId）
        void runNodeRemote(n.id, useRFStore.getState, useRFStore.setState)
      })
    } catch {
      // ignore auto-resume errors
    }
  }, [])

  // When switching project, sync flow name to project name and clear current flow id (project即工作流)
  React.useEffect(() => {
    if (currentProject?.name) setCurrentFlow({ id: null, name: currentProject.name })
  }, [currentProject?.id])

  // Auto load latest project flow on project switch
  React.useEffect(() => {
    const pid = currentProject?.id
    if (!pid) return
    listProjectFlows(pid)
      .then((list) => {
        if (list.length > 0) {
          const f = list[0]
          const data: any = f.data || {}
          useRFStore.setState({
            nodes: Array.isArray(data.nodes) ? data.nodes : [],
            edges: Array.isArray(data.edges) ? data.edges : [],
          })
          setCurrentFlow({ id: f.id, name: f.name, source: 'server' })
          setDirty(false)
        } else {
          // empty project -> clear canvas
          useRFStore.setState({ nodes: [], edges: [], nextId: 1 })
          setCurrentFlow({ id: null, name: currentProject?.name || '未命名', source: 'server' })
          setDirty(false)
        }
        // 项目流加载完成后，检查是否有未完成的 Sora2API 视频任务并自动恢复轮询
        autoResumeSora2ApiTasks()
      })
      .catch(() => {})
  }, [currentProject?.id, autoResumeSora2ApiTasks])

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
      notifications.update({ id: nid, title: $('已保存'), message: $t('项目「{{name}}」已保存', { name: proj!.name }), loading: false, autoClose: 1500, color: 'green' })
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
    // 将 grsai 积分刷新函数挂到全局，供任务执行后调用
    ;(window as any).refreshGrsaiCredits = (opts?: { silent?: boolean }) => {
      if (!isGrsaiProxyActive) return
      fetchGrsaiCredits(opts)
    }
  }, [saving, currentFlow, currentProject, isGrsaiProxyActive, fetchGrsaiCredits])

  const headerHeight = langGraphChatOpen ? 0 : 56

  return (
    <AppShell
      data-compact={'false'}
      header={{ height: headerHeight }}
      padding={0}
      styles={{
        main: { paddingTop: headerHeight, paddingLeft: 0, paddingRight: 0, background: 'var(--mantine-color-body)' }
      }}
    >
      {!langGraphChatOpen && (
      <AppShell.Header>
        <Group justify="space-between" p="sm">
          <Group>
            <Image src="/weblogo.png" alt="TapCanvas logo" h={28} fit="contain" />
            <Title order={4}>TapCanvas</Title>
            {isDirty && (<Badge color="red" variant="light">{$('未保存')}</Badge>)}
          </Group>
          <Group gap="xs">
            <TextInput size="xs" placeholder={$('项目名')} value={currentProject?.name || ''} onChange={(e)=> setCurrentProject({ ...(currentProject||{}), name: e.currentTarget.value })} style={{ width: 260 }} onBlur={async ()=>{ if (currentProject?.id && currentProject.name) await upsertProject({ id: currentProject.id, name: currentProject.name }) }} />
            <Button size="xs" onClick={doSave} disabled={!isDirty} loading={saving}>{$('保存')}</Button>
            {isGrsaiProxyActive && (
              <Group gap={4} align="center">
                <Badge color="grape" variant="light" size="sm">
                  grsai 积分
                </Badge>
                <Tooltip label={grsaiCreditsDisplay.full} disabled={grsaiCreditsDisplay.text === grsaiCreditsDisplay.full || !grsaiCreditsDisplay.full}>
                  <Text size="sm" fw={600} style={{ maxWidth: 80 }}>
                    {grsaiCreditsDisplay.text}
                  </Text>
                </Tooltip>
                <Tooltip label="刷新积分">
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    aria-label="刷新 grsai 积分"
                    onClick={() => {
                      if (!grsaiCreditsLoading) fetchGrsaiCredits()
                    }}
                  >
                    {grsaiCreditsLoading ? <Loader size="xs" /> : <IconRefresh size={16} />}
                  </ActionIcon>
                </Tooltip>
                {grsaiCreditsError && (
                  <Tooltip label={grsaiCreditsError}>
                    <IconAlertCircle size={16} color="var(--mantine-color-red-5)" />
                  </Tooltip>
                )}
                <Popover
                  width={260}
                  position="bottom-end"
                  withArrow
                  shadow="md"
                  opened={statusPopoverOpened}
                  onChange={setStatusPopoverOpened}
                >
                  <Popover.Target>
                    <Tooltip label="查看模型状态">
                      <ActionIcon
                        size="sm"
                        variant="subtle"
                        aria-label="查看 grsai 模型状态"
                        onClick={() => setStatusPopoverOpened((v) => !v)}
                      >
                        {grsaiStatusLoading ? <Loader size="xs" /> : <IconHeartbeat size={16} />}
                      </ActionIcon>
                    </Tooltip>
                  </Popover.Target>
                  <Popover.Dropdown>
                    <Stack gap={6} style={{ minWidth: 220 }}>
                      <Group justify="space-between" align="center">
                        <Text size="sm" fw={600}>
                          Veo3 状态
                        </Text>
                        <Tooltip label="刷新模型状态">
                          <ActionIcon
                            size="sm"
                            variant="subtle"
                            aria-label="刷新 grsai 模型状态"
                            onClick={() => {
                              if (!grsaiStatusLoading) fetchGrsaiStatuses()
                            }}
                          >
                            {grsaiStatusLoading ? <Loader size="xs" /> : <IconRefresh size={14} />}
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                      {grsaiStatusError && (
                        <Text size="xs" c="red">
                          {grsaiStatusError}
                        </Text>
                      )}
                      {grsaiStatusGroups.map(({ group, models }) => (
                        <Stack key={group} gap={4}>
                          <Text size="xs" c="dimmed" fw={600}>
                            {group}
                          </Text>
                          {models.map((model) => {
                            const info = grsaiStatuses[model.value]
                            const color = !info ? 'gray' : info.status ? 'teal' : 'red'
                            const label = !info ? '待查询' : info.status ? '正常' : '异常'
                            return (
                              <div key={model.value}>
                                <Group justify="space-between" align="center">
                                  <Text size="xs">{model.label}</Text>
                                  <Badge size="xs" color={color} variant="light">
                                    {label}
                                  </Badge>
                                </Group>
                                {!info?.status && info?.error && (
                                  <Text size="xs" c="dimmed">
                                    {info.error}
                                  </Text>
                                )}
                              </div>
                            )
                          })}
                        </Stack>
                      ))}
                    </Stack>
                  </Popover.Dropdown>
                </Popover>
              </Group>
            )}
            <Button
              size="xs"
              variant="subtle"
              onClick={handleOpenUnwatermark}
            >
              Sora 视频去水印
            </Button>
            <Button
              size="xs"
              variant="subtle"
              component="a"
              href="/tapshow"
            >
              TapShow
            </Button>
            <Button
              size="xs"
              variant="subtle"
              component="a"
              href="https://webcut.beqlee.icu/"
              target="_blank"
              rel="noopener noreferrer"
            >
              在线剪辑
            </Button>
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
      )}

      {/* 移除左侧固定栏，改为悬浮灵动岛样式 */}

      <AppShell.Main>
        <Box style={{ height: `calc(100vh - ${headerHeight}px)`, width: '100vw' }} onClick={(e)=>{
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
      <Modal
        opened={unwatermarkOpen}
        onClose={() => {
          setUnwatermarkOpen(false)
          setUnwatermarkError(null)
          setUnwatermarkResult(null)
        }}
        title="Sora 视频去水印"
        centered
        size="lg"
      >
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            输入 Sora 分享链接（例如：https://sora.chatgpt.com/p/s_xxxxx），解析出无水印的视频地址并预览/下载。
          </Text>
          <TextInput
            placeholder="粘贴 Sora 分享链接"
            value={unwatermarkUrl}
            onChange={(e) => setUnwatermarkUrl(e.currentTarget.value)}
          />
          {unwatermarkError && (
            <Text size="xs" c="red">
              {unwatermarkError}
            </Text>
          )}
          <Group justify="flex-end">
            <Button
              size="xs"
              variant="default"
              loading={unwatermarkLoading}
              onClick={handleRunUnwatermark}
            >
              解析无水印地址
            </Button>
          </Group>
          {unwatermarkResult && (
            <Stack gap="xs">
              <Text size="xs" c="dimmed">
                已解析的无水印播放地址：
              </Text>
              <Text size="xs" style={{ wordBreak: 'break-all' }}>
                {unwatermarkResult}
              </Text>
              <video
                src={unwatermarkResult}
                controls
                style={{
                  width: '100%',
                  maxHeight: '60vh',
                  borderRadius: 8,
                  background: '#000',
                }}
              />
              <Group justify="flex-end" gap="xs">
                <Button
                  size="xs"
                  variant="subtle"
                  onClick={() => {
                    if (!unwatermarkResult) return
                    openPreview({
                      url: unwatermarkResult,
                      kind: 'video',
                      name: 'Sora 无水印视频',
                    })
                  }}
                >
                  全屏预览
                </Button>
                <Button
                  size="xs"
                  variant="light"
                  onClick={() => {
                    if (!unwatermarkResult) return
                    const a = document.createElement('a')
                    a.href = unwatermarkResult
                    a.download = `sora-video-${Date.now()}.mp4`
                    document.body.appendChild(a)
                    a.click()
                    a.remove()
                  }}
                >
                  下载视频
                </Button>
              </Group>
            </Stack>
          )}
        </Stack>
      </Modal>
      <ToastHost />
      <FloatingNav />
      <AddNodePanel />
      <TemplatePanel />
      <ProjectPanel />
      <AccountPanel />
      <AssetPanel />
      <TapshowPanel />
      <ModelPanel />
      <HistoryPanel />
      <ParamModal />
      <PreviewModal />
      <CharacterCreatorModal />
      <VideoTrimModalHost />
      {subflowNodeId && (<SubflowEditor nodeId={subflowNodeId} onClose={closeSubflow} />)}
      {libraryFlowId && (<LibraryEditor flowId={libraryFlowId} onClose={closeLibraryFlow} />)}
    </AppShell>
  )
}

function isTapshowRoute(): boolean {
  if (typeof window === 'undefined') return false
  const path = window.location.pathname || ''
  return path === '/tapshow' || path.startsWith('/tapshow/')
}

function isShareRoute(): boolean {
  if (typeof window === 'undefined') return false
  const path = window.location.pathname || ''
  return path === '/share' || path.startsWith('/share/')
}

function isStatsRoute(): boolean {
  if (typeof window === 'undefined') return false
  const path = window.location.pathname || ''
  return path === '/stats' || path.startsWith('/stats/')
}

export default function App(): JSX.Element {
  if (isTapshowRoute()) {
    return <TapshowFullPage />
  }
  if (isShareRoute()) {
    return <ShareFullPage />
  }
  if (isStatsRoute()) {
    return <StatsFullPage />
  }
  return <CanvasApp />
}
