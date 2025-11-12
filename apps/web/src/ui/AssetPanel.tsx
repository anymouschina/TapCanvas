import React from 'react'
import { Paper, Title, SimpleGrid, Card, Image, Text, Button, Group, Stack, Transition } from '@mantine/core'
import { listAssets, getAsset, deleteAsset, renameAsset } from '../assets/registry'
import { useRFStore } from '../canvas/store'
import { useUIStore } from './uiStore'

function PlaceholderImage({ label }: { label: string }) {
  const svg = encodeURIComponent(`<?xml version="1.0" encoding="UTF-8"?><svg xmlns='http://www.w3.org/2000/svg' width='480' height='270'><defs><linearGradient id='g' x1='0' x2='1'><stop offset='0%' stop-color='#1f2937'/><stop offset='100%' stop-color='#0b0b0d'/></linearGradient></defs><rect width='100%' height='100%' fill='url(#g)'/><text x='50%' y='50%' fill='#e5e7eb' dominant-baseline='middle' text-anchor='middle' font-size='16' font-family='system-ui'>${label}</text></svg>`) 
  return <Image src={`data:image/svg+xml;charset=UTF-8,${svg}`} alt={label} radius="sm" />
}

export default function AssetPanel(): JSX.Element | null {
  const active = useUIStore(s => s.activePanel)
  const setActivePanel = useUIStore(s => s.setActivePanel)
  const anchorY = useUIStore(s => s.panelAnchorY)
  const addNodes = useRFStore(s => s.load)
  const mounted = active === 'assets'
  if (!mounted) return null
  const assets = listAssets()

  const applyAssetAt = (assetId: string, pos: { x: number; y: number }) => {
    const rec = getAsset(assetId)
    if (!rec) return
    // translate nodes by shift to current position (align min corner)
    const minX = Math.min(...rec.nodes.map(n => n.position.x))
    const minY = Math.min(...rec.nodes.map(n => n.position.y))
    const dx = pos.x - minX
    const dy = pos.y - minY
    const nodes = rec.nodes.map(n => ({ ...n, id: `n${Math.random().toString(36).slice(2,6)}`, position: { x: n.position.x + dx, y: n.position.y + dy }, selected: false }))
    const edges = rec.edges.map(e => ({ ...e, id: `e${Math.random().toString(36).slice(2,6)}`, selected: false }))
    useRFStore.setState(s => ({ nodes: [...s.nodes, ...nodes], edges: [...s.edges, ...edges], nextId: s.nextId + nodes.length }))
  }

  return (
    <div style={{ position: 'fixed', left: 76, top: (anchorY ? anchorY - 150 : 140), zIndex: 74 }} data-ux-panel>
      <Transition mounted={mounted} transition="pop" duration={140} timingFunction="ease">
        {(styles) => (
          <div style={styles}>
            <Paper withBorder shadow="md" radius="lg" className="glass" p="md" style={{ width: 640, transformOrigin: 'left center' }} data-ux-panel>
              <div className="panel-arrow" />
              <Group justify="space-between" mb={8}>
                <Title order={6}>我的资产</Title>
              </Group>
              {assets.length === 0 && (<Text size="xs" c="dimmed">暂无资产</Text>)}
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                {assets.map(a => (
                  <Card key={a.id} withBorder radius="md" shadow="sm">
                    <PlaceholderImage label={a.name} />
                    <Group justify="space-between" mt="sm">
                      <Text size="sm">{a.name}</Text>
                      <Group gap={6}>
                        <Button size="xs" variant="light" onClick={()=>{ const pos = { x: 200, y: (anchorY||200) }; applyAssetAt(a.id, pos); setActivePanel(null) }}>添加</Button>
                        <Button size="xs" variant="subtle" onClick={()=>{ const next = prompt('重命名：', a.name)?.trim(); if (!next || next===a.name) return; renameAsset(a.id, next) }}>重命名</Button>
                        <Button size="xs" color="red" variant="subtle" onClick={()=>{ if (confirm('删除该资产？')) { deleteAsset(a.id) } }}>删除</Button>
                      </Group>
                    </Group>
                  </Card>
                ))}
              </SimpleGrid>
            </Paper>
          </div>
        )}
      </Transition>
    </div>
  )
}

