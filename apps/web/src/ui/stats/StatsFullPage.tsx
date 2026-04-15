import React from 'react'
import { Box, Button, Center, Container, Group, SegmentedControl, SimpleGrid, Stack, Text, Title, Tooltip, useMantineColorScheme } from '@mantine/core'
import { IconArrowLeft, IconRefresh, IconUsers } from '@tabler/icons-react'
import { useAuth } from '../../auth/store'
import { useIsAdmin } from '../../auth/isAdmin'
import { getDailyActiveUsers, getRevenueBreakdown, getStats, getVendorApiCallStats, type RevenueBreakdownDto, type VendorApiCallStatDto } from '../../api/server'
import { ToastHost, toast } from '../toast'
import { $ } from '../../canvas/i18n'
import StatsSystemManagement from './system/StatsSystemManagement'
import StatsSkillManagement from './skills/StatsSkillManagement'
import StatsEnterpriseManagement from './enterprise/StatsEnterpriseManagement'
import StatsUserManagement from '../StatsUserManagement'
import StatsProjectManagement from './projects/StatsProjectManagement'
import StatsCommerceManagement from './commerce/StatsCommerceManagement'
import StatsMemoryManagement from './memory/StatsMemoryManagement'
import { navigateBackOr } from '../../utils/spaNavigate'
import { buildStudioUrl } from '../../utils/appRoutes'
import { PanelCard } from '../PanelCard'
import { InlinePanel } from '../InlinePanel'
import { IconActionButton } from '../IconActionButton'
import { StatePanel } from '../StatePanel'
import { StatusBadge } from '../StatusBadge'
import CanvasEntryButton from '../CanvasEntryButton'

type StatsSection = 'overview' | 'system' | 'memory' | 'skills' | 'enterprise' | 'users' | 'projects' | 'commerce'

type DauWindow = '7' | '30'
type VendorWindow = '7' | '15' | '30'
type RevenueDisplaySlice = {
  label: string
  amountCents: number
  orderCount: number
  share: number
  color: string
}

const REVENUE_SLICE_COLORS = ['#2563eb', '#0f766e', '#f97316', '#dc2626', '#7c3aed', '#0891b2'] as const

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

function isDauWindow(value: string): value is DauWindow {
  return value === '7' || value === '30'
}

function isVendorWindow(value: string): value is VendorWindow {
  return value === '7' || value === '15' || value === '30'
}

function getErrorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback
}

function formatRevenueAmount(amountCents: number, currency: string | null): string {
  const safeAmount = (Math.max(0, Number(amountCents || 0)) / 100).toFixed(2)
  const normalizedCurrency = typeof currency === 'string' ? currency.trim().toUpperCase() : ''
  return normalizedCurrency && normalizedCurrency !== 'CNY' ? `${normalizedCurrency} ${safeAmount}` : `¥${safeAmount}`
}

function RevenueDonutChart({
  totalAmountCents,
  currency,
  slices,
}: {
  totalAmountCents: number
  currency: string | null
  slices: RevenueDisplaySlice[]
}): JSX.Element {
  const chartSize = 188
  const radius = 54
  const center = chartSize / 2
  const circumference = 2 * Math.PI * radius
  let offset = 0

  return (
    <Box
      className="stats-revenue-donut"
      style={{
        position: 'relative',
        width: chartSize,
        height: chartSize,
        flex: '0 0 auto',
      }}
    >
      <svg className="stats-revenue-donut-svg" width={chartSize} height={chartSize} viewBox={`0 0 ${chartSize} ${chartSize}`}>
        <circle
          className="stats-revenue-donut-track"
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="rgba(148,163,184,0.18)"
          strokeWidth="18"
        />
        <g className="stats-revenue-donut-segments" transform={`rotate(-90 ${center} ${center})`}>
          {slices.map((slice) => {
            const length = Math.max(0, Math.min(circumference, circumference * slice.share))
            const circle = (
              <circle
                key={slice.label}
                className="stats-revenue-donut-segment"
                cx={center}
                cy={center}
                r={radius}
                fill="none"
                stroke={slice.color}
                strokeWidth="18"
                strokeLinecap="butt"
                strokeDasharray={`${length} ${Math.max(0, circumference - length)}`}
                strokeDashoffset={-offset}
              />
            )
            offset += length
            return circle
          })}
        </g>
      </svg>
      <Center
        className="stats-revenue-donut-center"
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
        }}
      >
        <Stack className="stats-revenue-donut-center-stack" gap={1} align="center">
          <Text className="stats-revenue-donut-center-label" size="xs" c="dimmed">
            {$('近30日收入')}
          </Text>
          <Text className="stats-revenue-donut-center-value" size="sm" fw={800}>
            {formatRevenueAmount(totalAmountCents, currency)}
          </Text>
        </Stack>
      </Center>
    </Box>
  )
}

function parseStatsSectionFromPathname(pathname: string): StatsSection {
  const path = String(pathname || '')

  if (path === '/stats' || path === '/stats/' || !path) return 'overview'

  if (!path.startsWith('/stats/')) return 'overview'

  const raw = path.slice('/stats/'.length)
  const first = raw.split('/').filter(Boolean)[0] || ''

  if (first === 'system') return 'system'
  if (first === 'memory') return 'memory'
  if (first === 'skills') return 'skills'
  if (first === 'model-credits') return 'system'
  if (first === 'enterprise') return 'enterprise'
  if (first === 'users') return 'users'
  if (first === 'projects') return 'projects'
  if (first === 'commerce') return 'commerce'
  if (first === 'overview') return 'overview'

  return 'overview'
}

function getPathnameForStatsSection(section: StatsSection): string {
  if (section === 'overview') return '/stats'
  return `/stats/${section}`
}

export default function StatsFullPage(): JSX.Element {
  const user = useAuth((s) => s.user)
  const isAdmin = useIsAdmin()
  const { colorScheme } = useMantineColorScheme()
  const isDark = colorScheme === 'dark'

  const [section, setSection] = React.useState<StatsSection>(() => {
    if (typeof window === 'undefined') return 'overview'
    return parseStatsSectionFromPathname(window.location.pathname || '')
  })

  const [loading, setLoading] = React.useState(false)
  const [stats, setStats] = React.useState<{ onlineUsers: number; totalUsers: number; newUsersToday: number } | null>(null)
  const [dauDays, setDauDays] = React.useState<DauWindow>('30')
  const [dau, setDau] = React.useState<number[]>([])
  const [vendorDays, setVendorDays] = React.useState<VendorWindow>('7')
  const [vendorStats, setVendorStats] = React.useState<VendorApiCallStatDto[]>([])
  const [revenue, setRevenue] = React.useState<RevenueBreakdownDto | null>(null)
  const [lastUpdated, setLastUpdated] = React.useState<number | null>(null)
  const studioUrl = React.useMemo(() => buildStudioUrl(), [])

  React.useEffect(() => {
    if (typeof window === 'undefined') return
    const onPopState = () => {
      setSection(parseStatsSectionFromPathname(window.location.pathname || ''))
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  React.useEffect(() => {
    if (typeof window === 'undefined') return
    const desired = getPathnameForStatsSection(section)
    const current = window.location.pathname || ''
    if (current === desired || current === `${desired}/`) return
    if (!(current === '/stats' || current === '/stats/' || current.startsWith('/stats/'))) return
    try {
      window.history.pushState({}, '', desired)
    } catch {
      // ignore
    }
  }, [section])

  const reload = React.useCallback(async () => {
    setLoading(true)
    try {
      const [statsRes, dauRes, vendorRes, revenueRes] = await Promise.allSettled([
        getStats(),
        getDailyActiveUsers(dauDays === '7' ? 7 : 30),
        getVendorApiCallStats(vendorDays === '15' ? 15 : vendorDays === '30' ? 30 : 7, 60),
        getRevenueBreakdown(30),
      ])

      let anyOk = false

      if (statsRes.status === 'fulfilled') {
        setStats(statsRes.value)
        anyOk = true
      } else {
        toast(getErrorMessage(statsRes.reason, '加载统计失败'), 'error')
      }

      if (dauRes.status === 'fulfilled') {
        setDau((dauRes.value?.series || []).map((p) => p.activeUsers))
        anyOk = true
      } else {
        toast(getErrorMessage(dauRes.reason, '加载日活失败'), 'error')
      }

      if (vendorRes.status === 'fulfilled') {
        setVendorStats(vendorRes.value?.vendors || [])
        anyOk = true
      } else {
        toast(getErrorMessage(vendorRes.reason, '加载厂商统计失败'), 'error')
      }

      if (revenueRes.status === 'fulfilled') {
        setRevenue(revenueRes.value)
        anyOk = true
      } else {
        toast(getErrorMessage(revenueRes.reason, '加载收入统计失败'), 'error')
      }

      if (anyOk) setLastUpdated(Date.now())
    } finally {
      setLoading(false)
    }
  }, [dauDays, vendorDays])

  React.useEffect(() => {
    void reload()
  }, [reload])

  const revenueDisplaySlices = React.useMemo<RevenueDisplaySlice[]>(() => {
    const sourceSlices = Array.isArray(revenue?.slices) ? revenue.slices : []
    if (!sourceSlices.length) return []
    const maxSlices = 5
    const visibleSlices = sourceSlices.slice(0, maxSlices)
    const remainingSlices = sourceSlices.slice(maxSlices)
    const mergedSlices = remainingSlices.length > 0
      ? [
          ...visibleSlices,
          {
            label: $('其他'),
            amountCents: remainingSlices.reduce((sum, slice) => sum + slice.amountCents, 0),
            orderCount: remainingSlices.reduce((sum, slice) => sum + slice.orderCount, 0),
            quantity: remainingSlices.reduce((sum, slice) => sum + slice.quantity, 0),
            share: remainingSlices.reduce((sum, slice) => sum + slice.share, 0),
          },
        ]
      : visibleSlices
    return mergedSlices.map((slice, index) => ({
      label: slice.label,
      amountCents: slice.amountCents,
      orderCount: slice.orderCount,
      share: slice.share,
      color: REVENUE_SLICE_COLORS[index % REVENUE_SLICE_COLORS.length],
    }))
  }, [revenue])

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
              <Button className="stats-page-back" variant="subtle" onClick={() => navigateBackOr(studioUrl)}>
                {$('返回')}
              </Button>
            </Group>
            <PanelCard className="stats-page-card">
              <Text className="stats-page-text" size="sm" c="dimmed">
                {$('仅管理员可访问看板。')}
              </Text>
              <Text className="stats-page-subtext" size="xs" c="dimmed" mt={8}>
                {user?.login ? `login=${user.login}` : $('未登录')}
              </Text>
            </PanelCard>
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
                onClick={() => navigateBackOr(studioUrl)}
              >
                {$('返回 TapCanvas')}
              </Button>
              <StatusBadge className="stats-page-admin-badge" tone="neutral" variant="light">
                admin
              </StatusBadge>
            </Group>
            <Group className="stats-page-topbar-right" gap={6}>
              <CanvasEntryButton
                href={studioUrl}
                variant="light"
                size="xs"
              />
              <Tooltip className="stats-page-refresh-tooltip" label={$('刷新')} withArrow>
                <IconActionButton className="stats-page-refresh" size="sm" aria-label="刷新" onClick={() => void reload()} loading={loading} icon={
                  <IconRefresh className="stats-page-refresh-icon" size={14} />
                } />
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
              radius="sm"
              value={section}
              onChange={(v) => setSection(v as StatsSection)}
              data={[
                { value: 'overview', label: '概览' },
                { value: 'system', label: '系统管理' },
                { value: 'memory', label: '记忆调试' },
                { value: 'skills', label: 'Skill' },
                { value: 'enterprise', label: '企业管理' },
                { value: 'users', label: '用户管理' },
                { value: 'projects', label: '项目管理' },
                { value: 'commerce', label: '商城管理' },
              ]}
            />
          </Stack>
        </Box>

        {section === 'system' ? (
          <Stack className="stats-page-system" gap="md" pb="xl">
            <StatsSystemManagement className="stats-page-system-management" />
          </Stack>
        ) : section === 'memory' ? (
          <Stack className="stats-page-memory" gap="md" pb="xl">
            <StatsMemoryManagement className="stats-page-memory-management" />
          </Stack>
        ) : section === 'skills' ? (
          <Stack className="stats-page-skills" gap="md" pb="xl">
            <StatsSkillManagement className="stats-page-skill-management" />
          </Stack>
        ) : section === 'projects' ? (
          <Stack className="stats-page-projects" gap="md" pb="xl">
            <StatsProjectManagement className="stats-page-projects-management" />
          </Stack>
        ) : section === 'commerce' ? (
          <Stack className="stats-page-commerce" gap="md" pb="xl">
            <StatsCommerceManagement className="stats-page-commerce-management" />
          </Stack>
        ) : section === 'users' ? (
          <Stack className="stats-page-users" gap="md" pb="xl">
            <StatsUserManagement className="stats-page-users-management" />
          </Stack>
        ) : section === 'enterprise' ? (
          <Stack className="stats-page-enterprise" gap="md" pb="xl">
            <StatsEnterpriseManagement className="stats-page-enterprise-management" />
          </Stack>
        ) : loading && !stats ? (
          <Center className="stats-page-loading" mih={260}>
            <StatePanel className="stats-page-loading-stack" title={$('加载中…')} tone="loading" />
          </Center>
        ) : !stats ? (
          <Center className="stats-page-empty" mih={260}>
            <StatePanel className="stats-page-empty-text" title={$('暂无数据')} description={$('当前没有可展示的系统统计结果。')} />
          </Center>
        ) : (
          <Stack className="stats-page-content" gap="md" pb="xl">
            <Group className="stats-page-metrics" grow>
              <InlinePanel className="stats-page-metric">
                <Group className="stats-page-metric-row" justify="space-between">
                  <Text className="stats-page-metric-label" size="sm" fw={600}>
                    {$('当前在线')}
                  </Text>
                  <Text className="stats-page-metric-value" size="sm">{stats.onlineUsers}</Text>
                </Group>
              </InlinePanel>
              <InlinePanel className="stats-page-metric">
                <Group className="stats-page-metric-row" justify="space-between">
                  <Text className="stats-page-metric-label" size="sm" fw={600}>
                    {$('今日新增')}
                  </Text>
                  <Text className="stats-page-metric-value" size="sm">{stats.newUsersToday}</Text>
                </Group>
              </InlinePanel>
              <InlinePanel className="stats-page-metric">
                <Group className="stats-page-metric-row" justify="space-between">
                  <Text className="stats-page-metric-label" size="sm" fw={600}>
                    {$('总计用户')}
                  </Text>
                  <Text className="stats-page-metric-value" size="sm">{stats.totalUsers}</Text>
                </Group>
              </InlinePanel>
            </Group>

            <SimpleGrid className="stats-page-overview-grid" cols={{ base: 1, lg: 2 }} spacing="md" verticalSpacing="md">
              <PanelCard className="stats-page-chart">
                <Group className="stats-page-chart-header" justify="space-between" align="center" mb={10} wrap="wrap" gap={10}>
                  <Text className="stats-page-chart-title" size="sm" fw={600}>
                    {$('日活曲线')}
                  </Text>
                  <SegmentedControl
                    className="stats-page-chart-control"
                    size="xs"
                    radius="sm"
                    value={dauDays}
                    onChange={(value) => {
                      if (isDauWindow(value)) setDauDays(value)
                    }}
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
              </PanelCard>

              <PanelCard className="stats-page-revenue">
                <Group className="stats-page-revenue-header" justify="space-between" align="flex-start" mb={10} gap={10}>
                  <Stack className="stats-page-revenue-header-copy" gap={2}>
                    <Text className="stats-page-revenue-title" size="sm" fw={600}>
                      {$('近30日收入')}
                    </Text>
                    <Text className="stats-page-revenue-subtitle" size="xs" c="dimmed">
                      {$('按已支付订单中的商品标题聚合。')}
                    </Text>
                  </Stack>
                  <Stack className="stats-page-revenue-meta" gap={2} align="flex-end">
                    <Text className="stats-page-revenue-meta-value" size="sm" fw={700}>
                      {formatRevenueAmount(revenue?.totalAmountCents ?? 0, revenue?.currency ?? null)}
                    </Text>
                    <Text className="stats-page-revenue-meta-label" size="xs" c="dimmed">
                      {$('付费订单')}: {revenue?.paidOrderCount ?? 0}
                    </Text>
                  </Stack>
                </Group>

                {!revenue || revenue.totalAmountCents <= 0 || revenueDisplaySlices.length === 0 ? (
                  <Center className="stats-page-revenue-empty" mih={220}>
                    <Text className="stats-page-revenue-empty-text" size="sm" c="dimmed">
                      {$('近30日暂无已支付收入。')}
                    </Text>
                  </Center>
                ) : (
                  <Group className="stats-page-revenue-body" align="center" justify="space-between" gap="lg" wrap="wrap">
                    <RevenueDonutChart
                      totalAmountCents={revenue.totalAmountCents}
                      currency={revenue.currency}
                      slices={revenueDisplaySlices}
                    />
                    <Stack className="stats-page-revenue-legend" gap="xs" style={{ flex: 1, minWidth: 260 }}>
                      {revenueDisplaySlices.map((slice) => (
                        <Group key={slice.label} className="stats-page-revenue-legend-item" justify="space-between" gap={10} wrap="nowrap">
                          <Group className="stats-page-revenue-legend-main" gap={10} wrap="nowrap">
                            <Box
                              className="stats-page-revenue-legend-swatch"
                              style={{
                                width: 10,
                                height: 10,
                                borderRadius: 999,
                                background: slice.color,
                                flex: '0 0 auto',
                              }}
                            />
                            <Stack className="stats-page-revenue-legend-copy" gap={0}>
                              <Text className="stats-page-revenue-legend-label" size="sm" fw={600} lineClamp={1}>
                                {slice.label}
                              </Text>
                              <Text className="stats-page-revenue-legend-subtext" size="xs" c="dimmed">
                                {$('订单')}: {slice.orderCount}
                              </Text>
                            </Stack>
                          </Group>
                          <Stack className="stats-page-revenue-legend-metrics" gap={0} align="flex-end">
                            <Text className="stats-page-revenue-legend-value" size="sm" fw={700}>
                              {formatRevenueAmount(slice.amountCents, revenue.currency)}
                            </Text>
                            <Text className="stats-page-revenue-legend-share" size="xs" c="dimmed">
                              {(slice.share * 100).toFixed(1)}%
                            </Text>
                          </Stack>
                        </Group>
                      ))}
                    </Stack>
                  </Group>
                )}
              </PanelCard>
            </SimpleGrid>

            <PanelCard className="stats-page-vendors">
              <Group className="stats-page-vendors-header" justify="space-between" align="center" mb={10} wrap="wrap" gap={10}>
                <Text className="stats-page-vendors-title" size="sm" fw={600}>
                  {$('厂商 API 调用成功率')}
                </Text>
                <SegmentedControl
                  className="stats-page-vendors-control"
                  size="xs"
                  radius="sm"
                  value={vendorDays}
                  onChange={(value) => {
                    if (isVendorWindow(value)) setVendorDays(value)
                  }}
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
                      <InlinePanel key={v.vendor} className="stats-vendor-card">
                        <Group className="stats-vendor-card-header" justify="space-between" align="flex-start" gap={10}>
                          <Stack className="stats-vendor-card-title" gap={2}>
                            <Text className="stats-vendor-card-name" size="sm" fw={700}>
                              {v.vendor}
                            </Text>
                            <Text className="stats-vendor-card-subtitle" size="xs" c="dimmed">
                              {v.lastAt ? `${$('最近完成')}: ${new Date(v.lastAt).toLocaleString()}` : $('暂无完成记录')}
                            </Text>
                          </Stack>
                          <StatusBadge className="stats-vendor-card-badge" tone={!hasData ? 'neutral' : lastOk ? 'success' : 'danger'} variant="light">
                            {badgeText}
                          </StatusBadge>
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
                      </InlinePanel>
                    )
                  })}
                </SimpleGrid>
              )}
            </PanelCard>
          </Stack>
        )}
      </Container>
    </div>
  )
}
