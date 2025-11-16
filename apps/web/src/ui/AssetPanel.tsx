import React from 'react'
import { Paper, Title, SimpleGrid, Card, Image, Text, Button, Group, Stack, Transition, Tabs, Select, ActionIcon, Tooltip, Loader, Center, Modal, TextInput } from '@mantine/core'
import { useRFStore } from '../canvas/store'
import { useUIStore } from './uiStore'
import {
  listServerAssets,
  createServerAsset,
  deleteServerAsset,
  renameServerAsset,
  listModelProviders,
  listModelTokens,
  listSoraDrafts,
  deleteSoraDraft,
  markDraftPromptUsed,
  listSoraCharacters,
  deleteSoraCharacter,
  checkSoraCharacterUsername,
  updateSoraCharacter,
  uploadSoraCharacterVideo,
  isSoraCameoInProgress,
  finalizeSoraCharacter,
  setSoraCameoPublic,
  uploadSoraProfileAsset,
  type ServerAssetDto,
  type ModelProviderDto,
  type ModelTokenDto,
} from '../api/server'
import { IconPlayerPlay, IconPlus, IconTrash, IconPencil } from '@tabler/icons-react'
import { VideoTrimModal } from './VideoTrimModal'

function PlaceholderImage({ label }: { label: string }) {
  const svg = encodeURIComponent(`<?xml version="1.0" encoding="UTF-8"?><svg xmlns='http://www.w3.org/2000/svg' width='480' height='270'><defs><linearGradient id='g' x1='0' x2='1'><stop offset='0%' stop-color='#1f2937'/><stop offset='100%' stop-color='#0b0b0d'/></linearGradient></defs><rect width='100%' height='100%' fill='url(#g)'/><text x='50%' y='50%' fill='#e5e7eb' dominant-baseline='middle' text-anchor='middle' font-size='16' font-family='system-ui'>${label}</text></svg>`) 
  return <Image src={`data:image/svg+xml;charset=UTF-8,${svg}`} alt={label} radius="sm" />
}

export default function AssetPanel(): JSX.Element | null {
  const active = useUIStore(s => s.activePanel)
  const setActivePanel = useUIStore(s => s.setActivePanel)
  const anchorY = useUIStore(s => s.panelAnchorY)
  const addNodes = useRFStore(s => s.load)
  const addNode = useRFStore(s => s.addNode)
  const openPreview = useUIStore(s => s.openPreview)
  const mounted = active === 'assets'
  const currentProject = useUIStore(s => s.currentProject)
  const [assets, setAssets] = React.useState<ServerAssetDto[]>([])
  const [tab, setTab] = React.useState<'local' | 'sora' | 'sora-characters'>('local')
  const [soraProviders, setSoraProviders] = React.useState<ModelProviderDto[]>([])
  const [soraTokens, setSoraTokens] = React.useState<ModelTokenDto[]>([])
  const [selectedTokenId, setSelectedTokenId] = React.useState<string | null>(null)
  const [drafts, setDrafts] = React.useState<any[]>([])
  const [draftCursor, setDraftCursor] = React.useState<string | null>(null)
  const [draftLoading, setDraftLoading] = React.useState(false)
  const [soraUsingShared, setSoraUsingShared] = React.useState(false)
  const [characters, setCharacters] = React.useState<any[]>([])
  const [charCursor, setCharCursor] = React.useState<string | null>(null)
  const [charLoading, setCharLoading] = React.useState(false)
  const [soraCharUsingShared, setSoraCharUsingShared] = React.useState(false)
  const [renameCharOpen, setRenameCharOpen] = React.useState(false)
  const [renameCharTarget, setRenameCharTarget] = React.useState<any | null>(null)
  const [renameCharName, setRenameCharName] = React.useState('')
  const [renameCharError, setRenameCharError] = React.useState<string | null>(null)
  const [renameCharChecking, setRenameCharChecking] = React.useState(false)
  const renameDebounceRef = React.useRef<number | null>(null)
  const [deletingCharId, setDeletingCharId] = React.useState<string | null>(null)
  const createCharInputRef = React.useRef<HTMLInputElement | null>(null)
  const [createCharFile, setCreateCharFile] = React.useState<File | null>(null)
  const [createCharVideoUrl, setCreateCharVideoUrl] = React.useState<string | null>(null)
  const [createCharDuration, setCreateCharDuration] = React.useState(0)
  const [createCharTrimOpen, setCreateCharTrimOpen] = React.useState(false)
  const [createCharUploading, setCreateCharUploading] = React.useState(false)
  const [createCharFinalizeOpen, setCreateCharFinalizeOpen] = React.useState(false)
  const [createCharCameoId, setCreateCharCameoId] = React.useState<string | null>(null)
  const [createCharAssetPointer, setCreateCharAssetPointer] = React.useState<any | null>(null)
  const [createCharUsername, setCreateCharUsername] = React.useState('')
  const [createCharDisplayName, setCreateCharDisplayName] = React.useState('')
  const [createCharUsernameError, setCreateCharUsernameError] = React.useState<string | null>(null)
  const [createCharUsernameChecking, setCreateCharUsernameChecking] = React.useState(false)
  const [createCharSubmitting, setCreateCharSubmitting] = React.useState(false)
  const createCharUsernameDebounceRef = React.useRef<number | null>(null)
  const [createCharCoverPreview, setCreateCharCoverPreview] = React.useState<string | null>(null)
  const [createCharCoverUploading, setCreateCharCoverUploading] = React.useState(false)
  const createCharCoverInputRef = React.useRef<HTMLInputElement | null>(null)
  const createCharThumbs = React.useMemo(() => {
    if (!createCharVideoUrl || !createCharDuration) return []
    const usedDuration = Math.min(createCharDuration, 2)
    const count = Math.max(10, Math.round(usedDuration))
    return Array.from({ length: count }, () => createCharVideoUrl)
  }, [createCharVideoUrl, createCharDuration])
  React.useEffect(() => {
    const loader = currentProject?.id ? listServerAssets(currentProject.id) : Promise.resolve([])
    loader.then(setAssets).catch(() => setAssets([]))
  }, [currentProject?.id, mounted])

  React.useEffect(() => {
    if (!mounted || (tab !== 'sora' && tab !== 'sora-characters')) return
    if (tab === 'sora') setDraftLoading(true)
    if (tab === 'sora-characters') setCharLoading(true)
    listModelProviders()
      .then((ps) => {
        const soras = ps.filter((p) => p.vendor === 'sora')
        setSoraProviders(soras)
        return soras[0]
      })
      .then(async (sora) => {
        if (!sora) {
          setSoraTokens([])
          setDrafts([])
          setCharacters([])
          setSelectedTokenId(null)
          return
        }
        const tokens = await listModelTokens(sora.id)
        setSoraTokens(tokens)

        // 当进入 Sora 草稿或角色 Tab 时，如果还没有选择 Token，则默认选第一个
        if (!selectedTokenId && tokens.length > 0) {
          setSelectedTokenId(tokens[0].id)
        }

        // 根据当前 Tab 加载对应的数据
        const activeTokenId = selectedTokenId || (tokens[0]?.id ?? null)

        if (tab === 'sora') {
          if (activeTokenId) {
            setSoraUsingShared(false)
            try {
              const data = await listSoraDrafts(activeTokenId)
              setDrafts(data.items || [])
              setDraftCursor(data.cursor || null)
            } catch (err: any) {
              console.error(err)
              alert('当前配置不可用，请稍后再试')
              setDrafts([])
              setDraftCursor(null)
            }
          } else {
            // 没有用户自己的 Token，尝试使用共享配置
            setSelectedTokenId(null)
            try {
              const data = await listSoraDrafts()
              setDrafts(data.items || [])
              setDraftCursor(data.cursor || null)
              setSoraUsingShared(true)
            } catch (err: any) {
              console.error(err)
              setDrafts([])
              setDraftCursor(null)
              setSoraUsingShared(false)
            }
          }
        } else if (tab === 'sora-characters') {
          if (activeTokenId) {
            setSoraCharUsingShared(false)
            try {
              const data = await listSoraCharacters(activeTokenId)
              setCharacters(data.items || [])
              setCharCursor(data.cursor || null)
            } catch (err: any) {
              console.error(err)
              alert('当前配置不可用，请稍后再试')
              setCharacters([])
              setCharCursor(null)
            }
          } else {
            setCharacters([])
            setCharCursor(null)
            setSoraCharUsingShared(false)
          }
        }
      })
      .catch(() => {
        setSoraProviders([])
        setSoraTokens([])
        setDrafts([])
        setCharacters([])
        setSelectedTokenId(null)
        setDraftCursor(null)
        setCharCursor(null)
      })
      .finally(() => {
        if (tab === 'sora') setDraftLoading(false)
        if (tab === 'sora-characters') setCharLoading(false)
      })
  }, [mounted, tab, selectedTokenId])

  const loadMoreDrafts = async () => {
    if (!selectedTokenId || !draftCursor) return
    setDraftLoading(true)
    try {
      const data = await listSoraDrafts(selectedTokenId, draftCursor)
      setDrafts(prev => [...prev, ...(data.items || [])])
      setDraftCursor(data.cursor || null)
    } catch (err: any) {
      console.error(err)
      alert(err?.message || '当前配置不可用，请稍后再试')
    } finally {
      setDraftLoading(false)
    }
  }

  const loadMoreCharacters = async () => {
    if (!selectedTokenId || !charCursor) return
    setCharLoading(true)
    try {
      const data = await listSoraCharacters(selectedTokenId, charCursor)
      setCharacters(prev => [...prev, ...(data.items || [])])
      setCharCursor(data.cursor || null)
    } catch (err: any) {
      console.error(err)
      alert('当前配置不可用，请稍后再试')
    } finally {
      setCharLoading(false)
    }
  }

  const addDraftToCanvas = (d: any) => {
    if (!d?.videoUrl) return
    addNode('taskNode', d.title || 'Sora 草稿', {
      kind: 'video',
      source: 'sora',
      videoUrl: d.videoUrl,
      thumbnailUrl: d.thumbnailUrl,
      prompt: d.prompt || '',
    })
    if (d.prompt) {
      markDraftPromptUsed(d.prompt, 'sora').catch(() => {})
    }
    setActivePanel(null)
  }
  if (!mounted) return null

  const handlePickCharacterVideo = () => {
    if (!selectedTokenId) return
    if (createCharInputRef.current) {
      createCharInputRef.current.value = ''
      createCharInputRef.current.click()
    }
  }

  const handleCharacterFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.currentTarget.files?.[0]
    if (!file) return
    if (!file.type.startsWith('video/')) {
      alert('请选择视频文件')
      return
    }
    const url = URL.createObjectURL(file)
    try {
      const duration = await new Promise<number>((resolve, reject) => {
        const v = document.createElement('video')
        v.preload = 'metadata'
        v.onloadedmetadata = () => {
          resolve(v.duration || 0)
        }
        v.onerror = () => {
          reject(new Error('无法读取视频时长'))
        }
        v.src = url
      })
      setCreateCharFile(file)
      setCreateCharVideoUrl(url)
      setCreateCharDuration(duration || 0)
      setCreateCharTrimOpen(true)
    } catch (err: any) {
      console.error(err)
      alert(err?.message || '无法读取视频时长，请稍后重试')
      URL.revokeObjectURL(url)
      setCreateCharVideoUrl(null)
      setCreateCharDuration(0)
      setCreateCharFile(null)
    }
  }

  const handleTrimClose = () => {
    setCreateCharTrimOpen(false)
    if (createCharVideoUrl) {
      URL.revokeObjectURL(createCharVideoUrl)
    }
    setCreateCharVideoUrl(null)
    setCreateCharDuration(0)
    setCreateCharFile(null)
  }

  const handlePickCover = () => {
    if (!selectedTokenId) return
    if (createCharCoverInputRef.current) {
      createCharCoverInputRef.current.value = ''
      createCharCoverInputRef.current.click()
    }
  }

  const handleCoverFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.currentTarget.files?.[0]
    if (!file || !selectedTokenId) return
    if (!file.type.startsWith('image/')) {
      alert('请选择图片文件作为封面')
      return
    }
    setCreateCharCoverUploading(true)
    try {
      const res = await uploadSoraProfileAsset(selectedTokenId, file)
      const pointer =
        res?.asset_pointer ??
        res?.azure_asset_pointer ??
        res?.file_id ??
        null
      setCreateCharAssetPointer(pointer)
      if (createCharCoverPreview) {
        URL.revokeObjectURL(createCharCoverPreview)
      }
      const url = URL.createObjectURL(file)
      setCreateCharCoverPreview(url)
    } catch (err: any) {
      console.error(err)
      alert(err?.message || '上传封面失败，请稍后重试')
    } finally {
      setCreateCharCoverUploading(false)
    }
  }

  const handleTrimConfirm = async (range: { start: number; end: number }) => {
    if (!createCharFile || !selectedTokenId) return
    if (createCharUploading) return
    setCreateCharUploading(true)
    try {
      const start = Math.max(0, range.start)
      const end = Math.max(start, Math.min(range.end, start + 2))
      const uploadResult = await uploadSoraCharacterVideo(
        selectedTokenId,
        createCharFile,
        [start, end],
      )

      const taskId: string | undefined =
        (uploadResult && (uploadResult.lastTask?.id || uploadResult.id)) ||
        undefined

      if (taskId) {
        try {
          // 轮询任务进度，直到不再处于 in_progress 或超时
          for (let i = 0; i < 20; i++) {
            const inProgress = await isSoraCameoInProgress(selectedTokenId, taskId)
            if (!inProgress) break
            // 约 1.5s 轮询一次
            // eslint-disable-next-line no-await-in-loop
            await new Promise(resolve => setTimeout(resolve, 1500))
          }
        } catch (err) {
          console.warn('轮询 Sora 角色创建进度失败：', err)
        }
      }

      setCreateCharTrimOpen(false)
      if (createCharVideoUrl) {
        URL.revokeObjectURL(createCharVideoUrl)
      }
      setCreateCharVideoUrl(null)
      setCreateCharDuration(0)
      setCreateCharFile(null)
      const cameoId =
        (uploadResult && (uploadResult.cameo?.id || uploadResult.id)) || null
      setCreateCharCameoId(cameoId)
      setCreateCharAssetPointer(null)
      setCreateCharUsername('')
      setCreateCharDisplayName('')
      setCreateCharUsernameError(null)
      setCreateCharFinalizeOpen(true)
    } catch (err: any) {
      console.error(err)
      alert(err?.message || '上传角色视频失败，请稍后重试')
    } finally {
      setCreateCharUploading(false)
    }
  }

  const applyAssetAt = (assetId: string, pos: { x: number; y: number }) => {
    const rec = assets.find(a => a.id === assetId)
    if (!rec) return
    // translate nodes by shift to current position (align min corner)
    const data: any = rec.data || { nodes: [], edges: [] }
    const minX = Math.min(...(data.nodes||[]).map((n: any) => n.position.x))
    const minY = Math.min(...(data.nodes||[]).map((n: any) => n.position.y))
    const dx = pos.x - minX
    const dy = pos.y - minY
    const nodes = (data.nodes||[]).map((n: any) => ({ ...n, id: `n${Math.random().toString(36).slice(2,6)}`, position: { x: n.position.x + dx, y: n.position.y + dy }, selected: false }))
    const edges = (data.edges||[]).map((e: any) => ({ ...e, id: `e${Math.random().toString(36).slice(2,6)}`, selected: false }))
    useRFStore.setState(s => ({ nodes: [...s.nodes, ...nodes], edges: [...s.edges, ...edges], nextId: s.nextId + nodes.length }))
  }

  return (
    <div style={{ position: 'fixed', left: 82, top: (anchorY ? anchorY - 150 : 140), zIndex: 6001 }} data-ux-panel>
      <Transition mounted={mounted} transition="pop" duration={140} timingFunction="ease">
        {(styles) => (
          <div style={styles}>
            <Paper withBorder shadow="md" radius="lg" className="glass" p="md" style={{ width: 640, maxHeight: '70vh', transformOrigin: 'left center' }} data-ux-panel>
              <div className="panel-arrow" />
              <input
                ref={createCharCoverInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handleCoverFileChange}
              />
              <input
                ref={createCharInputRef}
                type="file"
                accept="video/*"
                style={{ display: 'none' }}
                onChange={handleCharacterFileChange}
              />
              <Group justify="space-between" mb={8} style={{ position: 'sticky', top: 0, zIndex: 1, background: 'transparent' }}>
                <Title order={6}>我的资产（项目：{currentProject?.name || '未选择'}）</Title>
              </Group>
              <Tabs value={tab} onChange={(v) => setTab((v as any) || 'local')}>
                <Tabs.List>
                  <Tabs.Tab value="local">项目资产</Tabs.Tab>
                  <Tabs.Tab value="sora">Sora 草稿</Tabs.Tab>
                  <Tabs.Tab value="sora-characters">Sora 角色</Tabs.Tab>
                </Tabs.List>
                <Tabs.Panel value="local" pt="xs">
                  <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
                    {assets.length === 0 && (<Text size="xs" c="dimmed">暂无资产</Text>)}
                    <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                      {assets.map(a => (
                        <Card key={a.id} withBorder radius="md" shadow="sm">
                          <PlaceholderImage label={a.name} />
                          <Group justify="space-between" mt="sm">
                            <Text size="sm">{a.name}</Text>
                            <Group gap={6}>
                              <Button size="xs" variant="light" onClick={()=>{ const pos = { x: 200, y: (anchorY||200) }; applyAssetAt(a.id, pos); setActivePanel(null) }}>添加</Button>
                              <Button size="xs" variant="subtle" onClick={async ()=>{ const next = prompt('重命名：', a.name)?.trim(); if (!next || next===a.name) return; await renameServerAsset(a.id, next); setAssets(await listServerAssets(currentProject!.id!)) }}>重命名</Button>
                              <Button size="xs" color="red" variant="subtle" onClick={async ()=>{ if (confirm('删除该资产？')) { await deleteServerAsset(a.id); setAssets(await listServerAssets(currentProject!.id!)) } }}>删除</Button>
                            </Group>
                          </Group>
                        </Card>
                      ))}
                    </SimpleGrid>
                  </div>
                </Tabs.Panel>
                <Tabs.Panel value="sora" pt="xs">
                  <Stack gap="sm">
                    <Group justify="space-between">
                      <Text size="sm">Sora Token 身份</Text>
                      <Select
                        size="xs"
                        placeholder={soraTokens.length === 0 ? '暂无 Sora 密钥' : '选择 Token'}
                        data={soraTokens.map((t) => ({ value: t.id, label: t.label }))}
                        value={selectedTokenId}
                        comboboxProps={{ zIndex: 8005 }}
                        onChange={async (value) => {
                          setSelectedTokenId(value)
                          setSoraUsingShared(false)
                          // 切换身份时先清空当前列表并展示加载态，过渡更自然
                          setDrafts([])
                          setDraftCursor(null)
                          if (value) {
                            setDraftLoading(true)
                            try {
                              const data = await listSoraDrafts(value)
                              setDrafts(data.items || [])
                              setDraftCursor(data.cursor || null)
                            } catch (err: any) {
                              console.error(err)
                              alert('当前配置不可用，请稍后再试')
                              setDrafts([])
                              setDraftCursor(null)
                            } finally {
                              setDraftLoading(false)
                            }
                          } else {
                            setDrafts([])
                            setDraftCursor(null)
                          }
                        }}
                      />
                    </Group>
                    {soraUsingShared && (
                      <Text size="xs" c="dimmed">
                        正在使用共享的 Sora 配置
                      </Text>
                    )}
                    <div style={{ maxHeight: '52vh', overflowY: 'auto' }}>
                      {draftLoading && drafts.length === 0 && (
                        <Center py="sm">
                          <Group gap="xs">
                            <Loader size="xs" />
                            <Text size="xs" c="dimmed">
                              正在加载 Sora 草稿…
                            </Text>
                          </Group>
                        </Center>
                      )}
                      {!draftLoading && drafts.length === 0 && (
                        <Text size="xs" c="dimmed">暂无草稿或未选择 Token</Text>
                      )}
                      <SimpleGrid cols={{ base: 2, sm: 3, md: 4 }} spacing="xs">
                        {drafts.map((d, idx) => (
                          <Paper key={d.id ?? idx} withBorder radius="md" p="xs">
                            {d.thumbnailUrl && (
                              <Image
                                src={d.thumbnailUrl}
                                alt={d.title || d.id || `草稿 ${idx + 1}`}
                                radius="sm"
                                mb={4}
                                height={100}
                                fit="cover"
                              />
                            )}
                            <Text size="xs" fw={500} lineClamp={1}>
                              {d.title || `草稿 ${idx + 1}`}
                            </Text>
                            <div style={{ minHeight: 34, marginTop: 2 }}>
                              {d.prompt && (
                                <Text size="xs" c="dimmed" lineClamp={2}>
                                  {d.prompt}
                                </Text>
                              )}
                            </div>
                            <Group justify="flex-end" gap={4} mt={4}>
                              <Tooltip label="预览草稿" withArrow>
                                <ActionIcon
                                  size="sm"
                                  variant="subtle"
                                  onClick={() => {
                                    if (!d.videoUrl) return
                                    openPreview({ url: d.videoUrl, kind: 'video', name: d.title || d.id || `草稿 ${idx + 1}` })
                                  }}
                                >
                                  <IconPlayerPlay size={16} />
                                </ActionIcon>
                              </Tooltip>
                              <Tooltip label="添加到画布" withArrow>
                                <ActionIcon
                                  size="sm"
                                  variant="light"
                                  onClick={() => addDraftToCanvas(d)}
                                >
                                  <IconPlus size={16} />
                                </ActionIcon>
                              </Tooltip>
                              <Tooltip label="删除草稿" withArrow>
                                <ActionIcon
                                  size="sm"
                                  variant="subtle"
                                  color="red"
                                  onClick={async () => {
                                    if (!selectedTokenId || !d.id) return
                                    if (!confirm('确定删除该草稿吗？此操作不可恢复')) return
                                    try {
                                      await deleteSoraDraft(selectedTokenId, d.id)
                                      setDrafts(prev => prev.filter(x => x.id !== d.id))
                                    } catch (err: any) {
                                      console.error(err)
                                      alert('当前配置不可用，请稍后再试')
                                    }
                                  }}
                                >
                                  <IconTrash size={16} />
                                </ActionIcon>
                              </Tooltip>
                            </Group>
                          </Paper>
                        ))}
                      </SimpleGrid>
                      {draftCursor && (
                        <Group justify="center" mt="sm">
                          <Button size="xs" variant="light" loading={draftLoading} onClick={loadMoreDrafts}>
                            加载更多
                          </Button>
                        </Group>
                      )}
                    </div>
                  </Stack>
                </Tabs.Panel>
                <Tabs.Panel value="sora-characters" pt="xs">
                  <Stack gap="sm">
                    <Group justify="space-between">
                      <Group gap="xs">
                        <Text size="sm">Sora Token 身份</Text>
                        <Select
                          size="xs"
                          placeholder={soraTokens.length === 0 ? '暂无 Sora 密钥' : '选择 Token'}
                          data={soraTokens.map((t) => ({ value: t.id, label: t.label }))}
                          value={selectedTokenId}
                          comboboxProps={{ zIndex: 8005 }}
                          onChange={async (value) => {
                            setSelectedTokenId(value)
                            setSoraCharUsingShared(false)
                            setCharacters([])
                            setCharCursor(null)
                            if (value) {
                              setCharLoading(true)
                              try {
                                const data = await listSoraCharacters(value)
                                setCharacters(data.items || [])
                                setCharCursor(data.cursor || null)
                              } catch (err: any) {
                                console.error(err)
                                alert('当前配置不可用，请稍后再试')
                                setCharacters([])
                                setCharCursor(null)
                              } finally {
                                setCharLoading(false)
                              }
                            } else {
                              setCharacters([])
                              setCharCursor(null)
                            }
                          }}
                        />
                      </Group>
                      <Button
                        size="xs"
                        variant="light"
                        disabled={!selectedTokenId}
                        onClick={handlePickCharacterVideo}
                      >
                        创建角色
                      </Button>
                    </Group>
                    {createCharUploading && (
                      <Group gap="xs">
                        <Loader size="xs" />
                        <Text size="xs" c="dimmed">
                          正在创建 Sora 角色，请稍候…
                        </Text>
                      </Group>
                    )}
                    {soraCharUsingShared && (
                      <Text size="xs" c="dimmed">
                        正在使用共享的 Sora 配置
                      </Text>
                    )}
                    <div style={{ maxHeight: '52vh', overflowY: 'auto' }}>
                      {charLoading && characters.length === 0 && (
                        <Center py="sm">
                          <Group gap="xs">
                            <Loader size="xs" />
                            <Text size="xs" c="dimmed">
                              正在加载 Sora 角色…
                            </Text>
                          </Group>
                        </Center>
                      )}
                      {!charLoading && characters.length === 0 && (
                        <Text size="xs" c="dimmed">暂无角色或未选择 Token</Text>
                      )}
                      <SimpleGrid cols={{ base: 2, sm: 3, md: 4 }} spacing="xs">
                        {characters.map((c, idx) => {
                          const avatar =
                            c.profile_picture_url ||
                            c.owner_profile?.profile_picture_url ||
                            null
                          const name =
                            c.username ||
                            c.owner_profile?.username ||
                            c.display_name ||
                            c.owner_profile?.display_name ||
                            `角色 ${idx + 1}`
                          const desc =
                            c.description ||
                            c.owner_profile?.description ||
                            null
                          const charId = c.user_id as string | undefined
                          return (
                            <Paper key={charId ?? name ?? idx} withBorder radius="md" p="xs">
                              {avatar && (
                                <Image
                                  src={avatar}
                                  alt={name}
                                  radius="sm"
                                  mb={4}
                                  height={100}
                                  fit="cover"
                                />
                              )}
                              <Text size="xs" fw={500} lineClamp={1}>
                                {name}
                              </Text>
                              <div style={{ minHeight: 34, marginTop: 2 }}>
                                {desc && (
                                  <Text size="xs" c="dimmed" lineClamp={2}>
                                    {desc}
                                  </Text>
                                )}
                              </div>
                              <Group justify="flex-end" gap={4} mt={4} wrap="nowrap">
                                <Tooltip label="重命名" withArrow>
                                  <ActionIcon
                                    size="sm"
                                    variant="subtle"
                                    disabled={!selectedTokenId || !charId}
                                    onClick={() => {
                                      if (!selectedTokenId || !charId) return
                                      setRenameCharTarget(c)
                                      setRenameCharName(c.username || name || '')
                                      setRenameCharError(null)
                                      setRenameCharChecking(false)
                                      setRenameCharOpen(true)
                                    }}
                                  >
                                    <IconPencil size={14} />
                                  </ActionIcon>
                                </Tooltip>
                                <Tooltip label="删除" withArrow>
                                  <ActionIcon
                                    size="sm"
                                    variant="subtle"
                                    color="red"
                                    disabled={!selectedTokenId || !charId || deletingCharId === charId}
                                    onClick={async () => {
                                      if (!selectedTokenId || !charId) return
                                      if (!confirm('确定删除该 Sora 角色吗？此操作不可恢复')) return
                                      try {
                                        setDeletingCharId(charId)
                                        await deleteSoraCharacter(selectedTokenId, charId)
                                        setCharacters((prev) => prev.filter((x) => x.user_id !== charId))
                                      } catch (err: any) {
                                        alert(err?.message || '删除角色失败，请稍后重试')
                                      } finally {
                                        setDeletingCharId((prev) => (prev === charId ? null : prev))
                                      }
                                    }}
                                  >
                                    {deletingCharId === charId ? <Loader size="xs" /> : <IconTrash size={14} />}
                                  </ActionIcon>
                                </Tooltip>
                              </Group>
                            </Paper>
                          )
                        })}
                      </SimpleGrid>
                      {charCursor && (
                        <Group justify="center" mt="sm">
                          <Button size="xs" variant="light" loading={charLoading} onClick={loadMoreCharacters}>
                            加载更多
                          </Button>
                        </Group>
                      )}
                    </div>
                  </Stack>
                </Tabs.Panel>
              </Tabs>
            </Paper>
            <Modal
              opened={renameCharOpen}
              onClose={() => {
                setRenameCharOpen(false)
                setRenameCharTarget(null)
                setRenameCharName('')
                setRenameCharError(null)
                setRenameCharChecking(false)
              }}
              title="重命名 Sora 角色"
              centered
              withinPortal
              zIndex={8005}
            >
              <Stack gap="sm">
                <Text size="xs" c="dimmed">
                  修改角色用户名（用于 Sora 角色卡链接）。输入过程中会自动校验是否合法。
                </Text>
                <TextInput
                  label="用户名"
                  placeholder="例如：my.character.name"
                  value={renameCharName}
                  error={renameCharError || undefined}
                  onChange={async (e) => {
                    const v = e.currentTarget.value.trim()
                    setRenameCharName(v)
                    setRenameCharError(null)
                    if (!selectedTokenId || !renameCharTarget?.user_id) return
                    if (!v || v === renameCharTarget.username) {
                      setRenameCharChecking(false)
                      return
                    }
                    if (renameDebounceRef.current) {
                      window.clearTimeout(renameDebounceRef.current)
                      renameDebounceRef.current = null
                    }
                    setRenameCharChecking(true)
                    renameDebounceRef.current = window.setTimeout(async () => {
                      try {
                        await checkSoraCharacterUsername(selectedTokenId, v)
                        setRenameCharError(null)
                      } catch (err: any) {
                        setRenameCharError(err?.message || '用户名不合法或已被占用')
                      } finally {
                        setRenameCharChecking(false)
                      }
                    }, 500)
                  }}
                />
                <Group justify="flex-end" mt="sm">
                  <Button
                    variant="default"
                    onClick={() => {
                      setRenameCharOpen(false)
                      setRenameCharTarget(null)
                      setRenameCharName('')
                      setRenameCharError(null)
                      setRenameCharChecking(false)
                    }}
                  >
                    取消
                  </Button>
                  <Button
                    disabled={
                      !selectedTokenId ||
                      !renameCharTarget?.user_id ||
                      !renameCharName ||
                      renameCharName === renameCharTarget.username ||
                      !!renameCharError ||
                      renameCharChecking
                    }
                    onClick={async () => {
                      if (
                        !selectedTokenId ||
                        !renameCharTarget?.user_id ||
                        !renameCharName ||
                        renameCharName === renameCharTarget.username ||
                        renameCharChecking ||
                        renameCharError
                      ) {
                        return
                      }
                      try {
                        await updateSoraCharacter({
                          tokenId: selectedTokenId,
                          characterId: renameCharTarget.user_id,
                          username: renameCharName,
                          display_name: renameCharTarget.display_name ?? null,
                          profile_asset_pointer: null,
                        })
                        setCharacters((prev) =>
                          prev.map((x) =>
                            x.user_id === renameCharTarget.user_id
                              ? { ...x, username: renameCharName }
                              : x,
                          ),
                        )
                        setRenameCharOpen(false)
                        setRenameCharTarget(null)
                        setRenameCharName('')
                        setRenameCharError(null)
                        setRenameCharChecking(false)
                      } catch (err: any) {
                        alert(err?.message || '更新角色失败，请稍后重试')
                      }
                    }}
                  >
                    保存
                  </Button>
                </Group>
              </Stack>
            </Modal>
            <Modal
              opened={createCharFinalizeOpen}
              onClose={() => {
                setCreateCharFinalizeOpen(false)
                setCreateCharCameoId(null)
                setCreateCharAssetPointer(null)
                if (createCharCoverPreview) {
                  URL.revokeObjectURL(createCharCoverPreview)
                }
                setCreateCharCoverPreview(null)
                setCreateCharUsername('')
                setCreateCharDisplayName('')
                setCreateCharUsernameError(null)
                setCreateCharUsernameChecking(false)
                if (createCharUsernameDebounceRef.current) {
                  window.clearTimeout(createCharUsernameDebounceRef.current)
                  createCharUsernameDebounceRef.current = null
                }
              }}
              title="创建 Sora 角色"
              centered
              withinPortal
              zIndex={8006}
            >
              <Stack gap="sm">
                <Text size="xs" c="dimmed">
                  填写角色的用户名和显示名称。用户名只允许英文，长度不超过 20。
                </Text>
                <Group align="flex-start" gap="sm">
                  <div style={{ width: 72, height: 72, borderRadius: 8, overflow: 'hidden', background: 'rgba(15,23,42,.8)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {createCharCoverPreview ? (
                      <img
                        src={createCharCoverPreview}
                        alt="封面预览"
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <Text size="xs" c="dimmed">
                        无封面
                      </Text>
                    )}
                  </div>
                  <Button
                    size="xs"
                    variant="light"
                    loading={createCharCoverUploading}
                    onClick={handlePickCover}
                    disabled={!selectedTokenId}
                  >
                    选择封面图片
                  </Button>
                </Group>
                <TextInput
                  label="用户名"
                  placeholder="例如：my.character.name"
                  value={createCharUsername}
                  error={createCharUsernameError || undefined}
                  onChange={async (e) => {
                    const v = e.currentTarget.value.trim()
                    setCreateCharUsername(v)
                    setCreateCharUsernameError(null)
                    if (!selectedTokenId) return
                    if (!v) {
                      setCreateCharUsernameChecking(false)
                      return
                    }
                    if (createCharUsernameDebounceRef.current) {
                      window.clearTimeout(createCharUsernameDebounceRef.current)
                      createCharUsernameDebounceRef.current = null
                    }
                    setCreateCharUsernameChecking(true)
                    createCharUsernameDebounceRef.current = window.setTimeout(async () => {
                      try {
                        await checkSoraCharacterUsername(selectedTokenId, v)
                        setCreateCharUsernameError(null)
                      } catch (err: any) {
                        setCreateCharUsernameError(err?.message || '用户名不合法或已被占用')
                      } finally {
                        setCreateCharUsernameChecking(false)
                      }
                    }, 500)
                  }}
                />
                <TextInput
                  label="显示名称"
                  placeholder="例如：My Cameo Character"
                  value={createCharDisplayName}
                  onChange={(e) => setCreateCharDisplayName(e.currentTarget.value)}
                />
                <Group justify="flex-end" mt="sm">
                  <Button
                    variant="default"
                    onClick={() => {
                      setCreateCharFinalizeOpen(false)
                      setCreateCharCameoId(null)
                      setCreateCharAssetPointer(null)
                      if (createCharCoverPreview) {
                        URL.revokeObjectURL(createCharCoverPreview)
                      }
                      setCreateCharCoverPreview(null)
                      setCreateCharUsername('')
                      setCreateCharDisplayName('')
                      setCreateCharUsernameError(null)
                      setCreateCharUsernameChecking(false)
                      if (createCharUsernameDebounceRef.current) {
                        window.clearTimeout(createCharUsernameDebounceRef.current)
                        createCharUsernameDebounceRef.current = null
                      }
                    }}
                  >
                    取消
                  </Button>
                  <Button
                    disabled={
                      !createCharCameoId ||
                      !selectedTokenId ||
                      !createCharUsername ||
                      !!createCharUsernameError ||
                      createCharUsernameChecking ||
                      createCharSubmitting
                    }
                    loading={createCharSubmitting}
                    onClick={async () => {
                      if (
                        !createCharCameoId ||
                        !selectedTokenId ||
                        !createCharUsername ||
                        createCharUsernameChecking ||
                        createCharUsernameError
                      ) {
                        return
                      }
                      setCreateCharSubmitting(true)
                      try {
                        const finalizeResult = await finalizeSoraCharacter({
                          tokenId: selectedTokenId,
                          cameo_id: createCharCameoId,
                          username: createCharUsername,
                          display_name:
                            createCharDisplayName || createCharUsername,
                          profile_asset_pointer:
                            createCharAssetPointer ?? null,
                        })
                        const cameoIdForVisibility =
                          finalizeResult?.cameo?.id || createCharCameoId
                        if (cameoIdForVisibility) {
                          try {
                            await setSoraCameoPublic(
                              selectedTokenId,
                              cameoIdForVisibility,
                            )
                          } catch (err) {
                            console.warn('设置角色为公共访问失败：', err)
                          }
                        }
                        setCreateCharFinalizeOpen(false)
                        setCreateCharCameoId(null)
                        setCreateCharAssetPointer(null)
                        if (createCharCoverPreview) {
                          URL.revokeObjectURL(createCharCoverPreview)
                        }
                        setCreateCharCoverPreview(null)
                        setCreateCharUsername('')
                        setCreateCharDisplayName('')
                        setCreateCharUsernameError(null)
                        setCreateCharUsernameChecking(false)
                        if (createCharUsernameDebounceRef.current) {
                          window.clearTimeout(createCharUsernameDebounceRef.current)
                          createCharUsernameDebounceRef.current = null
                        }

                        setCharLoading(true)
                        try {
                          const data = await listSoraCharacters(selectedTokenId)
                          setCharacters(data.items || [])
                          setCharCursor(data.cursor || null)
                        } catch (err: any) {
                          console.error(err)
                          alert('角色创建成功，但刷新角色列表失败，请稍后手动刷新')
                        } finally {
                          setCharLoading(false)
                        }
                      } catch (err: any) {
                        console.error(err)
                        alert(err?.message || '创建角色失败，请稍后重试')
                      } finally {
                        setCreateCharSubmitting(false)
                      }
                    }}
                  >
                    创建
                  </Button>
                </Group>
              </Stack>
            </Modal>
            <VideoTrimModal
              opened={createCharTrimOpen}
              videoUrl={createCharVideoUrl || ''}
              originalDuration={createCharDuration || 0}
              thumbnails={createCharThumbs}
              onClose={handleTrimClose}
              onConfirm={handleTrimConfirm}
            />
          </div>
        )}
      </Transition>
    </div>
  )
}
