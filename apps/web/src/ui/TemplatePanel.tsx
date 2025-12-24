import React from 'react'
import { Paper, Title, Tabs, SimpleGrid, Card, Image, Text, Button, Group, Badge, Stack, Transition } from '@mantine/core'
import { useUIStore } from './uiStore'
import { listServerFlows, listProjectFlows, type FlowDto } from '../api/server'
import { useRFStore } from '../canvas/store'
import { $, $t } from '../canvas/i18n'
import { calculateSafeMaxHeight } from './utils/panelPosition'

const publicTemplates:[] = [
  // { title: 'UGC Creator' },
  // { title: '多角度分镜' },
  // { title: 'AI发型实验室' },
  // { title: '超级换脸' },
]

function PlaceholderImage({ label }: { label: string }) {
  const svg = encodeURIComponent(`<?xml version="1.0" encoding="UTF-8"?><svg xmlns='http://www.w3.org/2000/svg' width='480' height='270'><defs><linearGradient id='g' x1='0' x2='1'><stop offset='0%' stop-color='#1f2937'/><stop offset='100%' stop-color='#111827'/></linearGradient></defs><rect width='100%' height='100%' fill='url(#g)'/><text x='50%' y='50%' fill='#e5e7eb' dominant-baseline='middle' text-anchor='middle' font-size='16' font-family='system-ui'>${label}</text></svg>`) 
  return <Image className="template-panel-placeholder" src={`data:image/svg+xml;charset=UTF-8,${svg}`} alt={label} radius="sm" />
}

export default function TemplatePanel({ className }: { className?: string }): JSX.Element | null {
  const active = useUIStore(s => s.activePanel)
  const setActivePanel = useUIStore(s => s.setActivePanel)
  const anchorY = useUIStore(s => s.panelAnchorY)
  const addNode = useRFStore(s => s.addNode)
  const currentProject = useUIStore(s => s.currentProject)
  const [serverFlows, setServerFlows] = React.useState<FlowDto[]|null>(null)
  React.useEffect(() => {
    let alive = true
    if (active === 'template') {
      const loader = currentProject?.id ? listProjectFlows(currentProject.id) : listServerFlows()
      loader.then(list => { if (alive) setServerFlows(list) }).catch(()=>{ if (alive) setServerFlows([]) })
    }
    return () => { alive = false }
  }, [active, currentProject?.id])
  const mounted = active === 'template'
  if (!mounted) return null

  // 计算安全的最大高度
  const maxHeight = calculateSafeMaxHeight(anchorY, 150)

  const panelClassName = ['template-panel', className].filter(Boolean).join(' ')

  return (
    <div className={panelClassName} style={{ position: 'fixed', left: 82, top: (anchorY ? anchorY - 150 : 140), zIndex: 200 }} data-ux-panel>
      <Transition className="template-panel-transition" mounted={mounted} transition="pop" duration={140} timingFunction="ease">
        {(styles) => (
          <div className="template-panel-transition-inner" style={styles}>
            <Paper
              withBorder
              shadow="md"
              radius="lg"
              className="glass"
              p="md"
              style={{
                width: 720,
                maxHeight: `${maxHeight}px`,
                minHeight: 0,
                transformOrigin: 'left center',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              }}
              data-ux-panel
            >
              <div className="template-panel-arrow panel-arrow" />
        <Group className="template-panel-header" justify="space-between" mb={8} style={{ position: 'sticky', top: 0, zIndex: 1, background: 'transparent' }}>
          <Title className="template-panel-title" order={6}>{$t('工作流（项目：{{project}}）', { project: currentProject?.name || '全部' })}</Title>
          <Group className="template-panel-header-badges">
            <Badge className="template-panel-header-badge" color="gray" variant="light">{$('推荐')}</Badge>
            <Badge className="template-panel-header-badge" color="gray" variant="light">{$('浏览全部')}</Badge>
            <Badge className="template-panel-header-badge" color="gray" variant="light">{$('创建')}</Badge>
          </Group>
        </Group>
        <div className="template-panel-body" style={{ flex: 1, overflowY: 'auto', paddingRight: 4, minHeight: 0 }}>
        <Tabs className="template-panel-tabs" defaultValue="public">
          <Tabs.List className="template-panel-tab-list">
            <Tabs.Tab className="template-panel-tab" value="public">{$('公共工作流')}</Tabs.Tab>
            <Tabs.Tab className="template-panel-tab" value="server">{$('我的工作流(服务端)')}</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel className="template-panel-tab-panel" value="public" pt="xs">
            <SimpleGrid className="template-panel-grid" cols={{ base: 1, sm: 2, md: 3 }} spacing="sm">
              {publicTemplates.map((t) => (
                <Card className="template-panel-card" key={t.title} withBorder radius="md" shadow="sm">
                  <PlaceholderImage label={t.title} />
                  <Group className="template-panel-card-actions" justify="space-between" mt="sm">
                    <Text className="template-panel-card-title" size="sm">{t.title}</Text>
                    <Button className="template-panel-card-button" size="xs" variant="light" onClick={() => { addNode('taskNode', t.title, { kind: 'subflow', autoLabel: false }); setActivePanel(null) }}>使用</Button>
                  </Group>
                </Card>
              ))}
            </SimpleGrid>
          </Tabs.Panel>
          <Tabs.Panel className="template-panel-tab-panel" value="server" pt="xs">
            {serverFlows === null && (<Text className="template-panel-empty" size="xs" c="dimmed">载入中...</Text>)}
            {serverFlows && serverFlows.length === 0 && (<Text className="template-panel-empty" size="xs" c="dimmed">服务端暂无工作流</Text>)}
            {serverFlows && (
              <SimpleGrid className="template-panel-grid" cols={{ base: 1, sm: 2, md: 3 }} spacing="sm">
                {serverFlows.map((f) => (
                  <Card className="template-panel-card" key={f.id} withBorder radius="md" shadow="sm">
                    <PlaceholderImage label={f.name} />
                    <Group className="template-panel-card-actions" justify="space-between" mt="sm">
                      <Text className="template-panel-card-title" size="sm">{f.name}</Text>
                      <Button className="template-panel-card-button" size="xs" variant="light" onClick={() => { addNode('taskNode', f.name, { kind: 'subflow', subflowRef: f.id, autoLabel: false }); setActivePanel(null) }}>引用</Button>
                    </Group>
                  </Card>
                ))}
              </SimpleGrid>
            )}
          </Tabs.Panel>
        </Tabs>
        </div>
            </Paper>
          </div>
        )}
      </Transition>
    </div>
  )
}
