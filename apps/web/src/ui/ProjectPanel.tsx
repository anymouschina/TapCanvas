import React from 'react'
import { Paper, Title, Text, Button, Group, Stack, Transition } from '@mantine/core'
import { useUIStore } from './uiStore'
import { listProjects, upsertProject, saveProjectFlow, type ProjectDto } from '../api/server'
import { useRFStore } from '../canvas/store'
import { $, $t } from '../canvas/i18n'

export default function ProjectPanel(): JSX.Element | null {
  const active = useUIStore(s => s.activePanel)
  const setActivePanel = useUIStore(s => s.setActivePanel)
  const anchorY = useUIStore(s => s.panelAnchorY)
  const currentProject = useUIStore(s => s.currentProject)
  const setCurrentProject = useUIStore(s => s.setCurrentProject)
  const mounted = active === 'project'
  const [projects, setProjects] = React.useState<ProjectDto[]>([])

  React.useEffect(() => {
    if (!mounted) return
    listProjects().then(setProjects).catch(()=>setProjects([]))
  }, [mounted])

  if (!mounted) return null
  return (
    <div style={{ position: 'fixed', left: 82, top: (anchorY ? anchorY - 150 : 140), zIndex: 6001 }} data-ux-panel>
      <Transition mounted={mounted} transition="pop" duration={140} timingFunction="ease">
        {(styles) => (
          <div style={styles}>
            <Paper withBorder shadow="md" radius="lg" className="glass" p="md" style={{ width: 400, maxHeight: '70vh', transformOrigin: 'left center' }} data-ux-panel>
              <div className="panel-arrow" />
              <Group justify="space-between" mb={8} style={{ position: 'sticky', top: 0, zIndex: 1, background: 'transparent' }}>
                <Title order={6}>{$('项目')}</Title>
                <Button size="xs" variant="light" onClick={async () => {
                  const defaultName = $t('未命名项目 {{time}}', { time: new Date().toLocaleString() })
                  const p = await upsertProject({ name: defaultName })
                  setProjects(prev => [p, ...prev])
                  // 创建一个空白工作流并设为当前
                  const empty = await saveProjectFlow({ projectId: p.id, name: p.name, nodes: [], edges: [] })
                  useRFStore.setState({ nodes: [], edges: [], nextId: 1 })
                  setCurrentProject({ id: p.id, name: p.name })
                  // 关闭面板
                  setActivePanel(null)
                }}>{$('新建项目')}</Button>
              </Group>
              <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
                {projects.length === 0 && (<Text size="xs" c="dimmed">{$('暂无项目')}</Text>)}
                <Stack gap={6}>
                  {projects.map(p => (
                    <Group key={p.id} justify="space-between">
                      <Text size="sm" c={currentProject?.id===p.id?undefined:'dimmed'}>{p.name}</Text>
                      <Button size="xs" variant="light" onClick={()=>{ setCurrentProject({ id: p.id, name: p.name }); setActivePanel(null) }}>{$('选择')}</Button>
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
