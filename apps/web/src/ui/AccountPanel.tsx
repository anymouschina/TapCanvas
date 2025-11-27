import React from 'react'
import { Paper, Group, Title, Transition, Button, Avatar, Text, Stack, Divider, SegmentedControl, useMantineColorScheme } from '@mantine/core'
import { useUIStore } from './uiStore'
import { useAuth } from '../auth/store'
import { calculateSafeMaxHeight } from './utils/panelPosition'

export default function AccountPanel(): JSX.Element | null {
  const active = useUIStore(s => s.activePanel)
  const setActivePanel = useUIStore(s => s.setActivePanel)
  const anchorY = useUIStore(s => s.panelAnchorY)
  const promptSuggestMode = useUIStore(s => s.promptSuggestMode)
  const setPromptSuggestMode = useUIStore(s => s.setPromptSuggestMode)
  const mounted = active === 'account'
  const user = useAuth(s => s.user)
  const clear = useAuth(s => s.clear)
  const { colorScheme } = useMantineColorScheme()
  const isGuest = Boolean(user?.guest)
  if (!mounted) return null

  const maxHeight = calculateSafeMaxHeight(anchorY, 120)
  return (
    <div style={{ position: 'fixed', left: 82, top: (anchorY ? anchorY - 100 : 140), zIndex: 200 }} data-ux-panel>
      <Transition mounted={mounted} transition="pop" duration={140} timingFunction="ease">
        {(styles) => (
          <div style={styles}>
            <Paper
              withBorder
              shadow="md"
              radius="lg"
              className="glass"
              p="md"
              style={{
                width: 300,
                maxHeight: `${maxHeight}px`,
                minHeight: 0,
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                transformOrigin: 'left center',
              }}
              data-ux-panel
            >
              <div className="panel-arrow" />
              <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, paddingRight: 4 }}>
                <Group>
                  <Avatar src={user?.avatarUrl} alt={user?.login} radius={999} />
                  <div>
                    <Title order={6}>{user?.login || '未登录'}</Title>
                    {user?.email && <Text size="xs" c="dimmed">{user.email}</Text>}
                    {isGuest && <Text size="xs" c="dimmed">游客模式（仅保存在当前浏览器）</Text>}
                  </div>
                </Group>
                <Divider my={10} />
                <Stack gap={6}>
                  {user?.login && !isGuest && (
                    <Button size="xs" variant="light" component="a" href={`https://github.com/${user.login}`} target="_blank">查看 GitHub</Button>
                  )}
                  <Button size="xs" color="red" variant="light" onClick={()=>{ clear(); setActivePanel(null) }}>退出登录</Button>
                  <Divider label="提示词自动补全" labelPosition="left" my={8} />
                  <Stack gap={4}>
                    <Text size="xs" c={colorScheme === 'dark' ? '#cbd5f5' : '#1f2937'}>补全模式</Text>
                    <SegmentedControl
                      size="xs"
                      value={promptSuggestMode}
                      onChange={(v) => setPromptSuggestMode(v as 'off' | 'history' | 'semantic')}
                      data={[
                        { label: <span style={{ color: colorScheme === 'dark' ? '#f8fafc' : '#0f172a' }}>关闭</span>, value: 'off' },
                        { label: <span style={{ color: colorScheme === 'dark' ? '#f8fafc' : '#0f172a' }}>历史匹配</span>, value: 'history' },
                        { label: <span style={{ color: colorScheme === 'dark' ? '#f8fafc' : '#0f172a' }}>语义匹配</span>, value: 'semantic' },
                      ]}
                    />
                  </Stack>
                </Stack>
              </div>
            </Paper>
          </div>
        )}
      </Transition>
    </div>
  )
}
