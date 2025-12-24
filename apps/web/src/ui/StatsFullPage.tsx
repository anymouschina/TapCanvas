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
    <svg className="stats-sparkline" width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <defs className="stats-sparkline-defs">
        <linearGradient className="stats-sparkline-gradient" id="tapcanvas-stats-spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop className="stats-sparkline-stop" offset="0%" stopColor="rgba(59,130,246,0.35)" />
          <stop className="stats-sparkline-stop" offset="100%" stopColor="rgba(59,130,246,0.02)" />
        </linearGradient>
      </defs>
      <polyline className="stats-sparkline-area" points={area} fill="url(#tapcanvas-stats-spark-fill)" stroke="none" />
      <polyline className="stats-sparkline-line" points={points} fill="none" stroke="rgba(59,130,246,0.9)" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
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
      <div className="stats-page" style={{ minHeight: '100vh', background }}>
        <ToastHost className="stats-page-toast" />
        <Container className="stats-page-container" size="md" py={40}>
          <Stack className="stats-page-stack" gap="md">
            <Group className="stats-page-header" justify="space-between">
              <Title className="stats-page-title" order={3}>{$('看板')}</Title>
              <Button className="stats-page-back" variant="subtle" component="a" href="/">
                {$('返回')}
              </Button>
            </Group>
            <Paper className="stats-page-card" withBorder radius="lg" p="md">
              <Text className="stats-page-text" size="sm" c="dimmed">
                {$('仅管理员可访问看板。')}
              </Text>
              <Text className="stats-page-subtext" size="xs" c="dimmed" mt={8}>
                {user?.login ? `login=${user.login}` : $('未登录')}
              </Text>
            </Paper>
          </Stack>
        </Container>
      </div>
    )
  }

  return (
    <div className="stats-page" style={{ minHeight: '100vh', background }}>
      <ToastHost className="stats-page-toast" />
      <Container className="stats-page-container" size="xl" px="md" py="md">
        <Box className="stats-page-hero" pt="md" pb="sm">
          <Group className="stats-page-topbar" justify="space-between" align="center" mb="md">
            <Group className="stats-page-topbar-left" gap={10} align="center">
              <Button
                className="stats-page-back"
                size="xs"
                variant="subtle"
                leftSection={<IconArrowLeft className="stats-page-back-icon" size={14} />}
                onClick={() => {
                  if (typeof window !== 'undefined') window.location.href = '/'
                }}
              >
                {$('返回 TapCanvas')}
              </Button>
              <Badge className="stats-page-admin-badge" variant="light" color="gray">
                admin
              </Badge>
            </Group>
            <Group className="stats-page-topbar-right" gap={6}>
              <Tooltip className="stats-page-refresh-tooltip" label={$('刷新')} withArrow>
                <ActionIcon className="stats-page-refresh" size="sm" variant="subtle" aria-label="刷新" onClick={() => void reload()} loading={loading}>
                  <IconRefresh className="stats-page-refresh-icon" size={14} />
                </ActionIcon>
              </Tooltip>
            </Group>
          </Group>

          <Stack className="stats-page-title-block" gap={6} mb="lg">
            <Group className="stats-page-title-row" gap={10} align="center">
              <IconUsers className="stats-page-title-icon" size={18} />
              <Title className="stats-page-title" order={2}>{$('看板')}</Title>
            </Group>
            <Text className="stats-page-subtitle" size="sm" c="dimmed" maw={720}>
              {$('在线/新增/日活统计（UTC 口径）。')}
            </Text>
          </Stack>
        </Box>

        {loading && !stats ? (
          <Center className="stats-page-loading" mih={260}>
            <Stack className="stats-page-loading-stack" gap={8} align="center">
              <Loader className="stats-page-loading-icon" size="sm" />
              <Text className="stats-page-loading-text" size="sm" c="dimmed">
                {$('加载中…')}
              </Text>
            </Stack>
          </Center>
        ) : !stats ? (
          <Center className="stats-page-empty" mih={260}>
            <Text className="stats-page-empty-text" size="sm" c="dimmed">
              {$('暂无数据')}
            </Text>
          </Center>
        ) : (
          <Stack className="stats-page-content" gap="md" pb="xl">
            <Group className="stats-page-metrics" grow>
              <Paper className="stats-page-metric glass" withBorder radius="lg" p="md">
                <Group className="stats-page-metric-row" justify="space-between">
                  <Text className="stats-page-metric-label" size="sm" fw={600}>
                    {$('当前在线')}
                  </Text>
                  <Text className="stats-page-metric-value" size="sm">{stats.onlineUsers}</Text>
                </Group>
              </Paper>
              <Paper className="stats-page-metric glass" withBorder radius="lg" p="md">
                <Group className="stats-page-metric-row" justify="space-between">
                  <Text className="stats-page-metric-label" size="sm" fw={600}>
                    {$('今日新增')}
                  </Text>
                  <Text className="stats-page-metric-value" size="sm">{stats.newUsersToday}</Text>
                </Group>
              </Paper>
              <Paper className="stats-page-metric glass" withBorder radius="lg" p="md">
                <Group className="stats-page-metric-row" justify="space-between">
                  <Text className="stats-page-metric-label" size="sm" fw={600}>
                    {$('总计用户')}
                  </Text>
                  <Text className="stats-page-metric-value" size="sm">{stats.totalUsers}</Text>
                </Group>
              </Paper>
            </Group>

            <Paper className="stats-page-chart glass" withBorder radius="lg" p="md">
              <Group className="stats-page-chart-header" justify="space-between" align="center" mb={10} wrap="wrap" gap={10}>
                <Text className="stats-page-chart-title" size="sm" fw={600}>
                  {$('日活曲线')}
                </Text>
                <SegmentedControl
                  className="stats-page-chart-control"
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
              <Group className="stats-page-chart-meta" justify="space-between" mt={10}>
                <Text className="stats-page-chart-meta-text" size="xs" c="dimmed">
                  {$('最低')}: {dau.length ? Math.min(...dau) : 0}
                </Text>
                <Text className="stats-page-chart-meta-text" size="xs" c="dimmed">
                  {$('最高')}: {dau.length ? Math.max(...dau) : 0}
                </Text>
              </Group>
              {lastUpdated && (
                <Text className="stats-page-chart-updated" size="xs" c="dimmed" mt={10}>
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
