import React from 'react'
import { Paper, Title, SimpleGrid, Card, Image, Text, Button, Group, Stack, Transition, Tabs, Select, ActionIcon, Tooltip } from '@mantine/core'
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
  type ServerAssetDto,
  type ModelProviderDto,
  type ModelTokenDto,
} from '../api/server'
import { IconPlayerPlay, IconPlus, IconTrash } from '@tabler/icons-react'

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
  const [tab, setTab] = React.useState<'local' | 'sora'>('local')
  const [soraProviders, setSoraProviders] = React.useState<ModelProviderDto[]>([])
  const [soraTokens, setSoraTokens] = React.useState<ModelTokenDto[]>([])
  const [selectedTokenId, setSelectedTokenId] = React.useState<string | null>(null)
  const [drafts, setDrafts] = React.useState<any[]>([])
  const [draftCursor, setDraftCursor] = React.useState<string | null>(null)
  const [draftLoading, setDraftLoading] = React.useState(false)
  const [soraUsingShared, setSoraUsingShared] = React.useState(false)
  React.useEffect(() => {
    const loader = currentProject?.id ? listServerAssets(currentProject.id) : Promise.resolve([])
    loader.then(setAssets).catch(() => setAssets([]))
  }, [currentProject?.id, mounted])

  React.useEffect(() => {
    if (!mounted) return
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
          setSelectedTokenId(null)
          return
        }
        const tokens = await listModelTokens(sora.id)
        setSoraTokens(tokens)
        if (tokens.length > 0) {
          setSelectedTokenId(tokens[0].id)
          setSoraUsingShared(false)
          try {
            const data = await listSoraDrafts(tokens[0].id)
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
            // 没有共享配置或共享配置不可用时静默失败
            setDrafts([])
            setDraftCursor(null)
            setSoraUsingShared(false)
          }
        }
      })
      .catch(() => {
        setSoraProviders([])
        setSoraTokens([])
        setDrafts([])
        setSelectedTokenId(null)
        setDraftCursor(null)
      })
  }, [mounted])

  const loadMoreDrafts = async () => {
    if (!selectedTokenId || !draftCursor) return
    setDraftLoading(true)
    try {
      const data = await listSoraDrafts(selectedTokenId, draftCursor)
      setDrafts(prev => [...prev, ...(data.items || [])])
      setDraftCursor(data.cursor || null)
    } catch (err: any) {
      console.error(err)
      alert('当前配置不可用，请稍后再试')
    } finally {
      setDraftLoading(false)
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
              <Group justify="space-between" mb={8} style={{ position: 'sticky', top: 0, zIndex: 1, background: 'transparent' }}>
                <Title order={6}>我的资产（项目：{currentProject?.name || '未选择'}）</Title>
              </Group>
              <Tabs value={tab} onChange={(v) => setTab((v as any) || 'local')}>
                <Tabs.List>
                  <Tabs.Tab value="local">项目资产</Tabs.Tab>
                  <Tabs.Tab value="sora">Sora 草稿</Tabs.Tab>
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
                        onChange={async (value) => {
                          setSelectedTokenId(value)
                          setSoraUsingShared(false)
                          if (value) {
                            try {
                              const data = await listSoraDrafts(value)
                              setDrafts(data.items || [])
                              setDraftCursor(data.cursor || null)
                            } catch (err: any) {
                              console.error(err)
                              alert('当前配置不可用，请稍后再试')
                              setDrafts([])
                              setDraftCursor(null)
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
                      {drafts.length === 0 && <Text size="xs" c="dimmed">暂无草稿或未选择 Token</Text>}
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
              </Tabs>
            </Paper>
          </div>
        )}
      </Transition>
    </div>
  )
}
