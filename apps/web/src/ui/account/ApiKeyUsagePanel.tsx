import React from 'react'
import { Badge, Button, Group, Loader, SegmentedControl, Stack, Table, Tabs, Text } from '@mantine/core'
import { getApiKeyCredits, getApiKeyUsage, type ApiKeyCreditItem, type ApiKeyUsageItem } from '../../api/server'

const PAGE_SIZE = 20
type RangePreset = 'all' | '7d' | '30d'

function sinceForRange(range: RangePreset): string | undefined {
  if (range === 'all') return undefined
  const days = range === '7d' ? 7 : 30
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

function formatTime(value: string): string {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString('zh-CN') : value
}

function describeError(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message.trim() ? reason.message : fallback
}

export function ApiKeyUsagePanel({ apiKeyId }: { apiKeyId: string }): JSX.Element {
  const [range, setRange] = React.useState<RangePreset>('all')
  const [usage, setUsage] = React.useState<ApiKeyUsageItem[]>([])
  const [usageHasMore, setUsageHasMore] = React.useState(false)
  const [usageMoreLoading, setUsageMoreLoading] = React.useState(false)
  const [creditSummary, setCreditSummary] = React.useState<{ personalSpent: number; teamSpent: number }>({ personalSpent: 0, teamSpent: 0 })
  const [creditItems, setCreditItems] = React.useState<ApiKeyCreditItem[]>([])
  const [creditsHasMore, setCreditsHasMore] = React.useState(false)
  const [creditsMoreLoading, setCreditsMoreLoading] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const loadFirstPage = React.useCallback(async (signal?: { cancelled: boolean }) => {
    setLoading(true)
    setError(null)
    const since = sinceForRange(range)
    try {
      const [usageResult, creditResult] = await Promise.all([
        getApiKeyUsage(apiKeyId, { limit: PAGE_SIZE, ...(since ? { since } : {}) }),
        getApiKeyCredits(apiKeyId, { limit: PAGE_SIZE, ...(since ? { since } : {}) }),
      ])
      if (signal?.cancelled) return
      setUsage(usageResult.items)
      setUsageHasMore(usageResult.items.length >= PAGE_SIZE)
      setCreditSummary(creditResult.summary)
      setCreditItems(creditResult.items)
      setCreditsHasMore(creditResult.items.length >= PAGE_SIZE)
    } catch (reason: unknown) {
      if (signal?.cancelled) return
      setUsage([])
      setUsageHasMore(false)
      setCreditSummary({ personalSpent: 0, teamSpent: 0 })
      setCreditItems([])
      setCreditsHasMore(false)
      setError(describeError(reason, '加载密钥消耗记录失败'))
    } finally {
      if (!signal?.cancelled) setLoading(false)
    }
  }, [apiKeyId, range])

  React.useEffect(() => {
    const signal = { cancelled: false }
    void loadFirstPage(signal)
    return () => { signal.cancelled = true }
  }, [loadFirstPage])

  const loadMoreUsage = React.useCallback(async () => {
    const last = usage[usage.length - 1]
    if (!last || usageMoreLoading) return
    setUsageMoreLoading(true)
    setError(null)
    try {
      const since = sinceForRange(range)
      const result = await getApiKeyUsage(apiKeyId, { limit: PAGE_SIZE, before: last.startedAt, ...(since ? { since } : {}) })
      setUsage((current) => [...current, ...result.items])
      setUsageHasMore(result.items.length >= PAGE_SIZE)
    } catch (reason: unknown) {
      setError(describeError(reason, '加载更多调用记录失败'))
    } finally {
      setUsageMoreLoading(false)
    }
  }, [apiKeyId, range, usage, usageMoreLoading])

  const loadMoreCredits = React.useCallback(async () => {
    const last = creditItems[creditItems.length - 1]
    if (!last || creditsMoreLoading) return
    setCreditsMoreLoading(true)
    setError(null)
    try {
      const since = sinceForRange(range)
      const result = await getApiKeyCredits(apiKeyId, { limit: PAGE_SIZE, before: last.createdAt, ...(since ? { since } : {}) })
      setCreditItems((current) => [...current, ...result.items])
      setCreditsHasMore(result.items.length >= PAGE_SIZE)
    } catch (reason: unknown) {
      setError(describeError(reason, '加载更多积分消耗失败'))
    } finally {
      setCreditsMoreLoading(false)
    }
  }, [apiKeyId, creditItems, creditsMoreLoading, range])

  return (
    <Stack className="account-api-key-usage" gap="sm">
      <Group className="account-api-key-usage__toolbar" justify="space-between" align="center">
        <Text className="account-api-key-usage__title" size="sm" fw={600}>密钥消耗记录</Text>
        <SegmentedControl
          className="account-api-key-usage__range"
          size="xs"
          value={range}
          onChange={(value) => setRange(value as RangePreset)}
          data={[
            { value: 'all', label: '全部' },
            { value: '7d', label: '近 7 天' },
            { value: '30d', label: '近 30 天' },
          ]}
        />
      </Group>
      {loading ? <Loader className="account-api-key-usage__loader" size="sm" /> : null}
      {!loading && error ? (
        <div className="account-api-key-usage__error">
          <Text className="account-api-key-usage__error-message" size="xs" c="red">{error}</Text>
          <Button className="account-api-key-usage__retry" size="xs" variant="subtle" onClick={() => void loadFirstPage()}>重试</Button>
        </div>
      ) : null}
      {!loading && !error ? (
        <Tabs className="account-api-key-usage__tabs" defaultValue="usage">
          <Tabs.List className="account-api-key-usage__tab-list">
            <Tabs.Tab className="account-api-key-usage__tab" value="usage">调用流水</Tabs.Tab>
            <Tabs.Tab className="account-api-key-usage__tab" value="credits">积分消耗</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel className="account-api-key-usage__panel" value="usage" pt="sm">
            <div className="account-api-key-usage__table-wrap">
              <Table className="account-api-key-usage__table">
                <Table.Thead className="account-api-key-usage__table-head">
                  <Table.Tr className="account-api-key-usage__table-row">
                    <Table.Th className="account-api-key-usage__table-heading">时间</Table.Th>
                    <Table.Th className="account-api-key-usage__table-heading">方法 / 路径</Table.Th>
                    <Table.Th className="account-api-key-usage__table-heading">状态</Table.Th>
                    <Table.Th className="account-api-key-usage__table-heading">耗时</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody className="account-api-key-usage__table-body">
                  {usage.map((item) => (
                    <Table.Tr className="account-api-key-usage__table-row" key={item.id}>
                      <Table.Td className="account-api-key-usage__table-cell">{formatTime(item.startedAt)}</Table.Td>
                      <Table.Td className="account-api-key-usage__table-cell"><span className="account-api-key-usage__method">{item.method}</span> {item.path}</Table.Td>
                      <Table.Td className="account-api-key-usage__table-cell"><Badge className="account-api-key-usage__status" color={item.status !== null && item.status < 400 ? 'green' : 'red'}>{item.status ?? '—'}</Badge></Table.Td>
                      <Table.Td className="account-api-key-usage__table-cell">{item.durationMs === null ? '—' : `${item.durationMs} ms`}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </div>
            {usage.length === 0 ? <Text className="account-api-key-usage__empty" size="sm" c="dimmed" ta="center" mt="sm">暂无调用记录</Text> : null}
            {usageHasMore ? <Group className="account-api-key-usage__more" justify="center" mt="sm"><Button className="account-api-key-usage__more-button" size="xs" variant="light" loading={usageMoreLoading} onClick={() => void loadMoreUsage()}>加载更多</Button></Group> : null}
          </Tabs.Panel>
          <Tabs.Panel className="account-api-key-usage__panel" value="credits" pt="sm">
            <Group className="account-api-key-usage__summary" mb="sm">
              <Text className="account-api-key-usage__summary-item" size="sm">个人消耗：{creditSummary.personalSpent.toLocaleString('zh-CN')}</Text>
              <Text className="account-api-key-usage__summary-item" size="sm">团队消耗：{creditSummary.teamSpent.toLocaleString('zh-CN')}</Text>
            </Group>
            <div className="account-api-key-usage__table-wrap">
              <Table className="account-api-key-usage__table">
                <Table.Thead className="account-api-key-usage__table-head">
                  <Table.Tr className="account-api-key-usage__table-row">
                    <Table.Th className="account-api-key-usage__table-heading">时间</Table.Th>
                    <Table.Th className="account-api-key-usage__table-heading">来源</Table.Th>
                    <Table.Th className="account-api-key-usage__table-heading">类型</Table.Th>
                    <Table.Th className="account-api-key-usage__table-heading">积分</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody className="account-api-key-usage__table-body">
                  {creditItems.map((item, index) => (
                    <Table.Tr className="account-api-key-usage__table-row" key={`${item.createdAt}-${index}`}>
                      <Table.Td className="account-api-key-usage__table-cell">{formatTime(item.createdAt)}</Table.Td>
                      <Table.Td className="account-api-key-usage__table-cell">{item.source === 'team' ? '团队' : '个人'}</Table.Td>
                      <Table.Td className="account-api-key-usage__table-cell">{item.kind ?? '—'}</Table.Td>
                      <Table.Td className="account-api-key-usage__table-cell">{item.amount.toLocaleString('zh-CN')}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </div>
            {creditItems.length === 0 ? <Text className="account-api-key-usage__empty" size="sm" c="dimmed" ta="center" mt="sm">暂无消耗记录</Text> : null}
            {creditsHasMore ? <Group className="account-api-key-usage__more" justify="center" mt="sm"><Button className="account-api-key-usage__more-button" size="xs" variant="light" loading={creditsMoreLoading} onClick={() => void loadMoreCredits()}>加载更多</Button></Group> : null}
          </Tabs.Panel>
        </Tabs>
      ) : null}
    </Stack>
  )
}
