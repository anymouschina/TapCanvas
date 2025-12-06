import React from 'react'
import { Paper, Title, Text, Button, Group, Stack, Transition, Modal, TextInput, Badge, Switch, Textarea, ActionIcon, Tooltip, Select, Alert, Checkbox } from '@mantine/core'
import { IconDownload, IconUpload, IconTrash } from '@tabler/icons-react'
import { notifications } from '@mantine/notifications'
import { useUIStore } from './uiStore'
import { calculateSafeMaxHeight } from './utils/panelPosition'
import {
  deleteModelToken,
  listModelEndpoints,
  listModelProviders,
  listModelTokens,
  listModelProfiles,
  type ModelProfileDto,
  type ProfileKind,
  upsertModelEndpoint,
  upsertModelProvider,
  upsertModelToken,
  upsertModelProfile,
  type ModelProviderDto,
  type ModelTokenDto,
  type ModelEndpointDto,
  deleteModelProfile,
  getProxyConfig,
  upsertProxyConfig,
  type ProxyConfigDto,
  listAvailableModels,
  type AvailableModelDto,
} from '../api/server'
import { notifyModelOptionsRefresh, MODEL_REFRESH_EVENT } from '../config/useModelOptions'
import { TEXT_MODELS, IMAGE_MODELS, VIDEO_MODELS } from '../config/models'
import { GRSAI_PROXY_UPDATED_EVENT, GRSAI_PROXY_VENDOR } from '../constants/grsai'
const PROFILE_KIND_LABELS: Record<ProfileKind, string> = {
  chat: '文本',
  prompt_refine: '指令优化',
  text_to_image: '图片',
  image_to_prompt: '图像理解',
  image_to_video: '图像转视频',
  text_to_video: '视频',
  image_edit: '图像编辑',
}

const PROFILE_KIND_OPTIONS: Array<{ value: ProfileKind; label: string }> = [
  { value: 'chat', label: '文本模型' },
  { value: 'prompt_refine', label: '指令优化' },
  { value: 'text_to_image', label: '图片模型' },
  { value: 'text_to_video', label: '视频模型' },
  { value: 'image_to_prompt', label: '图像理解' },
  { value: 'image_edit', label: '图像编辑' },
]

const PROXY_TARGET_OPTIONS = [
  { value: 'sora', label: 'Sora 视频' },
  { value: 'openai', label: 'OpenAI / GPT' },
  { value: 'gemini', label: 'Google Gemini' },
  { value: 'veo', label: 'Veo (GRSAI)' },
]
const PROXY_HOST_PRESETS = [
  { label: '海外节点', value: 'https://api.grsai.com' },
  { label: '国内直连', value: 'https://grsai.dakka.com.cn' },
]

type PredefinedModel = { value: string; label: string; kind: ProfileKind }

function getPredefinedModelsForVendor(vendor: string | undefined): PredefinedModel[] {
  if (!vendor) return []
  const text = TEXT_MODELS.filter((m) => m.vendor === vendor).map((m) => ({ value: m.value, label: m.label, kind: 'chat' as ProfileKind }))
  const image = IMAGE_MODELS.filter((m) => m.vendor === vendor).map((m) => ({ value: m.value, label: m.label, kind: 'text_to_image' as ProfileKind }))
  const video = VIDEO_MODELS.filter((m) => m.vendor === vendor).map((m) => ({ value: m.value, label: m.label, kind: 'text_to_video' as ProfileKind }))
  return [...text, ...image, ...video]
}

const dedupePresets = (models: PredefinedModel[]): PredefinedModel[] => {
  const seen = new Set<string>()
  const result: PredefinedModel[] = []
  for (const model of models) {
    const key = model.value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(model)
  }
  return result
}

const sortPresets = (models: PredefinedModel[]): PredefinedModel[] =>
  [...models].sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'))

const mergePresetLists = (base: PredefinedModel[], extra: PredefinedModel[]): PredefinedModel[] => {
  if (!extra.length) return base
  return dedupePresets([...base, ...extra])
}

const buildVendorPresetMap = (items: AvailableModelDto[]): Record<string, PredefinedModel[]> => {
  const grouped: Record<string, PredefinedModel[]> = {}
  for (const item of items) {
    if (!item) continue
    const vendor = typeof item.vendor === 'string' && item.vendor.trim() ? item.vendor.trim().toLowerCase() : ''
    if (!vendor) continue
    const rawValue =
      (typeof item.value === 'string' && item.value.trim()) ||
      (typeof (item as any).id === 'string' && (item as any).id.trim()) ||
      null
    if (!rawValue) continue
    const value = rawValue.trim()
    if (!value.toLowerCase().includes('gpt')) continue
    const label = typeof item.label === 'string' && item.label.trim() ? item.label.trim() : value
    if (!grouped[vendor]) grouped[vendor] = []
    grouped[vendor].push({ value, label, kind: 'chat' })
  }
  Object.keys(grouped).forEach((key) => {
    grouped[key] = sortPresets(dedupePresets(grouped[key]))
  })
  return grouped
}

export default function ModelPanel(): JSX.Element | null {
  const active = useUIStore((s) => s.activePanel)

  // 导出模型配置
  const handleExport = async () => {
    try {
      // 获取认证token
      const token = localStorage.getItem('tap_token')
      if (!token) {
        throw new Error('用户未登录，无法导出配置')
      }

      const API_BASE = (import.meta as any).env?.VITE_API_BASE || 'http://localhost:3000'
      const response = await fetch(`${API_BASE}/models/export`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`导出失败 (${response.status}): ${errorText}`)
      }

      let data
      try {
        data = await response.json()
      } catch (jsonError) {
        console.error('Failed to parse JSON:', jsonError)
        throw new Error('服务器返回的不是有效的JSON数据')
      }

      console.log('Export data preview:', {
        version: data.version,
        providerCount: data.providers?.length || 0,
        responseType: response.headers.get('content-type'),
        responseStatus: response.status
      })

      // 验证导出的数据
      if (!data || typeof data !== 'object') {
        throw new Error('导出的数据格式不正确')
      }

      if (!data.version || !data.providers) {
        throw new Error('导出的数据缺少必要字段')
      }

      // 创建下载链接
      const jsonStr = JSON.stringify(data, null, 2)
      const blob = new Blob([jsonStr], { type: 'application/json' })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      const fileName = `model-config-${new Date().toISOString().split('T')[0]}.json`
      link.download = fileName
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)

      notifications.show({
        color: 'green',
        title: '导出成功',
        message: `模型配置已导出为 ${fileName}，包含 ${data.providers.length} 个提供商`
      })
    } catch (error) {
      console.error('Export error:', error)
      notifications.show({
        color: 'red',
        title: '导出失败',
        message: error instanceof Error ? error.message : '未知错误'
      })
    }
  }

  const handleClearAll = async () => {
    if (clearingAll) return
    if (!window.confirm('确定要清空所有模型配置吗？此操作不可撤销。')) return
    setClearingAll(true)
    try {
      const providerList = providers.length ? providers : await listModelProviders()
      await Promise.all(
        providerList.map(async (provider) => {
          try {
            const providerTokens = await listModelTokens(provider.id)
            await Promise.all(providerTokens.map((token) => deleteModelToken(token.id).catch(() => {})))
            if (provider.baseUrl) {
              await upsertModelProvider({
                id: provider.id,
                name: provider.name,
                vendor: provider.vendor,
                baseUrl: null,
                sharedBaseUrl: false,
              })
            }
          } catch (err) {
            console.warn('Failed clearing provider', provider.name, err)
          }
        })
      )
      const refreshedProviders = await listModelProviders()
      setProviders(refreshedProviders)
      setTokens([])
      setGeminiTokens([])
      setAnthropicTokens([])
      setQwenTokens([])
      setOpenaiTokens([])
      setGeminiBaseUrl('')
      setAnthropicBaseUrl('')
      setAnthropicBaseShared(false)
      setOpenaiBaseUrl('')
      setOpenaiBaseShared(false)
      setVideosEndpoint(null)
      setVideoEndpoint(null)
      setSoraEndpoint(null)
      setSoraProxyEndpoint(null)
      setVideosUrl('')
      setVideoUrl('')
      setSoraUrl('')
      setSoraProxyUrl('')
      setProviderProfiles({})
      setSoraProxyShared(false)
      notifications.show({ color: 'green', title: '已清空', message: '所有模型配置与密钥已清空' })
    } catch (error) {
      notifications.show({
        color: 'red',
        title: '清空失败',
        message: error instanceof Error ? error.message : '未知错误'
      })
    } finally {
      setClearingAll(false)
    }
  }

  // 导入模型配置
  const handleImport = async (file: File) => {
    console.log('Import triggered for file:', file.name, 'Size:', file.size)

    try {
      // 验证文件类型
      if (!file.name.endsWith('.json')) {
        throw new Error('只支持JSON格式文件')
      }

      // 读取文件内容
      const text = await file.text()
      console.log('File content length:', text.length, 'First 100 chars:', text.substring(0, 100))

      // 验证JSON格式
      let data
      try {
        data = JSON.parse(text)
      } catch (parseError) {
        console.error('JSON parse error:', parseError)
        throw new Error('JSON格式错误：' + parseError.message)
      }

      // 验证数据结构
      if (!data.version || !data.providers) {
        console.error('Invalid data structure:', data)
        throw new Error('无效的配置文件格式')
      }

      console.log('Importing data:', {
        version: data.version,
        providerCount: data.providers?.length || 0,
        sampleProvider: data.providers?.[0]
      })

      // 获取认证token
      const token = localStorage.getItem('tap_token')
      console.log('Token exists:', !!token, 'Token length:', token?.length)
      if (!token) {
        throw new Error('用户未登录，无法导入配置')
      }

      const API_BASE = (import.meta as any).env?.VITE_API_BASE || 'http://localhost:3000'
      const importUrl = `${API_BASE}/models/import`
      console.log('Making import request to:', importUrl)

      const response = await fetch(importUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(data)
      })

      console.log('Import response status:', response.status, 'Headers:', Object.fromEntries(response.headers.entries()))

      if (!response.ok) {
        const errorText = await response.text()
        console.error('Import error response:', errorText)
        throw new Error(`服务器错误 (${response.status}): ${errorText}`)
      }

      const result = await response.json()
      console.log('Import response data:', result)

      // 验证响应数据结构
      if (!result || typeof result !== 'object') {
        throw new Error('服务器返回了无效的响应数据')
      }

      if (result.success) {
        notifications.show({
          color: 'green',
          title: '导入成功',
          message: `导入完成：提供商 ${result.result.imported.providers} 个，Token ${result.result.imported.tokens} 个，端点 ${result.result.imported.endpoints} 个`
        })

        // 刷新所有数据
        const refreshAllData = async () => {
          try {
            const ps = await listModelProviders()
            setProviders(ps)

            // 刷新Sora数据
            let sora = ps.find((p) => p.vendor === 'sora')
            if (!sora) {
              sora = await upsertModelProvider({ name: 'Sora', vendor: 'sora' })
              setProviders((prev) => [...prev, sora!])
            }
            setSoraProvider(sora)
            const soraEndpoints = await listModelEndpoints(sora.id)
            const soraEpsByKey: Record<string, ModelEndpointDto> = {}
            soraEndpoints.forEach((e) => (soraEpsByKey[e.key] = e))
            setVideosEndpoint(soraEpsByKey['videos'] || null)
            setVideoEndpoint(soraEpsByKey['video'] || null)
            setSoraEndpoint(soraEpsByKey['sora'] || null)
            setVideosUrl(soraEpsByKey['videos']?.baseUrl || '')
            setVideoUrl(soraEpsByKey['video']?.baseUrl || '')
            setSoraUrl(soraEpsByKey['sora']?.baseUrl || '')
            setVideosShared(!!soraEpsByKey['videos']?.shared)
            setVideoShared(!!soraEpsByKey['video']?.shared)
            setSoraShared(!!soraEpsByKey['sora']?.shared)
            useUIStore.getState().setSoraVideoBaseUrl(soraEpsByKey['videos']?.baseUrl || null)
            const soraTokens = await listModelTokens(sora.id)
            setTokens(soraTokens)

            // 刷新Gemini数据
            let gemini = ps.find((p) => p.vendor === 'gemini')
            if (gemini) {
              setGeminiProvider(gemini)
              setGeminiBaseUrl(gemini.baseUrl || '')
              const geminiTokenData = await listModelTokens(gemini.id)
              setGeminiTokens(geminiTokenData)
              await refreshProviderProfiles(gemini.id)
            }

            // 刷新Anthropic数据
            let anthropic = ps.find((p) => p.vendor === 'anthropic')
            if (!anthropic) {
              anthropic = await upsertModelProvider({ name: 'Anthropic', vendor: 'anthropic' })
              setProviders((prev) => [...prev, anthropic!])
            }
            if (anthropic) {
              setAnthropicProvider(anthropic)
              setAnthropicBaseUrl(anthropic.baseUrl || '')
              setAnthropicBaseShared(!!anthropic.sharedBaseUrl)
              const anthropicTokenData = await listModelTokens(anthropic.id)
              setAnthropicTokens(anthropicTokenData)
              await refreshProviderProfiles(anthropic.id)
            }

            // 刷新Qwen数据
            let qwen = ps.find((p) => p.vendor === 'qwen')
            if (qwen) {
              setQwenProvider(qwen)
              const qwenTokenData = await listModelTokens(qwen.id)
              setQwenTokens(qwenTokenData)
              await refreshProviderProfiles(qwen.id)
            }

            // 刷新 Veo 数据
            let veo = ps.find((p) => p.vendor === 'veo')
            if (!veo) {
              veo = await upsertModelProvider({ name: 'Veo (GRSAI)', vendor: 'veo' })
              setProviders((prev) => [...prev, veo!])
            }
            if (veo) {
              setVeoProvider(veo)
              setVeoBaseUrl(veo.baseUrl || '')
              const veoTokenData = await listModelTokens(veo.id)
              setVeoTokens(veoTokenData)
              await refreshProviderProfiles(veo.id)
            }

            // 刷新OpenAI数据
            let openai = ps.find((p) => p.vendor === 'openai')
            if (!openai) {
              openai = await upsertModelProvider({ name: 'OpenAI / Codex', vendor: 'openai' })
              setProviders((prev) => [...prev, openai!])
            }
            setOpenaiProvider(openai || null)
            if (openai) {
              setOpenaiBaseUrl(openai.baseUrl || '')
              setOpenaiBaseShared(!!openai.sharedBaseUrl)
              const openaiTokenData = await listModelTokens(openai.id)
              setOpenaiTokens(openaiTokenData)
              await refreshProviderProfiles(openai.id)
            } else {
              setOpenaiTokens([])
              setOpenaiBaseUrl('')
              setOpenaiBaseShared(false)
            }

          } catch (error) {
            console.error('Failed to refresh data:', error)
          }
        }

        refreshAllData()

        if (result.errors && Array.isArray(result.errors) && result.errors.length > 0) {
          console.warn('Import warnings:', result.errors)
          notifications.show({
            color: 'yellow',
            title: '部分导入失败',
            message: `遇到 ${result.errors.length} 个错误，请检查配置: ${result.errors.slice(0, 2).join(', ')}`
          })
        }
      } else {
        throw new Error(result.message || 'Import failed')
      }
    } catch (error) {
      console.error('Import error:', error)
      notifications.show({
        color: 'red',
        title: '导入失败',
        message: error instanceof Error ? error.message : '文件格式错误'
      })
    }
  }

  const setActivePanel = useUIStore((s) => s.setActivePanel)
  const anchorY = useUIStore((s) => s.panelAnchorY)
  const mounted = active === 'models'
  const [providers, setProviders] = React.useState<ModelProviderDto[]>([])
  const [clearingAll, setClearingAll] = React.useState(false)
  const [soraProvider, setSoraProvider] = React.useState<ModelProviderDto | null>(null)
  const [sora2apiProvider, setSora2apiProvider] = React.useState<ModelProviderDto | null>(null)
  const [tokens, setTokens] = React.useState<ModelTokenDto[]>([])
  const [modalOpen, setModalOpen] = React.useState(false)
  const [editingToken, setEditingToken] = React.useState<ModelTokenDto | null>(null)
  const [label, setLabel] = React.useState('')
  const [secret, setSecret] = React.useState('')
  const [userAgent, setUserAgent] = React.useState('')
  const [shared, setShared] = React.useState(false)
  const [videosEndpoint, setVideosEndpoint] = React.useState<ModelEndpointDto | null>(null)
  const [videoEndpoint, setVideoEndpoint] = React.useState<ModelEndpointDto | null>(null)
  const [soraEndpoint, setSoraEndpoint] = React.useState<ModelEndpointDto | null>(null)
  const [videosUrl, setVideosUrl] = React.useState('')
  const [videoUrl, setVideoUrl] = React.useState('')
  const [soraUrl, setSoraUrl] = React.useState('')
  const [videosShared, setVideosShared] = React.useState(false)
  const [videoShared, setVideoShared] = React.useState(false)
  const [soraShared, setSoraShared] = React.useState(false)
  const [proxyConfig, setProxyConfig] = React.useState<ProxyConfigDto | null>(null)
  const [proxyLoading, setProxyLoading] = React.useState(false)
  const [proxyModalOpen, setProxyModalOpen] = React.useState(false)
  const [proxyHost, setProxyHost] = React.useState('')
  const [proxyEnabled, setProxyEnabled] = React.useState(false)
  const [proxyEnabledVendors, setProxyEnabledVendors] = React.useState<string[]>([])
  const [proxyApiKey, setProxyApiKey] = React.useState('')
  const [proxyApiKeyTouched, setProxyApiKeyTouched] = React.useState(false)
  const [proxySaving, setProxySaving] = React.useState(false)
  const [sessionModalOpen, setSessionModalOpen] = React.useState(false)
  const [sessionJson, setSessionJson] = React.useState('')
  const [sessionError, setSessionError] = React.useState('')
  const [vendorModelPresets, setVendorModelPresets] = React.useState<Record<string, PredefinedModel[]>>({})
const [geminiProvider, setGeminiProvider] = React.useState<ModelProviderDto | null>(null)
const [geminiBaseUrl, setGeminiBaseUrl] = React.useState('')
const [geminiTokens, setGeminiTokens] = React.useState<ModelTokenDto[]>([])
const [geminiModalOpen, setGeminiModalOpen] = React.useState(false)
const [geminiEditingToken, setGeminiEditingToken] = React.useState<ModelTokenDto | null>(null)
const [geminiLabel, setGeminiLabel] = React.useState('')
const [geminiSecret, setGeminiSecret] = React.useState('')
const [geminiShared, setGeminiShared] = React.useState(false)
const [veoProvider, setVeoProvider] = React.useState<ModelProviderDto | null>(null)
const [veoBaseUrl, setVeoBaseUrl] = React.useState('')
const [veoTokens, setVeoTokens] = React.useState<ModelTokenDto[]>([])
const [veoModalOpen, setVeoModalOpen] = React.useState(false)
const [veoEditingToken, setVeoEditingToken] = React.useState<ModelTokenDto | null>(null)
const [veoLabel, setVeoLabel] = React.useState('')
const [veoSecret, setVeoSecret] = React.useState('')
const [veoShared, setVeoShared] = React.useState(false)
  const [anthropicProvider, setAnthropicProvider] = React.useState<ModelProviderDto | null>(null)
  const [anthropicBaseUrl, setAnthropicBaseUrl] = React.useState('')
  const [anthropicBaseShared, setAnthropicBaseShared] = React.useState(false)
  const [anthropicTokens, setAnthropicTokens] = React.useState<ModelTokenDto[]>([])
  const [anthropicModalOpen, setAnthropicModalOpen] = React.useState(false)
  const [anthropicEditingToken, setAnthropicEditingToken] = React.useState<ModelTokenDto | null>(null)
  const [anthropicLabel, setAnthropicLabel] = React.useState('')
  const [anthropicSecret, setAnthropicSecret] = React.useState('')
  const [anthropicShared, setAnthropicShared] = React.useState(false)
  const [qwenProvider, setQwenProvider] = React.useState<ModelProviderDto | null>(null)
  const [qwenTokens, setQwenTokens] = React.useState<ModelTokenDto[]>([])
  const [qwenModalOpen, setQwenModalOpen] = React.useState(false)
  const [qwenEditingToken, setQwenEditingToken] = React.useState<ModelTokenDto | null>(null)
  const [qwenLabel, setQwenLabel] = React.useState('')
  const [qwenSecret, setQwenSecret] = React.useState('')
  const [qwenShared, setQwenShared] = React.useState(false)
  const [openaiProvider, setOpenaiProvider] = React.useState<ModelProviderDto | null>(null)
  const [openaiBaseUrl, setOpenaiBaseUrl] = React.useState('')
  const [openaiBaseShared, setOpenaiBaseShared] = React.useState(false)
  const [openaiTokens, setOpenaiTokens] = React.useState<ModelTokenDto[]>([])
  const [openaiModalOpen, setOpenaiModalOpen] = React.useState(false)
  const [openaiEditingToken, setOpenaiEditingToken] = React.useState<ModelTokenDto | null>(null)
  const [openaiLabel, setOpenaiLabel] = React.useState('')
  const [openaiSecret, setOpenaiSecret] = React.useState('')
  const [openaiShared, setOpenaiShared] = React.useState(false)
  const [sora2apiBaseUrl, setSora2apiBaseUrl] = React.useState('')
  const [sora2apiTokens, setSora2apiTokens] = React.useState<ModelTokenDto[]>([])
  const [sora2apiModalOpen, setSora2apiModalOpen] = React.useState(false)
  const [sora2apiEditingToken, setSora2apiEditingToken] = React.useState<ModelTokenDto | null>(null)
  const [sora2apiLabel, setSora2apiLabel] = React.useState('')
  const [sora2apiSecret, setSora2apiSecret] = React.useState('')
  const [sora2apiShared, setSora2apiShared] = React.useState(false)
  const [providerProfiles, setProviderProfiles] = React.useState<Record<string, ModelProfileDto[]>>({})
  const [presetSelections, setPresetSelections] = React.useState<Record<string, string | null>>({})
  const [profileModal, setProfileModal] = React.useState<{ provider: ModelProviderDto; profile: ModelProfileDto | null } | null>(null)
  const [profileName, setProfileName] = React.useState('')
  const [profileModelKey, setProfileModelKey] = React.useState('')
  const [profileKind, setProfileKind] = React.useState<ProfileKind>('chat')
  const [profileSaving, setProfileSaving] = React.useState(false)

  const refreshProviderProfiles = React.useCallback(async (providerId: string) => {
    if (!providerId) return
    try {
      const list = await listModelProfiles({ providerId })
      setProviderProfiles((prev) => ({ ...prev, [providerId]: list }))
    } catch (error) {
      console.warn('Failed to load model profiles for provider', providerId, error)
    }
  }, [])

  React.useEffect(() => {
    if (!mounted) return
    listModelProviders()
      .then(async (ps) => {
        setProviders(ps)
        let sora = ps.find((p) => p.vendor === 'sora')
        if (!sora) {
          sora = await upsertModelProvider({ name: 'Sora', vendor: 'sora' })
          setProviders((prev) => [...prev, sora!])
        }
        setSoraProvider(sora)
        const eps = await listModelEndpoints(sora.id)
        const byKey: Record<string, ModelEndpointDto> = {}
        eps.forEach((e) => {
          byKey[e.key] = e
        })
        setVideosEndpoint(byKey.videos || null)
        setVideoEndpoint(byKey.video || null)
        setSoraEndpoint(byKey.sora || null)
        setVideosUrl(byKey.videos?.baseUrl || '')
        setVideoUrl(byKey.video?.baseUrl || '')
        setSoraUrl(byKey.sora?.baseUrl || '')
        setVideosShared(!!byKey.videos?.shared)
        setVideoShared(!!byKey.video?.shared)
        setSoraShared(!!byKey.sora?.shared)
        useUIStore.getState().setSoraVideoBaseUrl(byKey.videos?.baseUrl || null)
        const ts = await listModelTokens(sora.id)
        setTokens(ts)

        // 初始化 Sora2API 提供方（如不存在则创建）
        let sora2 = ps.find((p) => p.vendor === 'sora2api')
        if (!sora2) {
          sora2 = await upsertModelProvider({ name: 'Sora2API', vendor: 'sora2api' })
          setProviders((prev) => [...prev, sora2!])
        }
        setSora2apiProvider(sora2)
        setSora2apiBaseUrl(sora2.baseUrl || '')
        const sora2Tokens = await listModelTokens(sora2.id)
        setSora2apiTokens(sora2Tokens)
        await refreshProviderProfiles(sora2.id)

        // 初始化 Gemini 提供方（如不存在则创建）
        let gemini = ps.find((p) => p.vendor === 'gemini')
        if (!gemini) {
          gemini = await upsertModelProvider({ name: 'Gemini', vendor: 'gemini' })
          setProviders((prev) => [...prev, gemini!])
        }
        setGeminiProvider(gemini)
        setGeminiBaseUrl(gemini.baseUrl || '')
        const gTokens = await listModelTokens(gemini.id)
        setGeminiTokens(gTokens)
        await refreshProviderProfiles(gemini.id)

        // 初始化 Anthropic 提供方
        let anthropic = ps.find((p) => p.vendor === 'anthropic')
        if (!anthropic) {
          anthropic = await upsertModelProvider({ name: 'Anthropic', vendor: 'anthropic' })
          setProviders((prev) => [...prev, anthropic!])
        }
        setAnthropicProvider(anthropic)
        setAnthropicBaseUrl(anthropic.baseUrl || '')
        setAnthropicBaseShared(!!anthropic.sharedBaseUrl)
        const aTokens = await listModelTokens(anthropic.id)
        setAnthropicTokens(aTokens)
        await refreshProviderProfiles(anthropic.id)

        // 初始化 Qwen 提供方
        let qwen = ps.find((p) => p.vendor === 'qwen')
        if (!qwen) {
          qwen = await upsertModelProvider({ name: 'Qwen', vendor: 'qwen' })
          setProviders((prev) => [...prev, qwen!])
        }
        setQwenProvider(qwen)
        const qTokens = await listModelTokens(qwen.id)
        setQwenTokens(qTokens)
        await refreshProviderProfiles(qwen.id)

        // 初始化 Veo 提供方
        let veo = ps.find((p) => p.vendor === 'veo')
        if (!veo) {
          veo = await upsertModelProvider({ name: 'Veo (GRSAI)', vendor: 'veo' })
          setProviders((prev) => [...prev, veo!])
        }
        setVeoProvider(veo)
        setVeoBaseUrl(veo.baseUrl || '')
        const veoTokenData = await listModelTokens(veo.id)
        setVeoTokens(veoTokenData)
        await refreshProviderProfiles(veo.id)

        // 初始化 OpenAI 提供方
        let openai = ps.find((p) => p.vendor === 'openai')
        if (!openai) {
          openai = await upsertModelProvider({ name: 'OpenAI / Codex', vendor: 'openai' })
          setProviders((prev) => [...prev, openai!])
        }
        setOpenaiProvider(openai || null)
        setOpenaiBaseUrl(openai?.baseUrl || '')
        setOpenaiBaseShared(!!openai?.sharedBaseUrl)
        if (openai) {
          const openaiTokenData = await listModelTokens(openai.id)
          setOpenaiTokens(openaiTokenData)
          await refreshProviderProfiles(openai.id)
        } else {
          setOpenaiTokens([])
        }
      })
      .catch(() => {})
  }, [mounted, refreshProviderProfiles])

  const ensureSecretPresent = (value: string) => !!value?.trim()


  const openModalForNew = () => {
    setEditingToken(null)
    setLabel('')
    setSecret('')
    setUserAgent('')
    setShared(false)
    setModalOpen(true)
  }

  const handleSaveToken = async () => {
    if (!soraProvider) return
    const existingSecret = editingToken?.secretToken ?? ''
    const finalSecret = secret || existingSecret
    if (!ensureSecretPresent(finalSecret)) return
    const saved = await upsertModelToken({
      id: editingToken?.id,
      providerId: soraProvider.id,
      label: label || '未命名密钥',
      secretToken: finalSecret,
      userAgent: userAgent || null,
      shared,
    })
    const next = editingToken
      ? tokens.map((t) => (t.id === saved.id ? saved : t))
      : [...tokens, saved]
    setTokens(next)
    setModalOpen(false)
  }

  const handleDeleteToken = async (id: string) => {
    if (!confirm('确定删除该密钥吗？')) return
    await deleteModelToken(id)
    setTokens((prev) => prev.filter((t) => t.id !== id))
  }

  const openSora2ApiModalForNew = () => {
    setSora2apiEditingToken(null)
    setSora2apiLabel('')
    setSora2apiSecret('')
    setSora2apiShared(false)
    setSora2apiModalOpen(true)
  }

  const handleSaveSora2ApiToken = async () => {
    if (!sora2apiProvider) return
    const existingSecret = sora2apiEditingToken?.secretToken ?? ''
    const finalSecret = sora2apiSecret || existingSecret
    if (!ensureSecretPresent(finalSecret)) return
    const saved = await upsertModelToken({
      id: sora2apiEditingToken?.id,
      providerId: sora2apiProvider.id,
      label: sora2apiLabel || '未命名密钥',
      secretToken: finalSecret,
      userAgent: null,
      shared: sora2apiShared,
    })
    const next = sora2apiEditingToken
      ? sora2apiTokens.map((t) => (t.id === saved.id ? saved : t))
      : [...sora2apiTokens, saved]
    setSora2apiTokens(next)
    setSora2apiModalOpen(false)
  }

  const handleDeleteSora2ApiToken = async (id: string) => {
    if (!confirm('确定删除该密钥吗？')) return
    await deleteModelToken(id)
    setSora2apiTokens((prev) => prev.filter((t) => t.id !== id))
  }

const openGeminiModalForNew = () => {
  setGeminiEditingToken(null)
  setGeminiLabel('')
  setGeminiSecret('')
  setGeminiShared(false)
  setGeminiModalOpen(true)
}

const openVeoModalForNew = () => {
  setVeoEditingToken(null)
  setVeoLabel('')
  setVeoSecret('')
  setVeoShared(false)
  setVeoModalOpen(true)
}

const handleSaveGeminiToken = async () => {
  if (!geminiProvider) return
  const existingSecret = geminiEditingToken?.secretToken ?? ''
  const finalSecret = geminiSecret || existingSecret
  if (!ensureSecretPresent(finalSecret)) return
    const saved = await upsertModelToken({
      id: geminiEditingToken?.id,
      providerId: geminiProvider.id,
      label: geminiLabel || '未命名密钥',
      secretToken: finalSecret,
      userAgent: null,
      shared: geminiShared,
    })
    const next = geminiEditingToken
      ? geminiTokens.map((t) => (t.id === saved.id ? saved : t))
      : [...geminiTokens, saved]
    setGeminiTokens(next)
    setGeminiModalOpen(false)
  }

const handleDeleteGeminiToken = async (id: string) => {
  if (!confirm('确定删除该密钥吗？')) return
  await deleteModelToken(id)
  setGeminiTokens((prev) => prev.filter((t) => t.id !== id))
}

const handleSaveVeoToken = async () => {
  if (!veoProvider) return
  const existingSecret = veoEditingToken?.secretToken ?? ''
  const finalSecret = veoSecret || existingSecret
  if (!ensureSecretPresent(finalSecret)) return
  const saved = await upsertModelToken({
    id: veoEditingToken?.id,
    providerId: veoProvider.id,
    label: veoLabel || '未命名密钥',
    secretToken: finalSecret,
    shared: veoShared,
  })
  const next = veoEditingToken
    ? veoTokens.map((t) => (t.id === saved.id ? saved : t))
    : [...veoTokens, saved]
  setVeoTokens(next)
  setVeoModalOpen(false)
}

const handleDeleteVeoToken = async (id: string) => {
  if (!confirm('确定删除该密钥吗？')) return
  await deleteModelToken(id)
  setVeoTokens((prev) => prev.filter((t) => t.id !== id))
}

  const openAnthropicModalForNew = () => {
    setAnthropicEditingToken(null)
    setAnthropicLabel('')
    setAnthropicSecret('')
    setAnthropicShared(false)
    setAnthropicModalOpen(true)
  }

  const handleSaveAnthropicToken = async () => {
    if (!anthropicProvider) return
    const existingSecret = anthropicEditingToken?.secretToken ?? ''
    const finalSecret = anthropicSecret || existingSecret
    if (!ensureSecretPresent(finalSecret)) return
    const saved = await upsertModelToken({
      id: anthropicEditingToken?.id,
      providerId: anthropicProvider.id,
      label: anthropicLabel || '未命名密钥',
      secretToken: finalSecret,
      userAgent: null,
      shared: anthropicShared,
    })
    const next = anthropicEditingToken
      ? anthropicTokens.map((t) => (t.id === saved.id ? saved : t))
      : [...anthropicTokens, saved]
    setAnthropicTokens(next)
    setAnthropicModalOpen(false)
    notifyModelOptionsRefresh('anthropic')
  }

  const handleDeleteAnthropicToken = async (id: string) => {
    if (!confirm('确定删除该密钥吗？')) return
    await deleteModelToken(id)
    setAnthropicTokens((prev) => prev.filter((t) => t.id !== id))
    notifyModelOptionsRefresh('anthropic')
  }

  const openQwenModalForNew = () => {
    setQwenEditingToken(null)
    setQwenLabel('')
    setQwenSecret('')
    setQwenShared(false)
    setQwenModalOpen(true)
  }

  const handleSaveQwenToken = async () => {
    if (!qwenProvider) return
    const existingSecret = qwenEditingToken?.secretToken ?? ''
    const finalSecret = qwenSecret || existingSecret
    if (!ensureSecretPresent(finalSecret)) return
    const saved = await upsertModelToken({
      id: qwenEditingToken?.id,
      providerId: qwenProvider.id,
      label: qwenLabel || '未命名密钥',
      secretToken: finalSecret,
      userAgent: null,
      shared: qwenShared,
    })
    const next = qwenEditingToken
      ? qwenTokens.map((t) => (t.id === saved.id ? saved : t))
      : [...qwenTokens, saved]
    setQwenTokens(next)
    setQwenModalOpen(false)
  }

const handleDeleteQwenToken = async (id: string) => {
  if (!confirm('确定删除该密钥吗？')) return
  await deleteModelToken(id)
  setQwenTokens((prev) => prev.filter((t) => t.id !== id))
}

const handlePersistVeoBaseUrl = React.useCallback(async (nextBaseUrl: string) => {
  if (!veoProvider) return
  const saved = await upsertModelProvider({
    id: veoProvider.id,
    name: veoProvider.name,
    vendor: veoProvider.vendor,
    baseUrl: nextBaseUrl.trim() ? nextBaseUrl.trim() : null,
  })
  setVeoProvider(saved)
  setVeoBaseUrl(saved.baseUrl || '')
  await refreshProviderProfiles(saved.id)
}, [veoProvider, refreshProviderProfiles])

const handleApplyVeoHost = React.useCallback((host: string) => {
  setVeoBaseUrl(host)
  void handlePersistVeoBaseUrl(host)
}, [handlePersistVeoBaseUrl])

  const openOpenAIModalForNew = () => {
    setOpenaiEditingToken(null)
    setOpenaiLabel('')
    setOpenaiSecret('')
    setOpenaiShared(false)
    setOpenaiModalOpen(true)
  }

  const handleSaveOpenAIToken = async () => {
    if (!openaiProvider) return
    const existingSecret = openaiEditingToken?.secretToken ?? ''
    const finalSecret = openaiSecret || existingSecret
    if (!ensureSecretPresent(finalSecret)) return
    const saved = await upsertModelToken({
      id: openaiEditingToken?.id,
      providerId: openaiProvider.id,
      label: openaiLabel || '未命名密钥',
      secretToken: finalSecret,
      userAgent: null,
      shared: openaiShared,
    })
    const next = openaiEditingToken
      ? openaiTokens.map((t) => (t.id === saved.id ? saved : t))
      : [...openaiTokens, saved]
    setOpenaiTokens(next)
    setOpenaiModalOpen(false)
    notifyModelOptionsRefresh('openai')
  }

  const handleDeleteOpenAIToken = async (id: string) => {
    if (!confirm('确定删除该密钥吗？')) return
    await deleteModelToken(id)
    setOpenaiTokens((prev) => prev.filter((t) => t.id !== id))
    notifyModelOptionsRefresh('openai')
  }

  const openProfileModal = (
    provider: ModelProviderDto,
    profile?: ModelProfileDto | null,
    defaults?: { name?: string; modelKey?: string; kind?: ProfileKind },
  ) => {
    setProfileModal({ provider, profile: profile || null })
    setProfileName(profile?.name || defaults?.name || '')
    setProfileModelKey(profile?.modelKey || defaults?.modelKey || '')
    setProfileKind(profile?.kind || defaults?.kind || 'chat')
  }

  const handleSaveProfile = async () => {
    if (!profileModal) return
    const trimmedKey = profileModelKey.trim()
    if (!trimmedKey) {
      notifications.show({ color: 'red', title: '保存失败', message: '请输入模型 ID' })
      return
    }
    setProfileSaving(true)
    try {
      await upsertModelProfile({
        id: profileModal.profile?.id,
        providerId: profileModal.provider.id,
        name: profileName.trim() || trimmedKey,
        kind: profileKind,
        modelKey: trimmedKey,
      })
      await refreshProviderProfiles(profileModal.provider.id)
      setProfileModal(null)
      setProfileName('')
      setProfileModelKey('')
      setProfileKind('chat')
      notifications.show({ color: 'green', title: '已保存', message: '模型配置已更新' })
      notifyModelOptionsRefresh('all')
    } catch (error) {
      console.error('Failed to save profile', error)
      notifications.show({ color: 'red', title: '保存失败', message: error instanceof Error ? error.message : '未知错误' })
    } finally {
      setProfileSaving(false)
    }
  }

  const handleDeleteProfile = async (providerId: string, profileId: string) => {
    if (!confirm('确定删除该模型配置吗？')) return
    try {
      await deleteModelProfile(profileId)
      await refreshProviderProfiles(providerId)
      notifications.show({ color: 'green', title: '已删除', message: '模型配置已删除' })
      notifyModelOptionsRefresh('all')
    } catch (error) {
      console.error('Failed to delete profile', error)
      notifications.show({ color: 'red', title: '删除失败', message: error instanceof Error ? error.message : '未知错误' })
    }
  }

  const getVendorPresetList = React.useCallback(
    (vendor?: string) => {
      const base = getPredefinedModelsForVendor(vendor)
      if (!vendor) return base
      const vendorKey = vendor.toLowerCase()
      const extraPresets = vendorModelPresets[vendor] || vendorModelPresets[vendorKey] || []
      return mergePresetLists(base, extraPresets)
    },
    [vendorModelPresets],
  )

  const renderProviderProfiles = (provider: ModelProviderDto | null) => {
    if (!provider) return null
    const list = providerProfiles[provider.id] || []
    const presets = getVendorPresetList(provider.vendor)
    const selectOptions = [
      ...presets.map((opt) => ({
        value: `preset:${opt.value}`,
        label: `[预设] ${opt.label} · ${opt.value}`,
        type: 'preset' as const,
        preset: opt,
      })),
      ...list.map((profile) => ({
        value: `custom:${profile.id}`,
        label: `[自定义] ${profile.name} · ${profile.modelKey}`,
        type: 'custom' as const,
        profile,
      })),
    ]
    return (
      <Stack gap={4} mt="xs">
        <Group justify="flex-end" align="center">
          <Button size="xs" variant="subtle" onClick={() => openProfileModal(provider)}>
            新增模型
          </Button>
        </Group>
        {selectOptions.length > 0 && (
          <Select
            size="xs"
            placeholder="选择模型快速引用"
            data={selectOptions}
            value={presetSelections[provider.id] || null}
            maxDropdownHeight={160}
            onChange={(value) => {
              if (!value) return
              setPresetSelections((prev) => ({ ...prev, [provider.id]: value }))
              const selected = selectOptions.find((opt) => opt.value === value)
              if (!selected) return
              if (selected.type === 'preset') {
                openProfileModal(provider, null, {
                  name: selected.preset.label,
                  modelKey: selected.preset.value,
                  kind: selected.preset.kind,
                })
              } else if (selected.profile) {
                openProfileModal(provider, selected.profile)
              }
              setTimeout(() => {
                setPresetSelections((prev) => ({ ...prev, [provider.id]: null }))
              }, 0)
            }}
            searchable
            clearable
          />
        )}
        {list.length === 0 ? (
          <Text size="xs" c="dimmed">
            尚未配置模型 ID。
          </Text>
        ) : (
          list.map((profile) => (
            <Group
              key={profile.id}
              justify="space-between"
              align="center"
              style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '6px 8px' }}
            >
              <div>
                <Group gap={6}>
                  <Text size="sm">{profile.name}</Text>
                  <Badge size="xs" color="blue">
                    {PROFILE_KIND_LABELS[profile.kind] || profile.kind}
                  </Badge>
                </Group>
                <Text size="xs" c="dimmed">
                  {profile.modelKey}
                </Text>
              </div>
              <Group gap={4}>
                <Button size="xs" variant="subtle" onClick={() => openProfileModal(provider, profile)}>
                  编辑
                </Button>
                <Button size="xs" variant="light" color="red" onClick={() => handleDeleteProfile(provider.id, profile.id)}>
                  删除
                </Button>
              </Group>
            </Group>
          ))
        )}
      </Stack>
    )
  }


  const bulkShareTokens = async (
    provider: ModelProviderDto | null,
    list: ModelTokenDto[],
    sharedFlag: boolean,
    setter: React.Dispatch<React.SetStateAction<ModelTokenDto[]>>
  ) => {
    if (!provider || list.length === 0) return
    const updated: ModelTokenDto[] = []
    for (const t of list) {
      try {
        const saved = await upsertModelToken({
          id: t.id,
          providerId: provider.id,
          label: t.label,
          secretToken: t.secretToken,
          userAgent: t.userAgent ?? null,
          enabled: t.enabled,
          shared: sharedFlag,
        })
        updated.push(saved)
      } catch {
        updated.push(t)
      }
    }
    setter(updated)
    if (provider.vendor === 'anthropic') {
      notifyModelOptionsRefresh('anthropic')
    } else if (provider.vendor === 'openai') {
      notifyModelOptionsRefresh('openai')
    }
  }

  const handleShareAllTokens = (sharedFlag: boolean) => bulkShareTokens(soraProvider, tokens, sharedFlag, setTokens)
const handleShareAllGeminiTokens = (sharedFlag: boolean) => bulkShareTokens(geminiProvider, geminiTokens, sharedFlag, setGeminiTokens)
const handleShareAllVeoTokens = (sharedFlag: boolean) => bulkShareTokens(veoProvider, veoTokens, sharedFlag, setVeoTokens)
const handleShareAllAnthropicTokens = (sharedFlag: boolean) => bulkShareTokens(anthropicProvider, anthropicTokens, sharedFlag, setAnthropicTokens)
  const handleShareAllQwenTokens = (sharedFlag: boolean) => bulkShareTokens(qwenProvider, qwenTokens, sharedFlag, setQwenTokens)
  const handleShareAllOpenAITokens = (sharedFlag: boolean) => bulkShareTokens(openaiProvider, openaiTokens, sharedFlag, setOpenaiTokens)

  const syncProxyForm = React.useCallback((cfg: ProxyConfigDto | null) => {
    setProxyHost(cfg?.baseUrl || '')
    setProxyEnabled(!!cfg?.enabled)
    setProxyEnabledVendors(cfg?.enabledVendors || [])
    setProxyApiKey('')
    setProxyApiKeyTouched(false)
  }, [])

  const refreshProxyConfig = React.useCallback(async () => {
    setProxyLoading(true)
    try {
      const cfg = await getProxyConfig(GRSAI_PROXY_VENDOR)
      setProxyConfig(cfg)
      syncProxyForm(cfg)
    } catch (error: any) {
      console.error('Failed to load proxy config', error)
    } finally {
      setProxyLoading(false)
    }
  }, [syncProxyForm])

  React.useEffect(() => {
    if (!mounted) return
    refreshProxyConfig().catch(() => {})
  }, [mounted, refreshProxyConfig])

  React.useEffect(() => {
    if (!mounted || typeof window === 'undefined') return
    let disposed = false
    const loadAvailablePresets = () => {
      listAvailableModels()
        .then((models) => {
          if (disposed) return
          setVendorModelPresets(buildVendorPresetMap(models || []))
        })
        .catch((error) => {
          console.warn('Failed to load available model presets', error)
        })
    }
    loadAvailablePresets()
    const handler = () => loadAvailablePresets()
    window.addEventListener(MODEL_REFRESH_EVENT, handler)
    return () => {
      disposed = true
      window.removeEventListener(MODEL_REFRESH_EVENT, handler)
    }
  }, [mounted])

  const isSoraProxyActive = !!(proxyConfig?.enabled && proxyConfig.enabledVendors?.includes('sora'))
  const proxyVendorLabels = (proxyConfig?.enabledVendors || []).map((v) => {
    const found = PROXY_TARGET_OPTIONS.find((opt) => opt.value === v)
    return found ? found.label : v
  })

const handleOpenProxyModal = () => {
  if (!proxyConfig && !proxyLoading) {
    refreshProxyConfig().catch(() => {})
  } else {
    syncProxyForm(proxyConfig)
  }
  setProxyModalOpen(true)
}

const handleCloseProxyModal = () => {
    setProxyModalOpen(false)
    syncProxyForm(proxyConfig)
  }

  const handleSaveProxyConfig = async () => {
    const trimmedHost = proxyHost.trim()
    if (proxyEnabled && !trimmedHost) {
      notifications.show({ color: 'red', title: '保存失败', message: '请填写代理 Host 地址' })
      return
    }
    if (proxyEnabled && proxyEnabledVendors.length === 0) {
      notifications.show({ color: 'red', title: '保存失败', message: '请选择至少一个需要走代理的厂商' })
      return
    }
    setProxySaving(true)
    try {
      const payload: any = {
        baseUrl: trimmedHost,
        enabled: proxyEnabled,
        enabledVendors: proxyEnabled ? proxyEnabledVendors : [],
        name: GRSAI_PROXY_VENDOR,
      }
      if (proxyApiKeyTouched) {
        payload.apiKey = proxyApiKey.trim()
      }
      const saved = await upsertProxyConfig(GRSAI_PROXY_VENDOR, payload)
      setProxyConfig(saved)
      window.dispatchEvent(new CustomEvent(GRSAI_PROXY_UPDATED_EVENT, { detail: saved }))
      syncProxyForm(saved)
      setProxyModalOpen(false)
      notifications.show({ color: 'teal', title: '已保存', message: '代理服务配置已更新' })
    } catch (error: any) {
      notifications.show({ color: 'red', title: '保存失败', message: error?.message || '未知错误' })
    } finally {
      setProxySaving(false)
  }
}


  if (!mounted) return null

  // 计算安全的最大高度
  const maxHeight = calculateSafeMaxHeight(anchorY, 150)

  return (
    <div style={{ position: 'fixed', left: 82, top: anchorY ? anchorY - 150 : 140, zIndex: 200 }} data-ux-panel>
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
                width: 420,
                maxHeight: `${maxHeight}px`,
                minHeight: 0,
                transformOrigin: 'left center',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              }}
              data-ux-panel
            >
              <div className="panel-arrow" />
              <Group justify="space-between" mb={8} style={{ position: 'sticky', top: 0, zIndex: 1, background: 'transparent' }}>
                <Title order={6}>模型配置</Title>
                <Group gap={4}>
                  <input
                    id="import-model-config"
                    type="file"
                    accept=".json"
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      if (file) {
                        handleImport(file)
                      }
                      // 清空input值，允许重复导入同一文件
                      event.target.value = ''
                    }}
                    style={{ display: 'none' }}
                  />
                  <Tooltip label="导出配置">
                    <ActionIcon
                      size={24}
                      variant="light"
                      onClick={handleExport}
                    >
                      <IconDownload size={16} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label="导入配置">
                    <ActionIcon
                      size={24}
                      variant="light"
                      onClick={() => {
                        console.log('Import button clicked')
                        const input = document.getElementById('import-model-config') as HTMLInputElement
                        if (input) {
                          input.click()
                        } else {
                          // 备用方案：创建临时input元素
                          const tempInput = document.createElement('input')
                          tempInput.type = 'file'
                          tempInput.accept = '.json'
                          tempInput.onchange = (event) => {
                            const file = (event.target as HTMLInputElement).files?.[0]
                            if (file) {
                              handleImport(file)
                            }
                          }
                          tempInput.click()
                        }
                      }}
                    >
                      <IconUpload size={16} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label="一键清空所有模型配置">
                    <Button
                      size="xs"
                      variant="light"
                      color="red"
                      loading={clearingAll}
                      onClick={handleClearAll}
                    >
                      清空
                    </Button>
                  </Tooltip>
                  <Button size="xs" variant="light" onClick={() => setActivePanel(null)}>
                    关闭
                  </Button>
                </Group>
              </Group>
              <div style={{ flex: 1, overflowY: 'auto', paddingRight: 4, minHeight: 0 }}>
                <Stack gap="sm">
                  <Paper withBorder radius="md" p="sm">
                    <Group justify="space-between" align="flex-start">
                      <div>
                        <Group gap={6} mb={4} align="center">
                          <Title order={6}>代理服务</Title>
                          {proxyLoading && <Badge size="xs" color="gray">加载中</Badge>}
                          {proxyConfig?.enabled && !proxyLoading && (
                            <Badge size="xs" color="grape">已启用</Badge>
                          )}
                        </Group>
                        <Text size="xs" c="dimmed">
                          使用 grsai API Key 统一代理 Sora / Veo 等厂商的调用，稳定访问海外接口。
                        </Text>
                        {proxyConfig?.enabled && proxyVendorLabels.length > 0 ? (
                          <Group gap={6} mt={6} wrap="wrap">
                            <Badge size="xs" color="grape" variant="light">
                              厂商：{proxyVendorLabels.join('、')}
                            </Badge>
                            {proxyConfig.baseUrl && (
                              <Text size="xs" c="dimmed">
                                Host: {proxyConfig.baseUrl}
                              </Text>
                            )}
                          </Group>
                        ) : (
                          <Text size="xs" c="dimmed" mt={6}>
                            当前未启用代理服务
                          </Text>
                        )}
                      </div>
                      <Button size="xs" variant="light" onClick={handleOpenProxyModal}>
                        配置
                      </Button>
                    </Group>
                  </Paper>
                  <Paper withBorder radius="md" p="sm" style={{ position: 'relative' }}>
                    <Group justify="space-between" align="flex-start" mb={4}>
                      <Group gap={6}>
                        <Title order={6}>Sora</Title>
                        <Badge color="blue" size="xs">
                          Beta
                        </Badge>
                        {isSoraProxyActive && (
                          <Badge color="grape" size="xs">grsai 代理</Badge>
                        )}
                      </Group>
                      <Group spacing="xs">
                        <Button size="xs" onClick={openModalForNew}>
                          管理密钥
                        </Button>
                      </Group>
                    </Group>
                    <Text size="xs" c="dimmed" mb={2}>
                      配置多个 Sora API Token，共享同一厂商额度
                    </Text>
                    <Text size="xs" c="dimmed">
                      已配置密钥：{tokens.length}
                    </Text>
                  </Paper>
                  <Paper withBorder radius="md" p="sm" style={{ position: 'relative' }}>
                    <Group justify="space-between" align="flex-start" mb={4}>
                      <Group gap={6}>
                        <Title order={6}>Sora2API（自建）</Title>
                        <Badge color="teal" size="xs">
                          Local
                        </Badge>
                      </Group>
                      <Button size="xs" onClick={openSora2ApiModalForNew}>
                        管理密钥
                      </Button>
                    </Group>
                    <Text size="xs" c="dimmed" mb={6}>
                      通过自建 Sora2API 服务（OpenAI 兼容接口）生成视频/图片，适合本地或私有部署。
                    </Text>
                    <Text size="xs" c="dimmed">
                      已配置密钥：{sora2apiTokens.length}
                    </Text>
                  </Paper>
                  <Paper withBorder radius="md" p="sm" style={{ position: 'relative' }}>
                    <Group justify="space-between" align="flex-start" mb={4}>
                      <Group gap={6}>
                        <Title order={6}>Gemini</Title>
                        <Badge color="blue" size="xs">
                          Beta
                        </Badge>
                      </Group>
                      <Button size="xs" onClick={openGeminiModalForNew}>
                        管理密钥
                      </Button>
                    </Group>
                    <Text size="xs" c="dimmed" mb={2}>
                      配置 Gemini API Key（Google AI Studio / Vertex AI）
                    </Text>
                    <Text size="xs" c="dimmed">
                      已配置密钥：{geminiTokens.length}
                    </Text>
                    {renderProviderProfiles(geminiProvider)}
                  </Paper>
                  <Paper withBorder radius="md" p="sm" style={{ position: 'relative' }}>
                    <Group justify="space-between" align="flex-start" mb={4}>
                      <Group gap={6}>
                        <Title order={6}>OpenAI / Codex</Title>
                        <Badge color="teal" size="xs">
                          New
                        </Badge>
                      </Group>
                      <Button size="xs" onClick={openOpenAIModalForNew}>
                        管理密钥
                      </Button>
                    </Group>
                    <Text size="xs" c="dimmed" mb={2}>
                      配置 OpenAI 或 right.codes Codex API Key，支持 GPT-4o / GPT-5.1 等模型，可自定义 Base URL。
                    </Text>
                    <Text size="xs" c="dimmed">
                      已配置密钥：{openaiTokens.length}
                    </Text>
                    {renderProviderProfiles(openaiProvider)}
                  </Paper>
                  <Paper withBorder radius="md" p="sm" style={{ position: 'relative' }}>
                    <Group justify="space-between" align="flex-start" mb={4}>
                      <Group gap={6}>
                        <Title order={6}>Anthropic/GLM</Title>
                        <Badge color="yellow" size="xs">
                          New
                        </Badge>
                      </Group>
                      <Button
                        size="xs"
                        onClick={() => {
                          setAnthropicEditingToken(null)
                          setAnthropicLabel('')
                          setAnthropicSecret('')
                          setAnthropicShared(false)
                          setAnthropicModalOpen(true)
                        }}
                      >
                        管理密钥
                      </Button>
                    </Group>
                    <Text size="xs" c="dimmed" mb={2}>
                      配置 Claude API Key，支持 3.5 Sonnet / Haiku 等模型，可选自定义代理地址。
                    </Text>
                    <Text size="xs" c="dimmed">
                      已配置密钥：{anthropicTokens.length}
                    </Text>
                    {renderProviderProfiles(anthropicProvider)}
                  </Paper>
                  <Paper withBorder radius="md" p="sm" style={{ position: 'relative' }}>
                    <Group justify="space-between" align="flex-start" mb={4}>
                      <Group gap={6}>
                        <Title order={6}>Qwen</Title>
                        <Badge color="teal" size="xs">
                          Beta
                        </Badge>
                      </Group>
                      <Button size="xs" onClick={openQwenModalForNew}>
                        管理密钥
                      </Button>
                    </Group>
                    <Text size="xs" c="dimmed" mb={2}>
                      配置 DashScope API Key（qwen-image-plus 等）
                    </Text>
                    <Text size="xs" c="dimmed">
                      已配置密钥：{qwenTokens.length}
                    </Text>
                    {renderProviderProfiles(qwenProvider)}
                  </Paper>
                  <Paper withBorder radius="md" p="sm" style={{ position: 'relative' }}>
                    <Group justify="space-between" align="flex-start" mb={4}>
                      <Group gap={6}>
                        <Title order={6}>Veo (GRSAI)</Title>
                        <Badge color="violet" size="xs">
                          New
                        </Badge>
                      </Group>
                      <Button size="xs" onClick={openVeoModalForNew}>
                        管理密钥
                      </Button>
                    </Group>
                    <Text size="xs" c="dimmed" mb={6}>
                      支持海外 `https://api.grsai.com` 与国内直连 `https://grsai.dakka.com.cn`，可自定义 Host。
                    </Text>
                    <Group gap="xs" align="flex-end" mb={8}>
                      <TextInput
                        label="API Host"
                        placeholder="https://api.grsai.com"
                        value={veoBaseUrl}
                        onChange={(e) => setVeoBaseUrl(e.currentTarget.value)}
                        onBlur={() => handlePersistVeoBaseUrl(veoBaseUrl)}
                        style={{ flex: 1 }}
                      />
                      <Button size="compact-xs" variant="light" onClick={() => handleApplyVeoHost('https://api.grsai.com')}>
                        海外
                      </Button>
                      <Button size="compact-xs" variant="light" onClick={() => handleApplyVeoHost('https://grsai.dakka.com.cn')}>
                        国内
                      </Button>
                    </Group>
                    <Text size="xs" c="dimmed">
                      已配置密钥：{veoTokens.length}
                    </Text>
                    {renderProviderProfiles(veoProvider)}
                  </Paper>
                </Stack>
              </div>
            </Paper>
                      <Modal
              opened={anthropicModalOpen}
              onClose={() => setAnthropicModalOpen(false)}
              fullScreen
              withinPortal
              zIndex={300}
              title="Anthropic 身份配置"
              styles={{
                content: {
                  height: '100vh',
                  paddingTop: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  paddingBottom: 16,
                },
                body: {
                  display: 'flex',
                  flexDirection: 'column',
                  height: '100%',
                  overflow: 'hidden',
                },
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                <Stack gap="md" style={{ flex: 1, overflowY: 'auto', paddingBottom: 8 }}>
                  <Group spacing="xs">
                    <Text size="sm" c="dimmed">
                      配置 Claude / Anthropic API Key，可任选官方或自建代理 Base URL，支持 3.5 Sonnet / Haiku 等模型。
                    </Text>
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() =>
                        window.open('https://console.anthropic.com/account/keys', '_blank', 'noopener')
                      }
                    >
                      获取 API Key
                    </Button>
                  </Group>
                  <Stack gap="xs">
                    <div>
                      <TextInput
                        label="Anthropic 代理 Base URL"
                        placeholder="例如：https://api.anthropic.com"
                        value={anthropicBaseUrl}
                        onChange={(e) => setAnthropicBaseUrl(e.currentTarget.value)}
                        onBlur={async () => {
                          if (!anthropicProvider) return
                          const saved = await upsertModelProvider({
                            id: anthropicProvider.id,
                            name: anthropicProvider.name,
                            vendor: anthropicProvider.vendor,
                            baseUrl: anthropicBaseUrl.trim() || null,
                            sharedBaseUrl: anthropicBaseShared,
                          })
                          setAnthropicProvider(saved)
                          setAnthropicBaseUrl(saved.baseUrl || '')
                          setAnthropicBaseShared(!!saved.sharedBaseUrl)
                          notifyModelOptionsRefresh('anthropic')
                        }}
                      />
                      <Switch
                        size="xs"
                        mt={4}
                        label="将此 Base URL 作为共享配置（团队可复用同一代理域名）"
                        checked={anthropicBaseShared}
                        onChange={async (e) => {
                          const next = e.currentTarget.checked
                          setAnthropicBaseShared(next)
                          if (!anthropicProvider) return
                          try {
                            const saved = await upsertModelProvider({
                              id: anthropicProvider.id,
                              name: anthropicProvider.name,
                              vendor: anthropicProvider.vendor,
                              baseUrl: anthropicBaseUrl.trim() || null,
                              sharedBaseUrl: next,
                            })
                            setAnthropicProvider(saved)
                            setAnthropicBaseUrl(saved.baseUrl || '')
                            setAnthropicBaseShared(!!saved.sharedBaseUrl)
                            notifyModelOptionsRefresh('anthropic')
                          } catch (err) {
                            console.error('Failed to toggle Anthropic base URL share', err)
                            setAnthropicBaseShared(!next)
                          }
                        }}
                      />
                    </div>
                  </Stack>
                  <Group justify="space-between">
                    <Title order={5}>已保存的 Claude Key</Title>
                    <Group gap="xs">
                      {anthropicTokens.length > 0 && (
                        <>
                          <Button size="xs" variant="subtle" onClick={() => handleShareAllAnthropicTokens(true)}>
                            全部共享
                          </Button>
                          <Button size="xs" variant="subtle" onClick={() => handleShareAllAnthropicTokens(false)}>
                            取消全部共享
                          </Button>
                        </>
                      )}
                      <Button size="xs" onClick={openAnthropicModalForNew}>
                        新增密钥
                      </Button>
                    </Group>
                  </Group>
                  {anthropicTokens.length === 0 && <Text size="sm">暂无密钥，请先新增一个。</Text>}
                  <Stack gap="xs">
                    {anthropicTokens.map((t) => (
                      <Group key={t.id} justify="space-between">
                        <div>
                          <Group gap={6}>
                            <Text size="sm">{t.label}</Text>
                            {t.shared && (
                              <Badge size="xs" color="grape">
                                共享
                              </Badge>
                            )}
                          </Group>
                          <Text size="xs" c="dimmed">
                            {t.secretToken ? t.secretToken.slice(0, 4) + '••••' : '已保存的密钥'}
                          </Text>
                        </div>
                        <Group gap="xs">
                          <Button
                            size="xs"
                            variant="subtle"
                            onClick={() => {
                              setAnthropicEditingToken(t)
                              setAnthropicLabel(t.label)
                              setAnthropicSecret('')
                              setAnthropicShared(!!t.shared)
                              setAnthropicModalOpen(true)
                            }}
                          >
                            编辑
                          </Button>
                          <Button size="xs" variant="light" color="red" onClick={() => handleDeleteAnthropicToken(t.id)}>
                            删除
                          </Button>
                        </Group>
                      </Group>
                    ))}
                  </Stack>
                </Stack>
                <Paper withBorder radius="md" p="md">
                  <Stack gap="sm">
                    <Title order={6}>{anthropicEditingToken ? '编辑密钥' : '新增密钥'}</Title>
                    <TextInput label="名称" placeholder="例如：Claude 主账号 Key" value={anthropicLabel} onChange={(e) => setAnthropicLabel(e.currentTarget.value)} />
                    <TextInput
                      label="API Key"
                      placeholder={anthropicEditingToken ? '留空则不修改已有密钥' : '粘贴你的 Anthropic API Key'}
                      value={anthropicSecret}
                      onChange={(e) => setAnthropicSecret(e.currentTarget.value)}
                    />
                    <Switch
                      label="将此密钥作为共享配置（其他未配置或超额的用户可复用）"
                      checked={anthropicShared}
                      onChange={(e) => setAnthropicShared(e.currentTarget.checked)}
                    />
                    <Group justify="flex-end" mt="sm">
                      <Button variant="default" onClick={() => setAnthropicModalOpen(false)}>
                        取消
                      </Button>
                      <Button onClick={handleSaveAnthropicToken}>保存</Button>
                    </Group>
                  </Stack>
                </Paper>
              </div>
            </Modal>
                      <Modal
              opened={geminiModalOpen}
              onClose={() => setGeminiModalOpen(false)}
              fullScreen
              withinPortal
              zIndex={300}
              title="Gemini 身份配置"
              styles={{
                content: {
                  height: '100vh',
                  paddingTop: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  paddingBottom: 16,
                },
                body: {
                  display: 'flex',
                  flexDirection: 'column',
                  height: '100%',
                  overflow: 'hidden',
                },
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                <Stack gap="md" style={{ flex: 1, overflowY: 'auto', paddingBottom: 8 }}>
                  <Group spacing="xs">
                    <Text size="sm" c="dimmed">
                      在这里配置 Gemini API Key（Google AI Studio / Vertex AI）。目前用于文案优化和图片生成。
                    </Text>
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() =>
                        window.open('https://aistudio.google.com/api-keys', '_blank', 'noopener')
                      }
                    >
                      获取 API Key
                    </Button>
                  </Group>
                  <Stack gap="xs">
                    <div>
                      <TextInput
                        label="Base URL（可选，一般保持默认）"
                        placeholder="例如：https://generativelanguage.googleapis.com"
                        value={geminiBaseUrl}
                        onChange={(e) => setGeminiBaseUrl(e.currentTarget.value)}
                        onBlur={async () => {
                          if (!geminiProvider) return
                          await upsertModelProvider({
                            id: geminiProvider.id,
                            name: geminiProvider.name,
                            vendor: geminiProvider.vendor,
                            baseUrl: geminiBaseUrl.trim() || undefined,
                          })
                        }}
                      />
                    </div>
                  </Stack>
                  <Group justify="space-between">
                    <Title order={5}>已保存的 Gemini Key</Title>
                    <Group gap="xs">
                      {geminiTokens.length > 0 && (
                        <>
                          <Button size="xs" variant="subtle" onClick={() => handleShareAllGeminiTokens(true)}>
                            全部共享
                          </Button>
                          <Button size="xs" variant="subtle" onClick={() => handleShareAllGeminiTokens(false)}>
                            取消全部共享
                          </Button>
                        </>
                      )}
                      <Button size="xs" onClick={openGeminiModalForNew}>
                        新增 Key
                      </Button>
                    </Group>
                  </Group>
                  <Stack gap="xs">
                    {geminiTokens.map((t) => (
                      <Group key={t.id} justify="space-between">
                        <div>
                          <Text size="sm">{t.label}</Text>
                          <Text size="xs" c="dimmed">
                            {t.shared ? '共享' : '仅自己可见'}
                          </Text>
                        </div>
                        <Group gap="xs">
                          <Button
                            size="xs"
                            variant="light"
                            onClick={() => {
                              setGeminiEditingToken(t)
                              setGeminiLabel(t.label)
                              setGeminiSecret('')
                              setGeminiShared(!!t.shared)
                              setGeminiModalOpen(true)
                            }}
                          >
                            编辑
                          </Button>
                          <Button size="xs" variant="subtle" color="red" onClick={() => handleDeleteGeminiToken(t.id)}>
                            删除
                          </Button>
                        </Group>
                      </Group>
                    ))}
                    {geminiTokens.length === 0 && (
                      <Text size="xs" c="dimmed">
                        暂无已保存的 Gemini Key。
                      </Text>
                    )}
                  </Stack>
                </Stack>
                <Paper withBorder radius="md" p="md">
                  <Stack gap="sm">
                    <Title order={6}>{geminiEditingToken ? '编辑 Key' : '新增 Key'}</Title>
                    <TextInput label="名称" placeholder="例如：主账号 Key" value={geminiLabel} onChange={(e) => setGeminiLabel(e.currentTarget.value)} />
                    <TextInput
                      label="API Key"
                      placeholder={geminiEditingToken ? '留空则不修改已有 Key' : '粘贴你的 Gemini API Key'}
                      value={geminiSecret}
                      onChange={(e) => setGeminiSecret(e.currentTarget.value)}
                    />
                    <Switch
                      label="将此 Key 作为共享配置（其他未配置或超额的用户可复用）"
                      checked={geminiShared}
                      onChange={(e) => setGeminiShared(e.currentTarget.checked)}
                    />
                    <Group justify="flex-end" mt="sm">
                      <Button variant="default" onClick={() => setGeminiModalOpen(false)}>
                        取消
                      </Button>
                      <Button onClick={handleSaveGeminiToken}>保存</Button>
                    </Group>
                  </Stack>
                </Paper>
              </div>
            </Modal>
            <Modal
              opened={openaiModalOpen}
              onClose={() => setOpenaiModalOpen(false)}
              fullScreen
              withinPortal
              zIndex={300}
              title="OpenAI / Codex 身份配置"
              styles={{
                content: {
                  height: '100vh',
                  paddingTop: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  paddingBottom: 16,
                },
                body: {
                  display: 'flex',
                  flexDirection: 'column',
                  height: '100%',
                  overflow: 'hidden',
                },
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                <Stack gap="md" style={{ flex: 1, overflowY: 'auto', paddingBottom: 8 }}>
                  <Group spacing="xs">
                    <Text size="sm" c="dimmed">
                      配置 OpenAI 或 right.codes Codex API Key，可自定义 Base URL 访问代理（如 https://www.right.codes/codex）。
                    </Text>
                    <Group gap="xs">
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => window.open('https://platform.openai.com/account/api-keys', '_blank', 'noopener')}
                      >
                        获取 OpenAI Key
                      </Button>
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => window.open('https://www.right.codes/register?aff=21f6040a', '_blank', 'noopener')}
                      >
                        使用国内代理
                      </Button>
                    </Group>
                  </Group>
                  <Stack gap="xs">
                    <div>
                      <TextInput
                        label="OpenAI / Codex Base URL"
                        placeholder="例如：https://api.openai.com 或 https://www.right.codes/codex"
                        value={openaiBaseUrl}
                        onChange={(e) => setOpenaiBaseUrl(e.currentTarget.value)}
                        onBlur={async () => {
                          if (!openaiProvider) return
                          try {
                            const saved = await upsertModelProvider({
                              id: openaiProvider.id,
                              name: openaiProvider.name,
                              vendor: openaiProvider.vendor,
                              baseUrl: openaiBaseUrl.trim() || null,
                              sharedBaseUrl: openaiBaseShared,
                            })
                            setOpenaiProvider(saved)
                            setOpenaiBaseUrl(saved.baseUrl || '')
                            setOpenaiBaseShared(!!saved.sharedBaseUrl)
                            notifyModelOptionsRefresh('openai')
                          } catch (err) {
                            console.error('Failed to update OpenAI base URL', err)
                          }
                        }}
                      />
                      <Switch
                        size="xs"
                        mt={4}
                        label="将 Base URL 作为共享配置（团队复用同一代理域名）"
                        checked={openaiBaseShared}
                        onChange={async (e) => {
                          const next = e.currentTarget.checked
                          setOpenaiBaseShared(next)
                          if (!openaiProvider) return
                          try {
                            const saved = await upsertModelProvider({
                              id: openaiProvider.id,
                              name: openaiProvider.name,
                              vendor: openaiProvider.vendor,
                              baseUrl: openaiBaseUrl.trim() || null,
                              sharedBaseUrl: next,
                            })
                            setOpenaiProvider(saved)
                            setOpenaiBaseUrl(saved.baseUrl || '')
                            setOpenaiBaseShared(!!saved.sharedBaseUrl)
                            notifyModelOptionsRefresh('openai')
                          } catch (err) {
                            console.error('Failed to toggle OpenAI base share', err)
                            setOpenaiBaseShared(!next)
                          }
                        }}
                      />
                    </div>
                  </Stack>
                  <Group justify="space-between">
                    <Title order={5}>已保存的 OpenAI Key</Title>
                    <Group gap="xs">
                      {openaiTokens.length > 0 && (
                        <>
                          <Button size="xs" variant="subtle" onClick={() => handleShareAllOpenAITokens(true)}>
                            全部共享
                          </Button>
                          <Button size="xs" variant="subtle" onClick={() => handleShareAllOpenAITokens(false)}>
                            取消全部共享
                          </Button>
                        </>
                      )}
                      <Button size="xs" onClick={openOpenAIModalForNew}>
                        新增 Key
                      </Button>
                    </Group>
                  </Group>
                  {openaiTokens.length === 0 && <Text size="sm">暂无密钥，请先新增一个。</Text>}
                  <Stack gap="xs">
                    {openaiTokens.map((t) => (
                      <Group key={t.id} justify="space-between">
                        <div>
                          <Group gap={6}>
                            <Text size="sm">{t.label}</Text>
                            {t.shared && (
                              <Badge size="xs" color="grape">
                                共享
                              </Badge>
                            )}
                          </Group>
                          <Text size="xs" c="dimmed">
                            {t.secretToken ? t.secretToken.slice(0, 4) + '••••' : '已保存的密钥'}
                          </Text>
                        </div>
                        <Group gap="xs">
                          <Button
                            size="xs"
                            variant="subtle"
                            onClick={() => {
                              setOpenaiEditingToken(t)
                              setOpenaiLabel(t.label)
                              setOpenaiSecret('')
                              setOpenaiShared(!!t.shared)
                              setOpenaiModalOpen(true)
                            }}
                          >
                            编辑
                          </Button>
                          <Button size="xs" variant="light" color="red" onClick={() => handleDeleteOpenAIToken(t.id)}>
                            删除
                          </Button>
                        </Group>
                      </Group>
                    ))}
                  </Stack>
                </Stack>
                <Paper withBorder radius="md" p="md">
                  <Stack gap="sm">
                    <Title order={6}>{openaiEditingToken ? '编辑 Key' : '新增 Key'}</Title>
                    <TextInput label="名称" placeholder="例如：OpenAI 主账号 Key" value={openaiLabel} onChange={(e) => setOpenaiLabel(e.currentTarget.value)} />
                    <TextInput
                      label="API Key"
                      placeholder={openaiEditingToken ? '留空则不修改已有 Key' : '粘贴你的 OpenAI / Codex API Key'}
                      value={openaiSecret}
                      onChange={(e) => setOpenaiSecret(e.currentTarget.value)}
                    />
                    <Switch
                      label="将此 Key 作为共享配置（其他未配置或超额的用户可复用）"
                      checked={openaiShared}
                      onChange={(e) => setOpenaiShared(e.currentTarget.checked)}
                    />
                    <Group justify="flex-end" mt="sm">
                      <Button variant="default" onClick={() => setOpenaiModalOpen(false)}>
                        取消
                      </Button>
                      <Button onClick={handleSaveOpenAIToken}>保存</Button>
                    </Group>
                  </Stack>
                </Paper>
              </div>
            </Modal>
            <Modal
              opened={sessionModalOpen}
              onClose={() => {
                setSessionModalOpen(false)
                setSessionError('')
              }}
              title="导入 Sora session"
              centered
              withinPortal
              zIndex={8200}
            >
              <Stack>
                <Text size="sm" c="dimmed">
                  将 https://sora.chatgpt.com/api/auth/session 返回的 JSON 粘贴到下方，系统会自动提取 accessToken 作为新的 Sora Token。
                </Text>
                <Textarea
                  minRows={6}
                  value={sessionJson}
                  onChange={(e) => setSessionJson(e.currentTarget.value)}
                  placeholder='{"user": {...}, "accessToken":"..."}'
                />
                {sessionError && (
                  <Text size="xs" c="red">
                    {sessionError}
                  </Text>
                )}
                <Group position="right" spacing="sm">
                  <Button variant="subtle" size="xs" onClick={() => setSessionModalOpen(false)}>
                    取消
                  </Button>
                  <Button
                    size="xs"
                    onClick={() => {
                      try {
                        const payload = JSON.parse(sessionJson)
                        const token = payload?.accessToken
                        if (!token) throw new Error('未包含 accessToken')
                        const userLabel = payload?.user?.name
                          ? `Sora ${payload.user.name}`
                          : 'Sora Session'
                        setLabel(userLabel)
                        setSecret(token)
                        setUserAgent(navigator.userAgent || '')
                        setModalOpen(true)
                        setSessionModalOpen(false)
                        setSessionJson('')
                        setSessionError('')
                      } catch (err: any) {
                        setSessionError(err?.message || 'JSON 解析失败')
                      }
                    }}
                  >
                    导入密钥
                  </Button>
                </Group>
              </Stack>
            </Modal>
            <Modal
              opened={qwenModalOpen}
              onClose={() => setQwenModalOpen(false)}
              fullScreen
              withinPortal
              zIndex={300}
              title="Qwen 身份配置"
              styles={{
                content: {
                  height: '100vh',
                  paddingTop: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  paddingBottom: 16,
                },
                body: {
                  display: 'flex',
                  flexDirection: 'column',
                  height: '100%',
                  overflow: 'hidden',
                },
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                <Stack gap="md" style={{ flex: 1, overflowY: 'auto', paddingBottom: 8 }}>
                  <Group spacing="xs">
                    <Text size="sm" c="dimmed">
                      在这里配置 DashScope API Key，用于调用 Qwen 图片模型（如 qwen-image-plus）。
                    </Text>
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() =>
                        window.open('https://bailian.console.aliyun.com/?tab=model#/api-key', '_blank', 'noopener')
                      }
                    >
                      获取 API Key
                    </Button>
                  </Group>
                  <Group justify="space-between">
                    <Title order={5}>已保存的 Qwen Key</Title>
                    <Group gap="xs">
                      {qwenTokens.length > 0 && (
                        <>
                          <Button size="xs" variant="subtle" onClick={() => handleShareAllQwenTokens(true)}>
                            全部共享
                          </Button>
                          <Button size="xs" variant="subtle" onClick={() => handleShareAllQwenTokens(false)}>
                            取消全部共享
                          </Button>
                        </>
                      )}
                      <Button size="xs" onClick={openQwenModalForNew}>
                        新增 Key
                      </Button>
                    </Group>
                  </Group>
                  <Stack gap="xs">
                    {qwenTokens.map((t) => (
                      <Group key={t.id} justify="space-between">
                        <div>
                          <Text size="sm">{t.label}</Text>
                          <Text size="xs" c="dimmed">
                            {t.shared ? '共享' : '仅自己可见'}
                          </Text>
                        </div>
                        <Group gap="xs">
                          <Button
                            size="xs"
                            variant="light"
                            onClick={() => {
                              setQwenEditingToken(t)
                              setQwenLabel(t.label)
                              setQwenSecret('')
                              setQwenShared(!!t.shared)
                              setQwenModalOpen(true)
                            }}
                          >
                            编辑
                          </Button>
                          <Button size="xs" variant="subtle" color="red" onClick={() => handleDeleteQwenToken(t.id)}>
                            删除
                          </Button>
                        </Group>
                      </Group>
                    ))}
                    {qwenTokens.length === 0 && (
                      <Text size="xs" c="dimmed">
                        暂无已保存的 Qwen Key。
                      </Text>
                    )}
                  </Stack>
                </Stack>
                <Paper withBorder radius="md" p="md">
                  <Stack gap="sm">
                    <Title order={6}>{qwenEditingToken ? '编辑 Key' : '新增 Key'}</Title>
                    <TextInput label="名称" placeholder="例如：Qwen 主账号 Key" value={qwenLabel} onChange={(e) => setQwenLabel(e.currentTarget.value)} />
                    <TextInput
                      label="DashScope API Key"
                      placeholder={qwenEditingToken ? '留空则不修改已有 Key' : '粘贴你的 DashScope API Key'}
                      value={qwenSecret}
                      onChange={(e) => setQwenSecret(e.currentTarget.value)}
                    />
                    <Switch
                      label="将此 Key 作为共享配置（其他未配置或超额的用户可复用）"
                      checked={qwenShared}
                      onChange={(e) => setQwenShared(e.currentTarget.checked)}
                    />
                    <Group justify="flex-end" mt="sm">
                      <Button variant="default" onClick={() => setQwenModalOpen(false)}>
                        取消
                      </Button>
                      <Button onClick={handleSaveQwenToken}>保存</Button>
                    </Group>
                  </Stack>
                </Paper>
              </div>
            </Modal>
            <Modal
              opened={veoModalOpen}
              onClose={() => setVeoModalOpen(false)}
              fullScreen
              withinPortal
              zIndex={300}
              title="Veo (GRSAI) 身份配置"
              styles={{
                content: {
                  height: '100vh',
                  paddingTop: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  paddingBottom: 16,
                },
                body: {
                  display: 'flex',
                  flexDirection: 'column',
                  height: '100%',
                  overflow: 'hidden',
                },
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                <Stack gap="md" style={{ flex: 1, overflowY: 'auto', paddingBottom: 8 }}>
                  <Group spacing="xs">
                    <Text size="sm" c="dimmed">
                      配置 GRSAI Veo API Key，支持 Host：`https://api.grsai.com`（海外）或 `https://grsai.dakka.com.cn`（国内）。
                    </Text>
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() =>
                        window.open('https://grsai.com/', '_blank', 'noopener')
                      }
                    >
                      查看文档
                    </Button>
                  </Group>
                  <Stack gap="xs">
                    <Group justify="space-between">
                      <Title order={5}>已保存的 Veo Key</Title>
                      <Group gap="xs">
                        {veoTokens.length > 0 && (
                          <>
                            <Button size="xs" variant="subtle" onClick={() => handleShareAllVeoTokens(true)}>
                              全部共享
                            </Button>
                            <Button size="xs" variant="subtle" onClick={() => handleShareAllVeoTokens(false)}>
                              取消全部共享
                            </Button>
                          </>
                        )}
                        <Button size="xs" onClick={openVeoModalForNew}>
                          新增 Key
                        </Button>
                      </Group>
                    </Group>
                    <Stack gap="xs">
                      {veoTokens.map((t) => (
                        <Group key={t.id} justify="space-between">
                          <div>
                            <Text size="sm">{t.label}</Text>
                            <Text size="xs" c="dimmed">
                              {t.shared ? '共享' : '仅自己可见'}
                            </Text>
                          </div>
                          <Group gap="xs">
                            <Button
                              size="xs"
                              variant="light"
                              onClick={() => {
                                setVeoEditingToken(t)
                                setVeoLabel(t.label)
                                setVeoSecret('')
                                setVeoShared(!!t.shared)
                                setVeoModalOpen(true)
                              }}
                            >
                              编辑
                            </Button>
                            <Button size="xs" variant="subtle" color="red" onClick={() => handleDeleteVeoToken(t.id)}>
                              删除
                            </Button>
                          </Group>
                        </Group>
                      ))}
                      {veoTokens.length === 0 && (
                        <Text size="xs" c="dimmed">
                          暂无 Veo Key。
                        </Text>
                      )}
                    </Stack>
                  </Stack>
                </Stack>
                <Paper withBorder radius="md" p="md">
                  <Stack gap="sm">
                    <Title order={6}>{veoEditingToken ? '编辑 Key' : '新增 Key'}</Title>
                    <TextInput label="名称" placeholder="例如：Veo 主账号 Key" value={veoLabel} onChange={(e) => setVeoLabel(e.currentTarget.value)} />
                    <TextInput
                      label="API Key"
                      placeholder={veoEditingToken ? '留空则不修改已有 Key' : '粘贴你的 GRSAI API Key'}
                      value={veoSecret}
                      onChange={(e) => setVeoSecret(e.currentTarget.value)}
                    />
                    <Switch
                      label="将此 Key 作为共享配置（其他成员可复用）"
                      checked={veoShared}
                      onChange={(e) => setVeoShared(e.currentTarget.checked)}
                    />
                    <Group justify="flex-end" mt="sm">
                      <Button variant="default" onClick={() => setVeoModalOpen(false)}>
                        取消
                      </Button>
                      <Button onClick={handleSaveVeoToken}>保存</Button>
                    </Group>
                  </Stack>
                </Paper>
              </div>
            </Modal>
            <Modal
              opened={sora2apiModalOpen}
              onClose={() => setSora2apiModalOpen(false)}
              fullScreen
              withinPortal
              zIndex={300}
              title="Sora2API 身份配置"
              styles={{
                content: {
                  height: '100vh',
                  paddingTop: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  paddingBottom: 16,
                },
                body: {
                  display: 'flex',
                  flexDirection: 'column',
                  height: '100%',
                  overflow: 'hidden',
                },
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                <Stack gap="md" style={{ flex: 1, overflowY: 'auto', paddingBottom: 8 }}>
                  <Group spacing="xs">
                    <Text size="sm" c="dimmed">
                      连接自建的 Sora2API 服务（OpenAI 兼容接口），通过模型面板统一管理 API Host 与密钥。
                    </Text>
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() =>
                        window.open('https://github.com/TheSmallHanCat/sora2api', '_blank', 'noopener')
                      }
                    >
                      查看项目
                    </Button>
                  </Group>
                  <Stack gap="xs">
                    <div>
                      <TextInput
                        label="Sora2API Base URL"
                        placeholder="例如：http://127.0.0.1:8000"
                        value={sora2apiBaseUrl}
                        onChange={(e) => setSora2apiBaseUrl(e.currentTarget.value)}
                        onBlur={async () => {
                          if (!sora2apiProvider) return
                          try {
                            const saved = await upsertModelProvider({
                              id: sora2apiProvider.id,
                              name: sora2apiProvider.name,
                              vendor: sora2apiProvider.vendor,
                              baseUrl: sora2apiBaseUrl.trim() || null,
                              sharedBaseUrl: false,
                            })
                            setSora2apiProvider(saved)
                            setSora2apiBaseUrl(saved.baseUrl || '')
                            notifyModelOptionsRefresh('openai')
                          } catch (err) {
                            console.error('Failed to update Sora2API base URL', err)
                          }
                        }}
                      />
                    </div>
                  </Stack>
                  <Group justify="space-between">
                    <Title order={5}>已保存的 Sora2API Key</Title>
                    <Group gap="xs">
                      {sora2apiTokens.length > 0 && (
                        <>
                          <Button
                            size="xs"
                            variant="subtle"
                            onClick={() => {
                              if (!sora2apiProvider) return
                              const sharedFlag = true
                              const updateAll = async () => {
                                const updated = await Promise.all(
                                  sora2apiTokens.map((t) =>
                                    upsertModelToken({
                                      id: t.id,
                                      providerId: sora2apiProvider.id,
                                      label: t.label,
                                      secretToken: t.secretToken,
                                      userAgent: null,
                                      shared: sharedFlag,
                                    }),
                                  ),
                                )
                                setSora2apiTokens(updated)
                              }
                              updateAll().catch((err) => {
                                console.error('Failed to share all Sora2API tokens', err)
                              })
                            }}
                          >
                            全部共享
                          </Button>
                          <Button
                            size="xs"
                            variant="subtle"
                            onClick={() => {
                              if (!sora2apiProvider) return
                              const sharedFlag = false
                              const updateAll = async () => {
                                const updated = await Promise.all(
                                  sora2apiTokens.map((t) =>
                                    upsertModelToken({
                                      id: t.id,
                                      providerId: sora2apiProvider.id,
                                      label: t.label,
                                      secretToken: t.secretToken,
                                      userAgent: null,
                                      shared: sharedFlag,
                                    }),
                                  ),
                                )
                                setSora2apiTokens(updated)
                              }
                              updateAll().catch((err) => {
                                console.error('Failed to unshare all Sora2API tokens', err)
                              })
                            }}
                          >
                            取消全部共享
                          </Button>
                        </>
                      )}
                      <Button size="xs" onClick={openSora2ApiModalForNew}>
                        新增 Key
                      </Button>
                    </Group>
                  </Group>
                  {sora2apiTokens.length === 0 && <Text size="sm">暂无密钥，请先新增一个。</Text>}
                  <Stack gap="xs">
                    {sora2apiTokens.map((t) => (
                      <Group key={t.id} justify="space-between">
                        <div>
                          <Group gap={6}>
                            <Text size="sm">{t.label}</Text>
                            {t.shared && (
                              <Badge size="xs" color="grape">
                                共享
                              </Badge>
                            )}
                          </Group>
                          <Text size="xs" c="dimmed">
                            {t.secretToken ? t.secretToken.slice(0, 4) + '••••' : '已保存的密钥'}
                          </Text>
                        </div>
                        <Group gap="xs">
                          <Button
                            size="xs"
                            variant="subtle"
                            onClick={() => {
                              setSora2apiEditingToken(t)
                              setSora2apiLabel(t.label)
                              setSora2apiSecret('')
                              setSora2apiShared(!!t.shared)
                              setSora2apiModalOpen(true)
                            }}
                          >
                            编辑
                          </Button>
                          <Button
                            size="xs"
                            variant="light"
                            color="red"
                            onClick={() => handleDeleteSora2ApiToken(t.id)}
                          >
                            删除
                          </Button>
                        </Group>
                      </Group>
                    ))}
                  </Stack>
                </Stack>
                <Paper withBorder radius="md" p="md">
                  <Stack gap="sm">
                    <Title order={6}>{sora2apiEditingToken ? '编辑 Key' : '新增 Key'}</Title>
                    <TextInput
                      label="名称"
                      placeholder="例如：Sora2API 主账号 Key"
                      value={sora2apiLabel}
                      onChange={(e) => setSora2apiLabel(e.currentTarget.value)}
                    />
                    <TextInput
                      label="API Key"
                      placeholder={sora2apiEditingToken ? '留空则不修改已有 Key' : '粘贴你的 Sora2API API Key'}
                      value={sora2apiSecret}
                      onChange={(e) => setSora2apiSecret(e.currentTarget.value)}
                    />
                    <Switch
                      label="将此 Key 作为共享配置（其他成员可复用）"
                      checked={sora2apiShared}
                      onChange={(e) => setSora2apiShared(e.currentTarget.checked)}
                    />
                    <Group justify="flex-end" mt="sm">
                      <Button variant="default" onClick={() => setSora2apiModalOpen(false)}>
                        取消
                      </Button>
                      <Button onClick={handleSaveSora2ApiToken}>保存</Button>
                    </Group>
                  </Stack>
                </Paper>
              </div>
            </Modal>
            <Modal
              opened={!!profileModal}
              onClose={() => {
                setProfileModal(null)
                setProfileName('')
                setProfileModelKey('')
                setProfileKind('chat')
              }}
              withinPortal
              zIndex={200}
              title={profileModal?.profile ? '编辑模型' : '新增模型'}
            >
              <Stack gap="sm">
                {profileModal?.provider && (
                  <Text size="sm" c="dimmed">
                    {profileModal.provider.name} · {profileModal.provider.vendor}
                  </Text>
                )}
                <TextInput
                  label="显示名称"
                  placeholder="例如：GPT-4o-mini 自定义"
                  value={profileName}
                  onChange={(e) => setProfileName(e.currentTarget.value)}
                />
                <TextInput
                  label="模型 ID"
                  placeholder="例如：gpt-4.1-mini"
                  value={profileModelKey}
                  onChange={(e) => setProfileModelKey(e.currentTarget.value)}
                />
                <Select
                  label="模型类型"
                  data={PROFILE_KIND_OPTIONS}
                  value={profileKind}
                  onChange={(value) => value && setProfileKind(value as ProfileKind)}
                />
                <Group justify="flex-end" mt="sm">
                  <Button
                    variant="default"
                    onClick={() => {
                      setProfileModal(null)
                      setProfileName('')
                      setProfileModelKey('')
                      setProfileKind('chat')
                    }}
                  >
                    取消
                  </Button>
                  <Button onClick={handleSaveProfile} loading={profileSaving} disabled={!profileModelKey.trim()}>
                    保存
                  </Button>
                </Group>
              </Stack>
            </Modal>
            <Modal
              opened={proxyModalOpen}
              onClose={handleCloseProxyModal}
              title="代理服务（grsai）"
              centered
              size="lg"
            >
              <Stack gap="sm">
                <Text size="sm" c="dimmed">
                  配置一次 grsai API Key 和 Host，即可让选定的厂商走该代理，无需逐个粘贴密钥。
                </Text>
                <Group gap="xs">
                  {PROXY_HOST_PRESETS.map((preset) => (
                    <Button key={preset.value} size="xs" variant="light" onClick={() => setProxyHost(preset.value)}>
                      {preset.label}
                    </Button>
                  ))}
                </Group>
                <TextInput
                  label="代理 Host"
                  placeholder="例如：https://api.grsai.com"
                  value={proxyHost}
                  onChange={(e) => setProxyHost(e.currentTarget.value)}
                  required
                />
                <TextInput
                  label="grsai API Key"
                  placeholder={proxyConfig?.hasApiKey ? '留空则不修改已保存的 Key' : '粘贴 grsai 提供的 API Key'}
                  type="password"
                  value={proxyApiKey}
                  onChange={(e) => {
                    setProxyApiKey(e.currentTarget.value)
                    setProxyApiKeyTouched(true)
                  }}
                />
                <Group justify="flex-end" gap="xs">
                  <Button
                    size="compact-xs"
                    variant="light"
                    onClick={() => window.open('https://grsai.com/zh/dashboard/api-keys', '_blank', 'noopener')}
                  >
                    获取 API Key
                  </Button>
                </Group>
                <Switch
                  label="启用代理服务"
                  checked={proxyEnabled}
                  onChange={(event) => setProxyEnabled(event.currentTarget.checked)}
                />
                <Checkbox.Group
                  label="选择需要走代理的厂商"
                  description="至少勾选一个厂商，未勾选的厂商仍走官方接口"
                  value={proxyEnabledVendors}
                  onChange={setProxyEnabledVendors}
                  disabled={!proxyEnabled}
                >
                  <Stack gap={4} pt={4}>
                    {PROXY_TARGET_OPTIONS.map((opt) => (
                      <Checkbox key={opt.value} value={opt.value} label={opt.label} disabled={!proxyEnabled} />
                    ))}
                  </Stack>
                </Checkbox.Group>
                <Group justify="flex-end" mt="sm">
                  <Button variant="default" onClick={handleCloseProxyModal}>
                    取消
                  </Button>
                  <Button onClick={handleSaveProxyConfig} loading={proxySaving}>
                    保存
                  </Button>
                </Group>
              </Stack>
            </Modal>
            <Modal
              opened={modalOpen}
              onClose={() => setModalOpen(false)}
              fullScreen
              withinPortal
              zIndex={300}
              title="Sora 身份配置"
              styles={{
                content: {
                  height: '100vh',
                  paddingTop: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  paddingBottom: 16,
                },
                body: {
                  display: 'flex',
                  flexDirection: 'column',
                  height: '100%',
                  overflow: 'hidden',
                },
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                <Stack gap="md" style={{ flex: 1, overflowY: 'auto', paddingBottom: 8 }}>
                  <Text size="sm" c="dimmed">
                    你可以为 Sora 添加多个 Token，类似 n8n 的身份配置。它们将共用同一厂商额度。
                  </Text>
                  {isSoraProxyActive && (
                    <Alert color="grape" title="已启用 grsai 代理" radius="md">
                      当前视频任务会通过 {proxyConfig?.baseUrl || 'grsai'} 中转，无需公开 Sora 官方接口，代理结果会自动同步到节点。
                    </Alert>
                  )}
                  <Group spacing="xs">
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() =>
                        window.open('https://sora.chatgpt.com/api/auth/session', '_blank', 'noopener')
                      }
                    >
                      获取 session
                    </Button>
                    <Button size="xs" variant="light" onClick={() => setSessionModalOpen(true)}>
                      导入 session
                    </Button>
                  </Group>
                  <Stack gap="xs">
                    <div>
                      <TextInput
                        label="videos 域名（例如长视频 API）"
                        placeholder="例如：https://videos.sora.example.com"
                        value={videosUrl}
                        onChange={(e) => setVideosUrl(e.currentTarget.value)}
                        onBlur={async () => {
                          if (!soraProvider || !videosUrl.trim()) return
                          const saved = await upsertModelEndpoint({
                            id: videosEndpoint?.id,
                            providerId: soraProvider.id,
                            key: 'videos',
                            label: 'videos 域名',
                            baseUrl: videosUrl.trim(),
                            shared: videosShared,
                          })
                          setVideosEndpoint(saved)
                          useUIStore.getState().setSoraVideoBaseUrl(saved.baseUrl || null)
                        }}
            />
                      <Switch
                        size="xs"
                        mt={4}
                        label="将 videos 域名作为共享配置"
                        checked={videosShared}
                        onChange={async (e) => {
                          const next = e.currentTarget.checked
                          setVideosShared(next)
                          if (!soraProvider) return
                          const url = videosUrl.trim()
                          if (!url) return
                          try {
                            const saved = await upsertModelEndpoint({
                              id: videosEndpoint?.id,
                              providerId: soraProvider.id,
                              key: 'videos',
                              label: 'videos 域名',
                              baseUrl: url,
                              shared: next,
                            })
                            setVideosEndpoint(saved)
                          } catch (err) {
                            console.error('Failed to toggle videos shared flag', err)
                            setVideosShared(!next)
                          }
                        }}
                      />
                    </div>
                    <div>
                      <TextInput
                        label="video 域名（例如任务接口）"
                        placeholder="例如：https://video.sora.example.com"
                        value={videoUrl}
                        onChange={(e) => setVideoUrl(e.currentTarget.value)}
                        onBlur={async () => {
                          if (!soraProvider || !videoUrl.trim()) return
                          const saved = await upsertModelEndpoint({
                            id: videoEndpoint?.id,
                            providerId: soraProvider.id,
                            key: 'video',
                            label: 'video 域名',
                            baseUrl: videoUrl.trim(),
                            shared: videoShared,
                          })
                          setVideoEndpoint(saved)
                        }}
                      />
                      <Switch
                        size="xs"
                        mt={4}
                        label="将 video 域名作为共享配置"
                        checked={videoShared}
                        onChange={async (e) => {
                          const next = e.currentTarget.checked
                          setVideoShared(next)
                          if (!soraProvider) return
                          const url = videoUrl.trim()
                          if (!url) return
                          try {
                            const saved = await upsertModelEndpoint({
                              id: videoEndpoint?.id,
                              providerId: soraProvider.id,
                              key: 'video',
                              label: 'video 域名',
                              baseUrl: url,
                              shared: next,
                            })
                            setVideoEndpoint(saved)
                          } catch (err) {
                            console.error('Failed to toggle video shared flag', err)
                            setVideoShared(!next)
                          }
                        }}
                      />
                    </div>
                    <div>
                      <TextInput
                        label="sora 域名（通用控制 API）"
                        placeholder="例如：https://sora.sora.example.com"
                        value={soraUrl}
                        onChange={(e) => setSoraUrl(e.currentTarget.value)}
                        onBlur={async () => {
                          if (!soraProvider || !soraUrl.trim()) return
                          const saved = await upsertModelEndpoint({
                            id: soraEndpoint?.id,
                            providerId: soraProvider.id,
                            key: 'sora',
                            label: 'sora 域名',
                            baseUrl: soraUrl.trim(),
                            shared: soraShared,
                          })
                          setSoraEndpoint(saved)
                        }}
                      />
                      <Switch
                        size="xs"
                        mt={4}
                        label="将 sora 域名作为共享配置"
                        checked={soraShared}
                        onChange={async (e) => {
                          const next = e.currentTarget.checked
                          setSoraShared(next)
                          if (!soraProvider) return
                          const url = soraUrl.trim()
                          if (!url) return
                          try {
                            const saved = await upsertModelEndpoint({
                              id: soraEndpoint?.id,
                              providerId: soraProvider.id,
                              key: 'sora',
                              label: 'sora 域名',
                              baseUrl: url,
                              shared: next,
                            })
                            setSoraEndpoint(saved)
                          } catch (err) {
                            console.error('Failed to toggle sora shared flag', err)
                            setSoraShared(!next)
                          }
                        }}
                      />
                    </div>
                  </Stack>
                  <Group justify="space-between">
                    <Title order={5}>已保存的密钥</Title>
                    <Group gap="xs">
                      {tokens.length > 0 && (
                        <>
                          <Button
                            size="xs"
                            variant="subtle"
                            onClick={() => handleShareAllTokens(true)}
                          >
                            全部共享
                          </Button>
                          <Button
                            size="xs"
                            variant="subtle"
                            onClick={() => handleShareAllTokens(false)}
                          >
                            取消全部共享
                          </Button>
                        </>
                      )}
                      <Button size="xs" variant="light" onClick={openModalForNew}>
                        新增密钥
                      </Button>
                    </Group>
                  </Group>
                  {tokens.length === 0 && <Text size="sm">暂无密钥，请先新增一个。</Text>}
                  <Stack gap="xs">
                    {tokens.map((t) => (
                      <Group key={t.id} justify="space-between">
                        <div>
                          <Group gap={6}>
                            <Text size="sm">{t.label}</Text>
                            {t.shared && (
                              <Badge size="xs" color="grape">
                                共享
                              </Badge>
                            )}
                          </Group>
                          <Text size="xs" c="dimmed">
                            {t.secretToken ? t.secretToken.slice(0, 4) + '••••' : '已保存的密钥'}
                          </Text>
                        </div>
                        <Group gap="xs">
                          <Button
                            size="xs"
                            variant="subtle"
                            onClick={() => {
                              setEditingToken(t)
                              setLabel(t.label)
                              setSecret('')
                              setUserAgent(t.userAgent || '')
                              setShared(!!t.shared)
                              setModalOpen(true)
                            }}
                          >
                            编辑
                          </Button>
                          <Button size="xs" variant="light" color="red" onClick={() => handleDeleteToken(t.id)}>
                            删除
                          </Button>
                        </Group>
                      </Group>
                    ))}
                  </Stack>
                </Stack>
                <Paper withBorder radius="md" p="md">
                  <Stack gap="sm">
                    <Title order={6}>{editingToken ? '编辑密钥' : '新增密钥'}</Title>
                    <TextInput label="名称" placeholder="例如：主账号 Token" value={label} onChange={(e) => setLabel(e.currentTarget.value)} />
                    <TextInput
                      label="API Token"
                      placeholder={editingToken ? '留空则不修改已有密钥' : '粘贴你的 Sora API Token'}
                      value={secret}
                      onChange={(e) => setSecret(e.currentTarget.value)}
                    />
                    <TextInput
                      label="User-Agent"
                      placeholder="例如：TapCanvas/1.0 (user@example.com)"
                      value={userAgent}
                      onChange={(e) => setUserAgent(e.currentTarget.value)}
                    />
                    <Switch
                      label="将此密钥作为共享配置（其他未配置或超额的用户可复用）"
                      checked={shared}
                      onChange={(e) => setShared(e.currentTarget.checked)}
                    />
                    <Group justify="flex-end" mt="sm">
                      <Button variant="default" onClick={() => setModalOpen(false)}>
                        取消
                      </Button>
                      <Button onClick={handleSaveToken}>保存</Button>
                    </Group>
                  </Stack>
                </Paper>
              </div>
            </Modal>
          </div>
        )}
      </Transition>
    </div>
  )
}
