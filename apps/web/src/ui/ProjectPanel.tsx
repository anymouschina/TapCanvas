import React from 'react'
import { Paper, Title, SimpleGrid, Card, Text, Button, Group, Stack, Transition } from '@mantine/core'
import { useUIStore } from './uiStore'
import { listProjects, upsertProject, type ProjectDto } from '../api/server'

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
            <Paper withBorder shadow="md" radius="lg" className="glass" p="md" style={{ width: 400, transformOrigin: 'left center' }} data-ux-panel>
              <div className="panel-arrow" />
              <Group justify="space-between" mb={8}>
                <Title order={6}>项目</Title>
                <Button size="xs" variant="light" onClick={async ()=>{ const name = prompt('新建项目名称：')?.trim(); if (!name) return; const p = await upsertProject({ name }); setProjects(prev => [p, ...prev]) }}>新建项目</Button>
              </Group>
              {projects.length === 0 && (<Text size="xs" c="dimmed">暂无项目</Text>)}
              <Stack gap={6}>
                {projects.map(p => (
                  <Group key={p.id} justify="space-between">
                    <Text size="sm" c={currentProject?.id===p.id?undefined:'dimmed'}>{p.name}</Text>
                    <Button size="xs" variant="light" onClick={()=>{ setCurrentProject({ id: p.id, name: p.name }); setActivePanel(null) }}>选择</Button>
                  </Group>
                ))}
              </Stack>
            </Paper>
          </div>
        )}
      </Transition>
    </div>
  )
}
