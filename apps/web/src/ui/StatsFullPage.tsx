import React from 'react'
import { ActionIcon, Badge, Box, Button, Center, Container, Group, Loader, Paper, SegmentedControl, Stack, Text, Title, Tooltip, useMantineColorScheme } from '@mantine/core'
import { IconArrowLeft, IconRefresh, IconUsers } from '@tabler/icons-react'
import { useAuth } from '../auth/store'
import { getDailyActiveUsers, getStats } from '../api/server'
import { ToastHost, toast } from './toast'
import { $ } from '../canvas/i18n'

function Sparkline({ values }: { values: number[] }): JSX.Element | null {
  if (!values.length) return null
  const w = 920
  const h = 140
  const pad = 10
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const span = Math.max(1, max - min)
  const step = values.length <= 1 ? 0 : (w - pad * 2) / (values.length - 1)

  const points = values
    .map((v, i) => {
      const x = pad + i * step
      const y = pad + (h - pad * 2) * (1 - (v - min) / span)
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')

  const area = `${pad},${h - pad} ${points} ${w - pad},${h - pad}`

  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="tapcanvas-stats-spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(59,130,246,0.35)" />
          <stop offset="100%" stopColor="rgba(59,130,246,0.02)" />
        </linearGradient>
      </defs>
      <polyline points={area} fill="url(#tapcanvas-stats-spark-fill)" stroke="none" />
      <polyline points={points} fill="none" stroke="rgba(59,130,246,0.9)" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

export default function StatsFullPage(): JSX.Element {
  const user = useAuth((s) => s.user)
  const isAdmin = user?.role === 'admin'
  const { colorScheme } = useMantineColorScheme()
  const isDark = colorScheme === 'dark'

  const [loading, setLoading] = React.useState(false)
  const [stats, setStats] = React.useState<{ onlineUsers: number; totalUsers: number; newUsersToday: number } | null>(null)
  const [dauDays, setDauDays] = React.useState<'7' | '30'>('30')
  const [dau, setDau] = React.useState<number[]>([])
  const [lastUpdated, setLastUpdated] = React.useState<number | null>(null)

  const reload = React.useCallback(async () => {
    setLoading(true)
    try {
      const [nextStats, nextDau] = await Promise.all([
        getStats(),
        getDailyActiveUsers(dauDays === '7' ? 7 : 30),
      ])
      setStats(nextStats)
      setDau((nextDau?.series || []).map((p) => p.activeUsers))
      setLastUpdated(Date.now())
    } catch (err: any) {
      console.error(err)
      toast(err?.message || '加载看板失败', 'error')
    } finally {
      setLoading(false)
    }
  }, [dauDays])

  React.useEffect(() => {
    void reload()
  }, [reload])

  const background = isDark
    ? 'radial-gradient(circle at 0% 0%, rgba(56,189,248,0.14), transparent 60%), radial-gradient(circle at 100% 0%, rgba(37,99,235,0.18), transparent 60%), radial-gradient(circle at 0% 100%, rgba(168,85,247,0.12), transparent 55%), linear-gradient(180deg, #020617 0%, #020617 100%)'
    : 'radial-gradient(circle at 0% 0%, rgba(59,130,246,0.12), transparent 60%), radial-gradient(circle at 100% 0%, rgba(59,130,246,0.08), transparent 60%), radial-gradient(circle at 0% 100%, rgba(56,189,248,0.08), transparent 55%), linear-gradient(180deg, #eef2ff 0%, #e9efff 100%)'

  if (!isAdmin) {
    return (
      <div style={{ minHeight: '100vh', background }}>
        <ToastHost />
        <Container size="md" py={40}>
          <Stack gap="md">
            <Group justify="space-between">
              <Title order={3}>{$('看板')}</Title>
              <Button variant="subtle" component="a" href="/">
                {$('返回')}
              </Button>
            </Group>
            <Paper withBorder radius="lg" p="md">
              <Text size="sm" c="dimmed">
                {$('仅管理员可访问看板。')}
              </Text>
              <Text size="xs" c="dimmed" mt={8}>
                {user?.login ? `login=${user.login}` : $('未登录')}
              </Text>
            </Paper>
          </Stack>
        </Container>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background }}>
      <ToastHost />
      <Container size="xl" px="md" py="md">
        <Box pt="md" pb="sm">
          <Group justify="space-between" align="center" mb="md">
            <Group gap={10} align="center">
              <Button
                size="xs"
                variant="subtle"
                leftSection={<IconArrowLeft size={14} />}
                onClick={() => {
                  if (typeof window !== 'undefined') window.location.href = '/'
                }}
              >
                {$('返回 TapCanvas')}
              </Button>
              <Badge variant="light" color="gray">
                admin
              </Badge>
            </Group>
            <Group gap={6}>
              <Tooltip label={$('刷新')} withArrow>
                <ActionIcon size="sm" variant="subtle" aria-label="刷新" onClick={() => void reload()} loading={loading}>
                  <IconRefresh size={14} />
                </ActionIcon>
              </Tooltip>
            </Group>
          </Group>

          <Stack gap={6} mb="lg">
            <Group gap={10} align="center">
              <IconUsers size={18} />
              <Title order={2}>{$('看板')}</Title>
            </Group>
            <Text size="sm" c="dimmed" maw={720}>
              {$('在线/新增/日活统计（UTC 口径）。')}
            </Text>
          </Stack>
        </Box>

        {loading && !stats ? (
          <Center mih={260}>
            <Stack gap={8} align="center">
              <Loader size="sm" />
              <Text size="sm" c="dimmed">
                {$('加载中…')}
              </Text>
            </Stack>
          </Center>
        ) : !stats ? (
          <Center mih={260}>
            <Text size="sm" c="dimmed">
              {$('暂无数据')}
            </Text>
          </Center>
        ) : (
          <Stack gap="md" pb="xl">
            <Group grow>
              <Paper withBorder radius="lg" p="md" className="glass">
                <Group justify="space-between">
                  <Text size="sm" fw={600}>
                    {$('当前在线')}
                  </Text>
                  <Text size="sm">{stats.onlineUsers}</Text>
                </Group>
              </Paper>
              <Paper withBorder radius="lg" p="md" className="glass">
                <Group justify="space-between">
                  <Text size="sm" fw={600}>
                    {$('今日新增')}
                  </Text>
                  <Text size="sm">{stats.newUsersToday}</Text>
                </Group>
              </Paper>
              <Paper withBorder radius="lg" p="md" className="glass">
                <Group justify="space-between">
                  <Text size="sm" fw={600}>
                    {$('总计用户')}
                  </Text>
                  <Text size="sm">{stats.totalUsers}</Text>
                </Group>
              </Paper>
            </Group>

            <Paper withBorder radius="lg" p="md" className="glass">
              <Group justify="space-between" align="center" mb={10} wrap="wrap" gap={10}>
                <Text size="sm" fw={600}>
                  {$('日活曲线')}
                </Text>
                <SegmentedControl
                  size="xs"
                  radius="xl"
                  value={dauDays}
                  onChange={(v) => setDauDays(v as any)}
                  data={[
                    { value: '7', label: '7d' },
                    { value: '30', label: '30d' },
                  ]}
                />
              </Group>
              <Sparkline values={dau} />
              <Group justify="space-between" mt={10}>
                <Text size="xs" c="dimmed">
                  {$('最低')}: {dau.length ? Math.min(...dau) : 0}
                </Text>
                <Text size="xs" c="dimmed">
                  {$('最高')}: {dau.length ? Math.max(...dau) : 0}
                </Text>
              </Group>
              {lastUpdated && (
                <Text size="xs" c="dimmed" mt={10}>
                  {$('更新时间')}: {new Date(lastUpdated).toLocaleString()}
                </Text>
              )}
            </Paper>
          </Stack>
        )}
      </Container>
    </div>
  )
}

