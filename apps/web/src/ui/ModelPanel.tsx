import React from 'react'
import { Paper, Title, Text, Button, Group, Stack, Transition, Modal, TextInput, Badge, Switch, Textarea, ActionIcon, Tooltip, FileInput } from '@mantine/core'
import { IconDownload, IconUpload, IconTrash } from '@tabler/icons-react'
import { notifications } from '@mantine/notifications'
import { useUIStore } from './uiStore'
import { calculateSafeMaxHeight } from './utils/panelPosition'
import {
  deleteModelToken,
  listModelEndpoints,
  listModelProviders,
  listModelTokens,
  upsertModelEndpoint,
  upsertModelProvider,
  upsertModelToken,
  type ModelProviderDto,
  type ModelTokenDto,
  type ModelEndpointDto,
} from '../api/server'

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
      setTokens([])
      setGeminiTokens([])
      setAnthropicTokens([])
      setQwenTokens([])
      setGeminiBaseUrl('')
      setAnthropicBaseUrl('')
      setAnthropicBaseShared(false)
      setVideosEndpoint(null)
      setVideoEndpoint(null)
      setSoraEndpoint(null)
      setVideosUrl('')
      setVideoUrl('')
      setSoraUrl('')
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
            }

            // 刷新Qwen数据
            let qwen = ps.find((p) => p.vendor === 'qwen')
            if (qwen) {
              setQwenProvider(qwen)
              const qwenTokenData = await listModelTokens(qwen.id)
              setQwenTokens(qwenTokenData)
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
  const [sessionModalOpen, setSessionModalOpen] = React.useState(false)
  const [sessionJson, setSessionJson] = React.useState('')
  const [sessionError, setSessionError] = React.useState('')
  const [geminiProvider, setGeminiProvider] = React.useState<ModelProviderDto | null>(null)
  const [geminiBaseUrl, setGeminiBaseUrl] = React.useState('')
  const [geminiTokens, setGeminiTokens] = React.useState<ModelTokenDto[]>([])
  const [geminiModalOpen, setGeminiModalOpen] = React.useState(false)
  const [geminiEditingToken, setGeminiEditingToken] = React.useState<ModelTokenDto | null>(null)
  const [geminiLabel, setGeminiLabel] = React.useState('')
  const [geminiSecret, setGeminiSecret] = React.useState('')
  const [geminiShared, setGeminiShared] = React.useState(false)
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

        // 初始化 Qwen 提供方
        let qwen = ps.find((p) => p.vendor === 'qwen')
        if (!qwen) {
          qwen = await upsertModelProvider({ name: 'Qwen', vendor: 'qwen' })
          setProviders((prev) => [...prev, qwen!])
        }
        setQwenProvider(qwen)
        const qTokens = await listModelTokens(qwen.id)
        setQwenTokens(qTokens)
      })
      .catch(() => {})
  }, [mounted])

  if (!mounted) return null

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
    if (!finalSecret.trim()) {
      alert('请填写 API Token')
      return
    }
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

  const openGeminiModalForNew = () => {
    setGeminiEditingToken(null)
    setGeminiLabel('')
    setGeminiSecret('')
    setGeminiShared(false)
    setGeminiModalOpen(true)
  }

  const handleSaveGeminiToken = async () => {
    if (!geminiProvider) return
    const existingSecret = geminiEditingToken?.secretToken ?? ''
    const finalSecret = geminiSecret || existingSecret
    if (!finalSecret.trim()) {
      alert('请填写 API Key')
      return
    }
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
    if (!finalSecret.trim()) {
      alert('请填写 API Key')
      return
    }
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
  }

  const handleDeleteAnthropicToken = async (id: string) => {
    if (!confirm('确定删除该密钥吗？')) return
    await deleteModelToken(id)
    setAnthropicTokens((prev) => prev.filter((t) => t.id !== id))
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
    if (!finalSecret.trim()) {
      alert('请填写 DashScope API Key')
      return
    }
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
  }

  const handleShareAllTokens = (sharedFlag: boolean) => bulkShareTokens(soraProvider, tokens, sharedFlag, setTokens)
  const handleShareAllGeminiTokens = (sharedFlag: boolean) => bulkShareTokens(geminiProvider, geminiTokens, sharedFlag, setGeminiTokens)
  const handleShareAllAnthropicTokens = (sharedFlag: boolean) => bulkShareTokens(anthropicProvider, anthropicTokens, sharedFlag, setAnthropicTokens)
  const handleShareAllQwenTokens = (sharedFlag: boolean) => bulkShareTokens(qwenProvider, qwenTokens, sharedFlag, setQwenTokens)

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
                  <Paper withBorder radius="md" p="sm" style={{ position: 'relative' }}>
                    <Group justify="space-between" align="flex-start" mb={4}>
                      <Group gap={6}>
                        <Title order={6}>Sora</Title>
                        <Badge color="blue" size="xs">
                          Beta
                        </Badge>
                      </Group>
                      <Group spacing="xs">
                        <Button size="xs" onClick={openModalForNew}>
                          管理密钥
                        </Button>
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() =>
                            window.open('https://sora.chatgpt.com/api/auth/session', '_blank', 'noopener')
                          }
                        >
                          获取 session
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
                        <Title order={6}>Gemini</Title>
                        <Badge color="grape" size="xs">
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
                  </Paper>
                </Stack>
              </div>
            </Paper>
                      <Modal
              opened={anthropicModalOpen}
              onClose={() => setAnthropicModalOpen(false)}
              fullScreen
              withinPortal
              zIndex={8000}
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
              zIndex={8000}
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
              zIndex={8000}
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
              opened={modalOpen}
              onClose={() => setModalOpen(false)}
              fullScreen
              withinPortal
              zIndex={8000}
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
