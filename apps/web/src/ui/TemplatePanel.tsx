import React from 'react'
import { Paper, Title, Tabs, SimpleGrid, Card, Image, Text, Button, Group, Badge, Stack, Transition } from '@mantine/core'
import { useUIStore } from './uiStore'
import { listServerFlows, type FlowDto } from '../api/server'
import { useRFStore } from '../canvas/store'

const publicTemplates = [
  { title: 'UGC Creator' },
  { title: '多角度分镜' },
  { title: 'AI发型实验室' },
  { title: '超级换脸' },
]

function PlaceholderImage({ label }: { label: string }) {
  const svg = encodeURIComponent(`<?xml version="1.0" encoding="UTF-8"?><svg xmlns='http://www.w3.org/2000/svg' width='480' height='270'><defs><linearGradient id='g' x1='0' x2='1'><stop offset='0%' stop-color='#1f2937'/><stop offset='100%' stop-color='#111827'/></linearGradient></defs><rect width='100%' height='100%' fill='url(#g)'/><text x='50%' y='50%' fill='#e5e7eb' dominant-baseline='middle' text-anchor='middle' font-size='16' font-family='system-ui'>${label}</text></svg>`) 
  return <Image src={`data:image/svg+xml;charset=UTF-8,${svg}`} alt={label} radius="sm" />
}

export default function TemplatePanel(): JSX.Element | null {
  const active = useUIStore(s => s.activePanel)
  const setActivePanel = useUIStore(s => s.setActivePanel)
  const anchorY = useUIStore(s => s.panelAnchorY)
  const addNode = useRFStore(s => s.addNode)
  const [serverFlows, setServerFlows] = React.useState<FlowDto[]|null>(null)
  React.useEffect(() => {
    let alive = true
    if (active === 'template') {
      listServerFlows().then(list => { if (alive) setServerFlows(list) }).catch(()=>{ if (alive) setServerFlows([]) })
    }
    return () => { alive = false }
  }, [active])
  const mounted = active === 'template'
  if (!mounted) return null
  return (
    <div style={{ position: 'fixed', left: 82, top: (anchorY ? anchorY - 150 : 140), zIndex: 74 }} data-ux-panel>
      <Transition mounted={mounted} transition="pop" duration={140} timingFunction="ease">
        {(styles) => (
          <div style={styles}>
            <Paper withBorder shadow="md" radius="lg" className="glass" p="md" style={{ width: 720, transformOrigin: 'left center' }} data-ux-panel>
              <div className="panel-arrow" />
        <Group justify="space-between" mb={8}>
          <Title order={6}>工作流模板</Title>
          <Group>
            <Badge color="gray" variant="light">推荐</Badge>
            <Badge color="gray" variant="light">浏览全部</Badge>
            <Badge color="gray" variant="light">创建</Badge>
          </Group>
        </Group>
        <Tabs defaultValue="public">
          <Tabs.List>
            <Tabs.Tab value="public">公共工作流</Tabs.Tab>
            <Tabs.Tab value="server">我的工作流(服务端)</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="public" pt="xs">
            <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="sm">
              {publicTemplates.map((t) => (
                <Card key={t.title} withBorder radius="md" shadow="sm">
                  <PlaceholderImage label={t.title} />
                  <Group justify="space-between" mt="sm">
                    <Text size="sm">{t.title}</Text>
                    <Button size="xs" variant="light" onClick={() => { addNode('taskNode', t.title, { kind: 'subflow' }); setActivePanel(null) }}>使用</Button>
                  </Group>
                </Card>
              ))}
            </SimpleGrid>
          </Tabs.Panel>
          <Tabs.Panel value="server" pt="xs">
            {serverFlows === null && (<Text size="xs" c="dimmed">载入中...</Text>)}
            {serverFlows && serverFlows.length === 0 && (<Text size="xs" c="dimmed">服务端暂无工作流</Text>)}
            {serverFlows && (
              <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="sm">
                {serverFlows.map((f) => (
                  <Card key={f.id} withBorder radius="md" shadow="sm">
                    <PlaceholderImage label={f.name} />
                    <Group justify="space-between" mt="sm">
                      <Text size="sm">{f.name}</Text>
                      <Button size="xs" variant="light" onClick={() => { addNode('taskNode', f.name, { kind: 'subflow', subflowRef: f.id }); setActivePanel(null) }}>引用</Button>
                    </Group>
                  </Card>
                ))}
              </SimpleGrid>
            )}
          </Tabs.Panel>
        </Tabs>
            </Paper>
          </div>
        )}
      </Transition>
    </div>
  )
}
