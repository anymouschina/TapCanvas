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
    <div className="account-panel-anchor" style={{ position: 'fixed', left: 82, top: (anchorY ? anchorY - 100 : 140), zIndex: 200 }} data-ux-panel>
      <Transition className="account-panel-transition" mounted={mounted} transition="pop" duration={140} timingFunction="ease">
        {(styles) => (
          <div className="account-panel-transition-inner" style={styles}>
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
              <div className="account-panel-arrow panel-arrow" />
              <div className="account-panel-body" style={{ flex: 1, overflowY: 'auto', minHeight: 0, paddingRight: 4 }}>
                <Group className="account-panel-header">
                  <Avatar className="account-panel-avatar" src={user?.avatarUrl} alt={user?.login} radius={999} />
                  <div className="account-panel-user">
                    <Title className="account-panel-user-name" order={6}>{user?.login || '未登录'}</Title>
                    {user?.email && <Text className="account-panel-user-email" size="xs" c="dimmed">{user.email}</Text>}
                    {isGuest && <Text className="account-panel-user-guest" size="xs" c="dimmed">游客模式（仅保存在当前浏览器）</Text>}
                  </div>
                </Group>
                <Divider className="account-panel-divider" my={10} />
                <Stack className="account-panel-actions" gap={6}>
                  {user?.login && !isGuest && (
                    <Button className="account-panel-github" size="xs" variant="light" component="a" href={`https://github.com/${user.login}`} target="_blank">查看 GitHub</Button>
                  )}
                  <Button className="account-panel-logout" size="xs" color="red" variant="light" onClick={()=>{ clear(); setActivePanel(null) }}>退出登录</Button>
                  <Divider className="account-panel-divider" label="提示词自动补全" labelPosition="left" my={8} />
                  <Stack className="account-panel-autocomplete" gap={4}>
                    <Text className="account-panel-autocomplete-label" size="xs" c={colorScheme === 'dark' ? '#cbd5f5' : '#1f2937'}>补全模式</Text>
                    <SegmentedControl
                      className="account-panel-autocomplete-control"
                      size="xs"
                      value={promptSuggestMode}
                      onChange={(v) => setPromptSuggestMode(v as 'off' | 'history' | 'semantic')}
                      data={[
                        { label: <span className="account-panel-autocomplete-option" style={{ color: colorScheme === 'dark' ? '#f8fafc' : '#0f172a' }}>关闭</span>, value: 'off' },
                        { label: <span className="account-panel-autocomplete-option" style={{ color: colorScheme === 'dark' ? '#f8fafc' : '#0f172a' }}>历史匹配</span>, value: 'history' },
                        { label: <span className="account-panel-autocomplete-option" style={{ color: colorScheme === 'dark' ? '#f8fafc' : '#0f172a' }}>语义匹配</span>, value: 'semantic' },
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
