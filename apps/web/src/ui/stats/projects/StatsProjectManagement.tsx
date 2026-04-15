import React from 'react'
import { ActionIcon, Badge, Button, Divider, Group, Image, Loader, Modal, Select, Stack, Switch, Table, Text, TextInput, Textarea, Tooltip, Title } from '@mantine/core'
import { IconCopy, IconExternalLink, IconPencil, IconRefresh, IconSearch, IconTrash } from '@tabler/icons-react'
import { deleteAdminProject, listAdminProjects, updateAdminProject, type AdminProjectDto } from '../../../api/server'
import { PanelCard } from '../../PanelCard'
import { toast } from '../../toast'

type PublicFilter = 'all' | 'public' | 'private'

function formatTime(value?: string | null): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return '—'
  const t = Date.parse(raw)
  if (!Number.isFinite(t)) return raw
  return new Date(t).toLocaleString()
}

function normalizeQuery(value: string): string {
  return String(value || '').trim().slice(0, 128)
}

function buildShareUrl(projectId: string): string {
  const pid = encodeURIComponent(projectId)
  if (typeof window === 'undefined') return `/share/${pid}`
  try {
    const url = new URL(window.location.href)
    url.search = ''
    url.hash = ''
    url.pathname = `/share/${pid}`
    return url.toString()
  } catch {
    return `/share/${pid}`
  }
}

export default function StatsProjectManagement({ className }: { className?: string }): JSX.Element {
  const rootClassName = ['stats-projects', className].filter(Boolean).join(' ')

  const [q, setQ] = React.useState('')
  const [publicFilter, setPublicFilter] = React.useState<PublicFilter>('public')
  const [loading, setLoading] = React.useState(false)
  const [items, setItems] = React.useState<AdminProjectDto[]>([])
  const [updatingIds, setUpdatingIds] = React.useState(() => new Set<string>())

  const [editOpen, setEditOpen] = React.useState(false)
  const [editId, setEditId] = React.useState<string | null>(null)
  const [editName, setEditName] = React.useState('')
  const [editTemplateTitle, setEditTemplateTitle] = React.useState('')
  const [editTemplateDescription, setEditTemplateDescription] = React.useState('')
  const [editTemplateCoverUrl, setEditTemplateCoverUrl] = React.useState('')
  const [editSubmitting, setEditSubmitting] = React.useState(false)

  const markUpdating = (projectId: string, next: boolean) => {
    setUpdatingIds((prev) => {
      const copy = new Set(prev)
      if (next) copy.add(projectId); else copy.delete(projectId)
      return copy
    })
  }

  const desiredIsPublic = React.useMemo(() => {
    if (publicFilter === 'public') return true
    if (publicFilter === 'private') return false
    return undefined
  }, [publicFilter])

  const reload = React.useCallback(async () => {
    setLoading(true)
    try {
      const next = await listAdminProjects({ q: normalizeQuery(q), isPublic: desiredIsPublic, limit: 500 })
      setItems(Array.isArray(next) ? next : [])
    } catch (err: unknown) {
      console.error('list admin projects failed', err)
      setItems([])
      toast(err instanceof Error && err.message ? err.message : '加载项目列表失败', 'error')
    } finally {
      setLoading(false)
    }
  }, [desiredIsPublic, q])

  React.useEffect(() => {
    void reload()
  }, [reload])

  const onTogglePublic = async (p: AdminProjectDto) => {
    if (!p?.id) return
    if (updatingIds.has(p.id)) return
    const nextPublic = !p.isPublic
    if (!window.confirm(nextPublic ? `确定公开项目「${p.name}」？` : `确定取消公开项目「${p.name}」？`)) return
    markUpdating(p.id, true)
    try {
      const updated = await updateAdminProject(p.id, { isPublic: nextPublic })
      setItems((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
      toast('已保存', 'success')
    } catch (err: unknown) {
      console.error('toggle project public failed', err)
      toast(err instanceof Error && err.message ? err.message : '更新失败', 'error')
    } finally {
      markUpdating(p.id, false)
    }
  }

  const openEdit = (p: AdminProjectDto) => {
    setEditId(p.id)
    setEditName(p.name || '')
    setEditTemplateTitle(String(p.templateTitle || p.name || ''))
    setEditTemplateDescription(String(p.templateDescription || ''))
    setEditTemplateCoverUrl(String(p.templateCoverUrl || ''))
    setEditOpen(true)
  }

  const submitEdit = async () => {
    const projectId = editId
    if (!projectId) return
    if (editSubmitting) return
    const name = editName.trim()
    if (!name) {
      toast('请输入项目名称', 'error')
      return
    }
    const templateTitle = editTemplateTitle.trim()
    if (!templateTitle) {
      toast('请输入模板标题', 'error')
      return
    }
    setEditSubmitting(true)
    try {
      const updated = await updateAdminProject(projectId, {
        name,
        templateTitle,
        templateDescription: editTemplateDescription.trim(),
        templateCoverUrl: editTemplateCoverUrl.trim(),
      })
      setItems((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
      setEditOpen(false)
      toast('已保存', 'success')
    } catch (err: unknown) {
      console.error('rename project failed', err)
      toast(err instanceof Error && err.message ? err.message : '更新失败', 'error')
    } finally {
      setEditSubmitting(false)
    }
  }

  const onDeleteProject = async (p: AdminProjectDto) => {
    if (!p?.id) return
    if (updatingIds.has(p.id)) return
    if (!window.confirm(`确定删除项目「${p.name}」？删除后该项目下的 flows / versions 也会被删除（不可恢复）。`)) return
    markUpdating(p.id, true)
    try {
      await deleteAdminProject(p.id)
      toast('已删除', 'success')
      await reload()
    } catch (err: unknown) {
      console.error('delete project failed', err)
      toast(err instanceof Error && err.message ? err.message : '删除失败', 'error')
    } finally {
      markUpdating(p.id, false)
    }
  }

  const onOpenShare = (p: AdminProjectDto) => {
    if (!p?.id) return
    if (!p.isPublic) {
      toast('该项目未公开，无法打开分享页', 'error')
      return
    }
    const url = buildShareUrl(p.id)
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const onCopyShareLink = async (p: AdminProjectDto) => {
    if (!p?.id) return
    if (!p.isPublic) {
      toast('该项目未公开，无法生成分享链接', 'error')
      return
    }
    const url = buildShareUrl(p.id)
    try {
      await navigator.clipboard.writeText(url)
      toast('已复制分享链接', 'success')
    } catch (err) {
      console.error(err)
      toast('复制失败，请手动复制地址栏链接', 'error')
    }
  }

  return (
    <PanelCard className={rootClassName}>
      <Group className="stats-projects-header" justify="space-between" align="center">
        <Stack className="stats-projects-header-left" gap={2}>
          <Title className="stats-projects-title" order={4}>公共模板管理</Title>
          <Text className="stats-projects-subtitle" size="xs" c="dimmed">统一增删改查公共模板（基于公开项目）</Text>
        </Stack>
        <Group className="stats-projects-header-right" gap={8} align="center" wrap="wrap" justify="flex-end">
          <TextInput
            className="stats-projects-search"
            value={q}
            onChange={(e) => setQ(e.currentTarget.value)}
            placeholder="搜索模板名 / owner / projectId"
            leftSection={<IconSearch className="stats-projects-search-icon" size={14} />}
            w={260}
          />
          <Select
            className="stats-projects-public-filter"
            value={publicFilter}
            onChange={(value) => setPublicFilter(value === 'public' || value === 'private' ? value : 'all')}
            data={[
              { value: 'all', label: '全部' },
              { value: 'public', label: '仅公开' },
              { value: 'private', label: '仅私有' },
            ]}
            w={120}
          />
          <Tooltip className="stats-projects-refresh-tooltip" label="刷新" withArrow>
            <ActionIcon className="stats-projects-refresh" size="sm" variant="subtle" aria-label="刷新" onClick={() => void reload()} loading={loading}>
              <IconRefresh className="stats-projects-refresh-icon" size={14} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      <Divider className="stats-projects-divider" my="sm" />

      {loading ? (
        <Group className="stats-projects-loading" justify="center" py="xl">
          <Loader className="stats-projects-loading-icon" size="sm" />
          <Text className="stats-projects-loading-text" size="sm" c="dimmed">加载中…</Text>
        </Group>
      ) : (
        <Stack className="stats-projects-body" gap="sm">
          <Group className="stats-projects-meta" justify="space-between" align="center">
            <Text className="stats-projects-count" size="xs" c="dimmed">共 {items.length} 个模板</Text>
            <Button className="stats-projects-reload" size="xs" variant="light" onClick={() => void reload()}>重新加载</Button>
          </Group>

          <div className="stats-projects-table-wrap" style={{ overflowX: 'auto' }}>
            <Table className="stats-projects-table" striped highlightOnHover withTableBorder withColumnBorders>
              <Table.Thead className="stats-projects-table-head">
                <Table.Tr className="stats-projects-table-head-row">
                  <Table.Th className="stats-projects-table-head-cell" style={{ width: 260 }}>模板</Table.Th>
                  <Table.Th className="stats-projects-table-head-cell" style={{ width: 220 }}>Owner</Table.Th>
                  <Table.Th className="stats-projects-table-head-cell" style={{ width: 120 }}>公开</Table.Th>
                  <Table.Th className="stats-projects-table-head-cell" style={{ width: 90 }}>Flows</Table.Th>
                  <Table.Th className="stats-projects-table-head-cell" style={{ width: 190 }}>更新时间</Table.Th>
                  <Table.Th className="stats-projects-table-head-cell" style={{ width: 190 }}>创建时间</Table.Th>
                  <Table.Th className="stats-projects-table-head-cell" style={{ width: 220 }}>ID</Table.Th>
                  <Table.Th className="stats-projects-table-head-cell" style={{ width: 140 }}>操作</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody className="stats-projects-table-body">
                {items.length === 0 ? (
                  <Table.Tr className="stats-projects-table-row-empty">
                    <Table.Td className="stats-projects-table-cell-empty" colSpan={8}>
                      <Text className="stats-projects-empty" size="sm" c="dimmed">暂无公共模板</Text>
                    </Table.Td>
                  </Table.Tr>
                ) : (
                  items.map((p) => {
                    const busy = updatingIds.has(p.id)
                    const ownerLabel = String((p.owner || '').trim() || (p.ownerId || '').trim() || '—')
                    const ownerName = String((p.ownerName || '').trim() || '')
                    return (
                      <Table.Tr className="stats-projects-table-row" key={p.id}>
                        <Table.Td className="stats-projects-table-cell">
                          <Stack className="stats-projects-project" gap={2}>
                            <Group className="stats-projects-project-row" gap={8} wrap="nowrap">
                              <Text className="stats-projects-project-name" size="sm" fw={600} lineClamp={1}>{p.templateTitle || p.name || '—'}</Text>
                              {p.isPublic && (<Badge className="stats-projects-project-public-badge" size="xs" variant="light" color="gray">public</Badge>)}
                            </Group>
                            {p.templateDescription ? (
                              <Text className="stats-projects-project-desc" size="xs" c="dimmed" lineClamp={2}>
                                {p.templateDescription}
                              </Text>
                            ) : null}
                          </Stack>
                        </Table.Td>
                        <Table.Td className="stats-projects-table-cell">
                          <Stack className="stats-projects-owner" gap={0}>
                            <Text className="stats-projects-owner-login" size="sm">{ownerLabel}</Text>
                            <Text className="stats-projects-owner-name" size="xs" c="dimmed">{ownerName || '—'}</Text>
                          </Stack>
                        </Table.Td>
                        <Table.Td className="stats-projects-table-cell">
                          <Switch
                            className="stats-projects-public-switch"
                            size="xs"
                            checked={p.isPublic}
                            onChange={() => void onTogglePublic(p)}
                            disabled={busy}
                            label={p.isPublic ? '公开' : '私有'}
                          />
                        </Table.Td>
                        <Table.Td className="stats-projects-table-cell">
                          <Text className="stats-projects-flows" size="sm">{Number(p.flowCount ?? 0) || 0}</Text>
                        </Table.Td>
                        <Table.Td className="stats-projects-table-cell">
                          <Text className="stats-projects-updated" size="sm" c="dimmed">{formatTime(p.updatedAt)}</Text>
                        </Table.Td>
                        <Table.Td className="stats-projects-table-cell">
                          <Text className="stats-projects-created" size="sm" c="dimmed">{formatTime(p.createdAt)}</Text>
                        </Table.Td>
                        <Table.Td className="stats-projects-table-cell">
                          <Text className="stats-projects-id" size="xs" c="dimmed">{p.id}</Text>
                        </Table.Td>
                        <Table.Td className="stats-projects-table-cell">
                          <Group className="stats-projects-actions" gap={6} justify="flex-end" wrap="nowrap">
                            <Tooltip className="stats-projects-action-tooltip" label="打开分享页" withArrow>
                              <ActionIcon className="stats-projects-action" size="sm" variant="subtle" aria-label="打开分享页" onClick={() => onOpenShare(p)} disabled={!p.isPublic}>
                                <IconExternalLink className="stats-projects-action-icon" size={14} />
                              </ActionIcon>
                            </Tooltip>
                            <Tooltip className="stats-projects-action-tooltip" label="复制分享链接" withArrow>
                              <ActionIcon className="stats-projects-action" size="sm" variant="subtle" aria-label="复制分享链接" onClick={() => void onCopyShareLink(p)} disabled={!p.isPublic}>
                                <IconCopy className="stats-projects-action-icon" size={14} />
                              </ActionIcon>
                            </Tooltip>
                            <Tooltip className="stats-projects-action-tooltip" label="重命名" withArrow>
                              <ActionIcon className="stats-projects-action" size="sm" variant="subtle" aria-label="重命名" onClick={() => openEdit(p)} disabled={busy}>
                                <IconPencil className="stats-projects-action-icon" size={14} />
                              </ActionIcon>
                            </Tooltip>
                            <Tooltip className="stats-projects-action-tooltip" label="删除" withArrow>
                              <ActionIcon className="stats-projects-action stats-projects-action-delete" size="sm" variant="subtle" color="red" aria-label="删除" onClick={() => void onDeleteProject(p)} disabled={busy} loading={busy}>
                                <IconTrash className="stats-projects-action-icon" size={14} />
                              </ActionIcon>
                            </Tooltip>
                          </Group>
                        </Table.Td>
                      </Table.Tr>
                    )
                  })
                )}
              </Table.Tbody>
            </Table>
          </div>
        </Stack>
      )}

      <Modal
        className="stats-projects-edit-modal"
        opened={editOpen}
        onClose={() => setEditOpen(false)}
        title="编辑公共模板"
        centered
        radius="md"
        lockScroll={false}
      >
        <Stack className="stats-projects-edit-modal-body" gap="sm">
          <TextInput
            className="stats-projects-edit-name"
            label="项目名称"
            placeholder="输入新的项目名称"
            value={editName}
            onChange={(e) => setEditName(e.currentTarget.value)}
            maxLength={200}
          />
          <TextInput
            className="stats-projects-edit-template-title"
            label="模板标题"
            placeholder="输入模板标题"
            value={editTemplateTitle}
            onChange={(e) => setEditTemplateTitle(e.currentTarget.value)}
            maxLength={200}
          />
          <Textarea
            className="stats-projects-edit-template-description"
            label="模板描述"
            placeholder="输入模板描述（可选）"
            value={editTemplateDescription}
            onChange={(e) => setEditTemplateDescription(e.currentTarget.value)}
            minRows={2}
            maxRows={4}
            maxLength={1000}
          />
          <TextInput
            className="stats-projects-edit-template-cover"
            label="模板封面 URL"
            placeholder="https://..."
            value={editTemplateCoverUrl}
            onChange={(e) => setEditTemplateCoverUrl(e.currentTarget.value)}
            maxLength={2000}
          />
          {editTemplateCoverUrl.trim() ? (
            <Image
              className="stats-projects-edit-template-cover-preview"
              src={editTemplateCoverUrl.trim()}
              alt={editTemplateTitle.trim() || '模板封面预览'}
              radius="md"
              h={140}
              fit="cover"
            />
          ) : null}
          <Group className="stats-projects-edit-actions" justify="flex-end" gap={8}>
            <Button className="stats-projects-edit-cancel" variant="subtle" onClick={() => setEditOpen(false)}>取消</Button>
            <Button className="stats-projects-edit-save" onClick={() => void submitEdit()} loading={editSubmitting}>保存</Button>
          </Group>
        </Stack>
      </Modal>
    </PanelCard>
  )
}
