import React from 'react'
import { Group, Loader, Stack, Table, Tabs, Text, TextInput, Title } from '@mantine/core'
import {
  adminListReferralBindings,
  adminListReferralGrants,
  adminListReferralOverview,
  type AdminReferralBindingRowDto,
  type AdminReferralGrantRowDto,
  type AdminReferralOverviewRowDto,
} from '../api/server'

function formatTime(iso: string | null): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  return Number.isFinite(t) ? new Date(t).toLocaleString() : iso
}

function userLabel(login: string | null, phone: string | null, id: string): string {
  return login || phone || id.slice(0, 12)
}

function OverviewTable() {
  const [rows, setRows] = React.useState<AdminReferralOverviewRowDto[] | null>(null)
  const [search, setSearch] = React.useState('')
  const [loading, setLoading] = React.useState(false)

  const reload = React.useCallback(async (q: string) => {
    setLoading(true)
    try {
      const r = await adminListReferralOverview({ search: q || undefined, limit: 100 })
      setRows(r.items)
    } catch (err) {
      console.warn('[referral admin] overview load failed', err)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { void reload('') }, [reload])

  return (
    <Stack gap="sm">
      <Group>
        <TextInput
          placeholder="按 login / 手机号 / 邀请码搜索"
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void reload(search) }}
          style={{ flex: 1 }}
        />
        {loading ? <Loader size="xs" /> : null}
      </Group>
      <Table striped withTableBorder withColumnBorders highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>邀请人</Table.Th>
            <Table.Th>邀请码</Table.Th>
            <Table.Th ta="right">已邀人数</Table.Th>
            <Table.Th ta="right">累计返佣</Table.Th>
            <Table.Th>最近一次返佣</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows && rows.length > 0 ? rows.map((r) => (
            <Table.Tr key={r.referrer_user_id}>
              <Table.Td>{userLabel(r.referrer_login, r.referrer_phone, r.referrer_user_id)}</Table.Td>
              <Table.Td><Text size="sm" ff="monospace">{r.referrer_invite_code ?? '—'}</Text></Table.Td>
              <Table.Td ta="right">{r.invitee_count}</Table.Td>
              <Table.Td ta="right">{r.total_granted_credits}</Table.Td>
              <Table.Td>{formatTime(r.last_grant_at)}</Table.Td>
            </Table.Tr>
          )) : (
            <Table.Tr><Table.Td colSpan={5}><Text size="sm" c="dimmed" ta="center">暂无数据</Text></Table.Td></Table.Tr>
          )}
        </Table.Tbody>
      </Table>
    </Stack>
  )
}

function BindingsTable() {
  const [rows, setRows] = React.useState<AdminReferralBindingRowDto[] | null>(null)
  const [loading, setLoading] = React.useState(false)
  React.useEffect(() => {
    setLoading(true)
    adminListReferralBindings({ limit: 200 })
      .then((r) => setRows(r.items))
      .catch((err) => console.warn('[referral admin] bindings load failed', err))
      .finally(() => setLoading(false))
  }, [])
  return (
    <Stack gap="sm">
      {loading ? <Loader size="xs" /> : null}
      <Table striped withTableBorder withColumnBorders highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>被邀请人</Table.Th>
            <Table.Th>邀请人</Table.Th>
            <Table.Th>绑定时间</Table.Th>
            <Table.Th ta="right">该好友带来的返佣</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows && rows.length > 0 ? rows.map((r) => (
            <Table.Tr key={r.invitee_user_id}>
              <Table.Td>{userLabel(r.invitee_login, r.invitee_phone, r.invitee_user_id)}</Table.Td>
              <Table.Td>{userLabel(r.referrer_login, r.referrer_phone, r.referrer_user_id)}</Table.Td>
              <Table.Td>{formatTime(r.referrer_bound_at)}</Table.Td>
              <Table.Td ta="right">{r.invitee_grant_total}</Table.Td>
            </Table.Tr>
          )) : (
            <Table.Tr><Table.Td colSpan={4}><Text size="sm" c="dimmed" ta="center">暂无绑定记录</Text></Table.Td></Table.Tr>
          )}
        </Table.Tbody>
      </Table>
    </Stack>
  )
}

function GrantsTable() {
  const [rows, setRows] = React.useState<AdminReferralGrantRowDto[] | null>(null)
  const [loading, setLoading] = React.useState(false)
  React.useEffect(() => {
    setLoading(true)
    adminListReferralGrants({ limit: 200 })
      .then((r) => setRows(r.items))
      .catch((err) => console.warn('[referral admin] grants load failed', err))
      .finally(() => setLoading(false))
  }, [])
  return (
    <Stack gap="sm">
      {loading ? <Loader size="xs" /> : null}
      <Table striped withTableBorder withColumnBorders highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>时间</Table.Th>
            <Table.Th>邀请人</Table.Th>
            <Table.Th>被邀请人</Table.Th>
            <Table.Th>类型</Table.Th>
            <Table.Th ta="right">积分</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows && rows.length > 0 ? rows.map((g) => (
            <Table.Tr key={g.id}>
              <Table.Td>{formatTime(g.created_at)}</Table.Td>
              <Table.Td>{g.referrer_login || g.referrer_user_id.slice(0, 12)}</Table.Td>
              <Table.Td>{g.invitee_login || g.invitee_user_id.slice(0, 12)}</Table.Td>
              <Table.Td>注册欢迎奖励</Table.Td>
              <Table.Td ta="right">+{g.granted_credits}</Table.Td>
            </Table.Tr>
          )) : (
            <Table.Tr><Table.Td colSpan={5}><Text size="sm" c="dimmed" ta="center">暂无邀请奖励记录</Text></Table.Td></Table.Tr>
          )}
        </Table.Tbody>
      </Table>
    </Stack>
  )
}

export default function ReferralRecordsAdmin(): React.ReactElement {
  const [tab, setTab] = React.useState<string>('overview')
  return (
    <Stack gap="md">
      <Title order={4}>邀请记录</Title>
      <Tabs value={tab} onChange={(v) => setTab(v || 'overview')}>
        <Tabs.List>
          <Tabs.Tab value="overview">邀请人汇总</Tabs.Tab>
          <Tabs.Tab value="bindings">绑定关系</Tabs.Tab>
          <Tabs.Tab value="grants">奖励明细</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="overview" pt="md">{tab === 'overview' ? <OverviewTable /> : null}</Tabs.Panel>
        <Tabs.Panel value="bindings" pt="md">{tab === 'bindings' ? <BindingsTable /> : null}</Tabs.Panel>
        <Tabs.Panel value="grants" pt="md">{tab === 'grants' ? <GrantsTable /> : null}</Tabs.Panel>
      </Tabs>
    </Stack>
  )
}
