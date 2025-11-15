import React from 'react'
import { Paper, Title, Text, Button, Group, Stack, Transition, Modal, TextInput, Badge, Switch } from '@mantine/core'
import { useUIStore } from './uiStore'
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
  const setActivePanel = useUIStore((s) => s.setActivePanel)
  const anchorY = useUIStore((s) => s.panelAnchorY)
  const mounted = active === 'models'
  const [providers, setProviders] = React.useState<ModelProviderDto[]>([])
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
  const [geminiProvider, setGeminiProvider] = React.useState<ModelProviderDto | null>(null)
  const [geminiBaseUrl, setGeminiBaseUrl] = React.useState('')
  const [geminiTokens, setGeminiTokens] = React.useState<ModelTokenDto[]>([])
  const [geminiModalOpen, setGeminiModalOpen] = React.useState(false)
  const [geminiEditingToken, setGeminiEditingToken] = React.useState<ModelTokenDto | null>(null)
  const [geminiLabel, setGeminiLabel] = React.useState('')
  const [geminiSecret, setGeminiSecret] = React.useState('')
  const [geminiShared, setGeminiShared] = React.useState(false)

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

  const handleShareAllTokens = async (sharedFlag: boolean) => {
    if (!soraProvider || tokens.length === 0) return
    const updated: ModelTokenDto[] = []
    for (const t of tokens) {
      try {
        const saved = await upsertModelToken({
          id: t.id,
          providerId: soraProvider.id,
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
    setTokens(updated)
  }

  return (
    <div style={{ position: 'fixed', left: 82, top: anchorY ? anchorY - 150 : 140, zIndex: 7000 }} data-ux-panel>
      <Transition mounted={mounted} transition="pop" duration={140} timingFunction="ease">
        {(styles) => (
          <div style={styles}>
            <Paper withBorder shadow="md" radius="lg" className="glass" p="md" style={{ width: 420, maxHeight: '70vh', transformOrigin: 'left center' }} data-ux-panel>
              <div className="panel-arrow" />
              <Group justify="space-between" mb={8} style={{ position: 'sticky', top: 0, zIndex: 1, background: 'transparent' }}>
                <Title order={6}>模型配置</Title>
                <Button size="xs" variant="light" onClick={() => setActivePanel(null)}>
                  关闭
                </Button>
              </Group>
              <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
                <Stack gap="sm">
                  <Paper withBorder radius="md" p="sm" style={{ position: 'relative' }}>
                    <Group justify="space-between" mb={4}>
                      <div>
                        <Group gap={6}>
                          <Title order={6}>Sora</Title>
                          <Badge color="blue" size="xs">
                            Beta
                          </Badge>
                        </Group>
                        <Text size="xs" c="dimmed">
                          配置多个 Sora API Token，共享同一厂商额度
                        </Text>
                      </div>
                      <Button size="xs" onClick={openModalForNew}>
                        管理密钥
                      </Button>
                    </Group>
                    <Text size="xs" c="dimmed">
                      已配置密钥：{tokens.length}
                    </Text>
                  </Paper>
                  <Paper withBorder radius="md" p="sm" style={{ position: 'relative' }}>
                    <Group justify="space-between" mb={4}>
                      <div>
                        <Group gap={6}>
                          <Title order={6}>Gemini</Title>
                          <Badge color="grape" size="xs">
                            Beta
                          </Badge>
                        </Group>
                        <Text size="xs" c="dimmed">
                          配置 Gemini API Key（Google AI Studio / Vertex AI）
                        </Text>
                      </div>
                      <Button size="xs" onClick={openGeminiModalForNew}>
                        管理密钥
                      </Button>
                    </Group>
                    <Text size="xs" c="dimmed">
                      已配置密钥：{geminiTokens.length}
                    </Text>
                  </Paper>
                </Stack>
              </div>
            </Paper>
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
                        }}
                      />
                      <Switch
                        size="xs"
                        mt={4}
                        label="将 videos 域名作为共享配置"
                        checked={videosShared}
                        onChange={(e) => setVideosShared(e.currentTarget.checked)}
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
                        onChange={(e) => setVideoShared(e.currentTarget.checked)}
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
                        onChange={(e) => setSoraShared(e.currentTarget.checked)}
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
                  <Text size="sm" c="dimmed">
                    在此配置 Gemini API Key。后续可以为文本/视频节点选择使用 Gemini 作为底层模型。
                  </Text>
                  <TextInput
                    label="Gemini 代理 Base URL"
                    placeholder="例如：https://your-proxy.example.com"
                    value={geminiBaseUrl}
                    onChange={(e) => setGeminiBaseUrl(e.currentTarget.value)}
                    onBlur={async () => {
                      if (!geminiProvider) return
                      const saved = await upsertModelProvider({
                        id: geminiProvider.id,
                        name: geminiProvider.name,
                        vendor: geminiProvider.vendor,
                        baseUrl: geminiBaseUrl.trim() || null,
                      })
                      setGeminiProvider(saved)
                      setGeminiBaseUrl(saved.baseUrl || '')
                    }}
                  />
                  <Group justify="space-between">
                    <Title order={5}>已保存的密钥</Title>
                    <Button size="xs" variant="light" onClick={openGeminiModalForNew}>
                      新增密钥
                    </Button>
                  </Group>
                  {geminiTokens.length === 0 && <Text size="sm">暂无密钥，请先新增一个。</Text>}
                  <Stack gap="xs">
                    {geminiTokens.map((t) => (
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
                              setGeminiEditingToken(t)
                              setGeminiLabel(t.label)
                              setGeminiSecret('')
                              setGeminiShared(!!t.shared)
                              setGeminiModalOpen(true)
                            }}
                          >
                            编辑
                          </Button>
                          <Button size="xs" variant="light" color="red" onClick={() => handleDeleteGeminiToken(t.id)}>
                            删除
                          </Button>
                        </Group>
                      </Group>
                    ))}
                  </Stack>
                </Stack>
                <Paper withBorder radius="md" p="md">
                  <Stack gap="sm">
                    <Title order={6}>{geminiEditingToken ? '编辑密钥' : '新增密钥'}</Title>
                    <TextInput label="名称" placeholder="例如：Gemini 主账号 Key" value={geminiLabel} onChange={(e) => setGeminiLabel(e.currentTarget.value)} />
                    <TextInput
                      label="API Key"
                      placeholder={geminiEditingToken ? '留空则不修改已有密钥' : '粘贴你的 Gemini API Key'}
                      value={geminiSecret}
                      onChange={(e) => setGeminiSecret(e.currentTarget.value)}
                    />
                    <Switch
                      label="将此密钥作为共享配置（其他未配置或超额的用户可复用）"
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
          </div>
        )}
      </Transition>
    </div>
  )
}
