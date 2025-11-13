import React from 'react'
import { Paper, Group, Title, Transition, Button, Avatar, Text, Stack, Divider } from '@mantine/core'
import { useUIStore } from './uiStore'
import { useAuth } from '../auth/store'

export default function AccountPanel(): JSX.Element | null {
  const active = useUIStore(s => s.activePanel)
  const setActivePanel = useUIStore(s => s.setActivePanel)
  const anchorY = useUIStore(s => s.panelAnchorY)
  const mounted = active === 'account'
  const user = useAuth(s => s.user)
  const clear = useAuth(s => s.clear)
  if (!mounted) return null
  return (
    <div style={{ position: 'fixed', left: 82, top: (anchorY ? anchorY - 100 : 140), zIndex: 74 }} data-ux-panel>
      <Transition mounted={mounted} transition="pop" duration={140} timingFunction="ease">
        {(styles) => (
          <div style={styles}>
            <Paper withBorder shadow="md" radius="lg" className="glass" p="md" style={{ width: 300, transformOrigin: 'left center' }} data-ux-panel>
              <div className="panel-arrow" />
              <Group>
                <Avatar src={user?.avatarUrl} alt={user?.login} radius={999} />
                <div>
                  <Title order={6}>{user?.login || '未登录'}</Title>
                  {user?.email && <Text size="xs" c="dimmed">{user.email}</Text>}
                </div>
              </Group>
              <Divider my={10} />
              <Stack gap={6}>
                {user?.login && (
                  <Button size="xs" variant="light" component="a" href={`https://github.com/${user.login}`} target="_blank">查看 GitHub</Button>
                )}
                <Button size="xs" color="red" variant="light" onClick={()=>{ clear(); setActivePanel(null) }}>退出登录</Button>
              </Stack>
            </Paper>
          </div>
        )}
      </Transition>
    </div>
  )
}

