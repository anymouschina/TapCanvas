import React from 'react'
import { Paper, Group, Title, Transition, Button, Stack, Text } from '@mantine/core'
import { useUIStore } from './uiStore'
import { getServerFlow, listFlowVersions, rollbackFlow } from '../api/server'
import { normalizeNodesParentId, useRFStore } from '../canvas/store'
import { calculateSafeMaxHeight } from './utils/panelPosition'

export default function HistoryPanel(): JSX.Element | null {
  const active = useUIStore((s) => s.activePanel)
  const setActivePanel = useUIStore((s) => s.setActivePanel)
  const anchorY = useUIStore((s) => s.panelAnchorY)
  const { currentFlow, setCurrentFlow, setDirty } = useUIStore()
  const setNodesAndEdges = useRFStore(() => (nodes: any[], edges: any[]) => {
    useRFStore.setState({ nodes, edges })
  })
  const mounted = active === 'history'
  const [versions, setVersions] = React.useState<Array<{ id: string; createdAt: string; name: string }>>([])

  React.useEffect(() => {
    if (!mounted || !currentFlow.id) return
    listFlowVersions(currentFlow.id)
      .then((vs) => setVersions(vs))
      .catch(() => setVersions([]))
  }, [mounted, currentFlow.id])

  if (!mounted) return null

  // 计算安全的最大高度
  const maxHeight = calculateSafeMaxHeight(anchorY, 150)

  return (
    <div className="history-panel-anchor" style={{ position: 'fixed', left: 82, top: anchorY ? anchorY - 150 : 140, zIndex: 200 }} data-ux-panel>
      <Transition className="history-panel-transition" mounted={mounted} transition="pop" duration={140} timingFunction="ease">
        {(styles) => (
          <div className="history-panel-transition-inner" style={styles}>
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
              <div className="history-panel-arrow panel-arrow" />
              <Group className="history-panel-header" justify="space-between" mb={8}>
                <Title className="history-panel-title" order={6}>保存历史</Title>
                <Button className="history-panel-close" size="xs" variant="light" onClick={() => setActivePanel(null)}>
                  关闭
                </Button>
              </Group>
              <div className="history-panel-body" style={{ flex: 1, overflowY: 'auto', minHeight: 0, paddingRight: 4 }}>
              <Stack className="history-panel-list" gap="xs">
                {(!versions || versions.length === 0) && (
                  <Text className="history-panel-empty" size="sm" c="dimmed">
                    暂无历史
                  </Text>
                )}
                {versions.map((v) => (
                  <Group className="history-panel-row" key={v.id} justify="space-between">
                    <Text className="history-panel-row-text" size="sm">
                      {new Date(v.createdAt).toLocaleString()} - {v.name}
                    </Text>
                    <Button
                      className="history-panel-rollback"
                      size="xs"
                      variant="light"
                      onClick={async () => {
                        if (!currentFlow.id) return
                        if (!confirm('回滚到该版本？当前更改将丢失')) return
                        await rollbackFlow(currentFlow.id, v.id)
                        const r = await getServerFlow(currentFlow.id)
                        const data: any = r?.data || {}
                        const nodes = Array.isArray(data.nodes) ? data.nodes : []
                        const edges = Array.isArray(data.edges) ? data.edges : []
                        setNodesAndEdges(normalizeNodesParentId(nodes as any), edges)
                        setCurrentFlow({ name: r.name })
                        setDirty(false)
                        setActivePanel(null)
                      }}
                    >
                      回滚
                    </Button>
                  </Group>
                ))}
              </Stack>
              </div>
            </Paper>
          </div>
        )}
      </Transition>
    </div>
  )
}
