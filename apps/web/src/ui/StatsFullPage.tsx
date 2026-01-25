import React from 'react'
import { ActionIcon, Badge, Box, Button, Center, Container, Group, Loader, Paper, SegmentedControl, SimpleGrid, Stack, Text, Title, Tooltip, useMantineColorScheme } from '@mantine/core'
import { IconArrowLeft, IconRefresh, IconUsers } from '@tabler/icons-react'
import { useAuth } from '../auth/store'
import { useIsAdmin } from '../auth/isAdmin'
import { getDailyActiveUsers, getStats, getVendorApiCallStats, type VendorApiCallStatDto } from '../api/server'
import { ToastHost, toast } from './toast'
import { $ } from '../canvas/i18n'
import StatsSystemManagement from './StatsSystemManagement'

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
  const isAdmin = useIsAdmin()
  const { colorScheme } = useMantineColorScheme()
  const isDark = colorScheme === 'dark'

  const [section, setSection] = React.useState<'overview' | 'system'>('overview')

  const [loading, setLoading] = React.useState(false)
  const [stats, setStats] = React.useState<{ onlineUsers: number; totalUsers: number; newUsersToday: number } | null>(null)
  const [dauDays, setDauDays] = React.useState<'7' | '30'>('30')
  const [dau, setDau] = React.useState<number[]>([])
  const [vendorDays, setVendorDays] = React.useState<'7' | '15' | '30'>('7')
  const [vendorStats, setVendorStats] = React.useState<VendorApiCallStatDto[]>([])
  const [lastUpdated, setLastUpdated] = React.useState<number | null>(null)

  const reload = React.useCallback(async () => {
    setLoading(true)
    try {
      const [statsRes, dauRes, vendorRes] = await Promise.allSettled([
        getStats(),
        getDailyActiveUsers(dauDays === '7' ? 7 : 30),
        getVendorApiCallStats(vendorDays === '15' ? 15 : vendorDays === '30' ? 30 : 7, 60),
      ])

      let anyOk = false

      if (statsRes.status === 'fulfilled') {
        setStats(statsRes.value)
        anyOk = true
      } else {
        const msg = (statsRes.reason as any)?.message || '加载统计失败'
        toast(msg, 'error')
      }

      if (dauRes.status === 'fulfilled') {
        setDau((dauRes.value?.series || []).map((p) => p.activeUsers))
        anyOk = true
      } else {
        const msg = (dauRes.reason as any)?.message || '加载日活失败'
        toast(msg, 'error')
      }

      if (vendorRes.status === 'fulfilled') {
        setVendorStats(vendorRes.value?.vendors || [])
        anyOk = true
      } else {
        const msg = (vendorRes.reason as any)?.message || '加载厂商统计失败'
        toast(msg, 'error')
      }

      if (anyOk) setLastUpdated(Date.now())
    } finally {
      setLoading(false)
    }
  }, [dauDays, vendorDays])

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
            <SegmentedControl
              className="stats-page-section-control"
              size="xs"
              radius="xl"
              value={section}
              onChange={(v) => setSection(v as any)}
              data={[
                { value: 'overview', label: '概览' },
                { value: 'system', label: '系统管理' },
              ]}
            />
          </Stack>
        </Box>

        {section === 'system' ? (
          <Stack className="stats-page-system" gap="md" pb="xl">
            <StatsSystemManagement className="stats-page-system-management" />
          </Stack>
        ) : loading && !stats ? (
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

            <Paper className="stats-page-vendors glass" withBorder radius="lg" p="md">
              <Group className="stats-page-vendors-header" justify="space-between" align="center" mb={10} wrap="wrap" gap={10}>
                <Text className="stats-page-vendors-title" size="sm" fw={600}>
                  {$('厂商 API 调用成功率')}
                </Text>
                <SegmentedControl
                  className="stats-page-vendors-control"
                  size="xs"
                  radius="xl"
                  value={vendorDays}
                  onChange={(v) => setVendorDays(v as any)}
                  data={[
                    { value: '7', label: '7d' },
                    { value: '15', label: '15d' },
                    { value: '30', label: '30d' },
                  ]}
                />
              </Group>

              {vendorStats.length === 0 ? (
                <Text className="stats-page-vendors-empty" size="sm" c="dimmed">
                  {$('暂无三方调用数据（仅统计已完成的任务）。')}
                </Text>
              ) : (
                <SimpleGrid
                  className="stats-page-vendors-grid"
                  cols={{ base: 1, sm: 2, md: 3 }}
                  spacing="md"
                  verticalSpacing="md"
                >
                  {vendorStats.map((v) => {
                    const successPct = Math.max(0, Math.min(100, (v.successRate || 0) * 100))
                    const lastOk = v.lastStatus === 'succeeded'
                    const hasData = v.total > 0
                    const badgeColor = !hasData ? 'gray' : lastOk ? 'green' : 'red'
                    const badgeText = !hasData ? $('暂无数据') : lastOk ? $('正常') : $('异常')
                    const avgMs = typeof v.avgDurationMs === 'number' ? v.avgDurationMs : null
                    const avgText =
                      typeof avgMs === 'number' && Number.isFinite(avgMs)
                        ? avgMs >= 60_000
                          ? `${Math.round(avgMs / 1000)}s`
                          : avgMs >= 1000
                            ? `${(avgMs / 1000).toFixed(1)}s`
                            : `${Math.round(avgMs)}ms`
                        : '—'

                    return (
                      <Paper key={v.vendor} className="stats-vendor-card glass" withBorder radius="lg" p="md">
                        <Group className="stats-vendor-card-header" justify="space-between" align="flex-start" gap={10}>
                          <Stack className="stats-vendor-card-title" gap={2}>
                            <Text className="stats-vendor-card-name" size="sm" fw={700}>
                              {v.vendor}
                            </Text>
                            <Text className="stats-vendor-card-subtitle" size="xs" c="dimmed">
                              {v.lastAt ? `${$('最近完成')}: ${new Date(v.lastAt).toLocaleString()}` : $('暂无完成记录')}
                            </Text>
                          </Stack>
                          <Badge className="stats-vendor-card-badge" variant="light" color={badgeColor}>
                            {badgeText}
                          </Badge>
                        </Group>

                        <Group className="stats-vendor-card-metrics" mt={12} gap={14} wrap="wrap">
                          <Stack className="stats-vendor-card-metric" gap={2}>
                            <Text className="stats-vendor-card-metric-label" size="xs" c="dimmed">
                              {$('可用率')} ({vendorDays}d)
                            </Text>
                            <Text className="stats-vendor-card-metric-value" size="sm" fw={700}>
                              {hasData ? `${successPct.toFixed(2)}%` : '—'}
                            </Text>
                          </Stack>
                          <Stack className="stats-vendor-card-metric" gap={2}>
                            <Text className="stats-vendor-card-metric-label" size="xs" c="dimmed">
                              {$('成功/总数')}
                            </Text>
                            <Text className="stats-vendor-card-metric-value" size="sm" fw={700}>
                              {v.success}/{v.total}
                            </Text>
                          </Stack>
                          <Stack className="stats-vendor-card-metric" gap={2}>
                            <Text className="stats-vendor-card-metric-label" size="xs" c="dimmed">
                              {$('平均完成耗时')}
                            </Text>
                            <Text className="stats-vendor-card-metric-value" size="sm" fw={700}>
                              {avgText}
                            </Text>
                          </Stack>
                        </Group>

                        <Stack className="stats-vendor-card-history" gap={6} mt={14}>
                          <Group className="stats-vendor-card-history-header" justify="space-between" align="center">
                            <Text className="stats-vendor-card-history-title" size="xs" c="dimmed">
                              {$('历史')} ({Math.min(60, v.history.length)} {$('条')})
                            </Text>
                            <Text className="stats-vendor-card-history-hint" size="xs" c="dimmed">
                              {$('绿=成功 / 红=失败')}
                            </Text>
                          </Group>
                          <Box
                            className="stats-vendor-card-history-bars"
                            style={{
                              display: 'flex',
                              alignItems: 'stretch',
                              gap: 2,
                              overflow: 'hidden',
                            }}
                          >
                            {v.history.slice(-60).map((h, idx) => {
                              const ok = h.status === 'succeeded'
                              return (
                                <Tooltip
                                  key={`${h.finishedAt}-${idx}`}
                                  className="stats-vendor-card-history-tooltip"
                                  label={`${ok ? $('成功') : $('失败')} · ${new Date(h.finishedAt).toLocaleString()}`}
                                  withArrow
                                >
                                  <Box
                                    className="stats-vendor-card-history-bar"
                                    style={{
                                      flex: 1,
                                      minWidth: 2,
                                      height: 18,
                                      borderRadius: 3,
                                      background: ok ? 'rgba(34,197,94,0.9)' : 'rgba(239,68,68,0.9)',
                                      opacity: ok ? 0.9 : 0.85,
                                    }}
                                  />
                                </Tooltip>
                              )
                            })}
                          </Box>
                        </Stack>
                      </Paper>
                    )
                  })}
                </SimpleGrid>
              )}
            </Paper>
          </Stack>
        )}
      </Container>
    </div>
  )
}
