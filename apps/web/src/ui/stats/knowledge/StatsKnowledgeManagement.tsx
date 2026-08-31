import React from 'react'
import {
  Button,
  Group,
  Modal,
  MultiSelect,
  Pagination,
  ScrollArea,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Tooltip,
} from '@mantine/core'
import {
  IconDeviceFloppy,
  IconEye,
  IconFilterOff,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconSearch,
} from '@tabler/icons-react'
import {
  listAdminKnowledge,
  syncAdminKnowledge,
  upsertAdminKnowledge,
  type AdminKnowledgeCardDto,
  type AdminKnowledgeCardUpsertInput,
  type AdminKnowledgeListQuery,
  type AdminKnowledgeListResponseDto,
} from '../../../api/server'
import { IconActionButton } from '../../IconActionButton'
import { PanelCard } from '../../PanelCard'
import { StatePanel } from '../../StatePanel'
import { StatusBadge } from '../../StatusBadge'
import { toast } from '../../toast'
import './StatsKnowledgeManagement.css'

const ROLE_OPTIONS = [
  { value: 'director', label: '导演' },
  { value: 'storyboard', label: '分镜' },
  { value: 'generation', label: '生成' },
  { value: 'editor', label: '编辑' },
  { value: 'post', label: '后期' },
  { value: 'qa', label: '质检' },
] as const

type KnowledgeRole = AdminKnowledgeCardUpsertInput['roleScope'][number]

type KnowledgeEditorState = Omit<AdminKnowledgeCardUpsertInput, 'facet'> & {
  facet: string
  existing: boolean
  editable: boolean
}

const DEFAULT_PAGE_SIZE = 24

type KnowledgeQueryState = Required<Pick<AdminKnowledgeListQuery, 'collection' | 'page' | 'pageSize'>> & {
  query: string
  domain: string | null
  facet: string | null
  roleScope: KnowledgeRole | null
}

const INITIAL_QUERY: KnowledgeQueryState = {
  collection: 'all',
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  query: '',
  domain: null,
  facet: null,
  roleScope: null,
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

function splitList(value: string): string[] {
  return value
    .split('\n')
    .flatMap((line) => line.split(','))
    .map((item) => item.trim())
    .filter(Boolean)
}

function joinList(values: string[]): string {
  return values.join('\n')
}

function createEditor(card?: AdminKnowledgeCardDto): KnowledgeEditorState {
  return {
    id: card?.id ?? '',
    domain: card?.domain ?? '',
    facet: card?.facet ?? '',
    title: card?.title ?? '',
    roleScope: card?.roleScope ?? [],
    keywords: card?.keywords ?? [],
    sourceUrls: card?.sourceUrls ?? [],
    body: card?.body ?? '',
    existing: Boolean(card),
    editable: card?.editable ?? true,
  }
}

function parseEditor(editor: KnowledgeEditorState): AdminKnowledgeCardUpsertInput | null {
  const id = editor.id.trim()
  const domain = editor.domain.trim()
  const title = editor.title.trim()
  const body = editor.body.trim()
  if (!id || !domain || !title || !body) return null
  return {
    id,
    domain,
    facet: editor.facet.trim() || null,
    title,
    roleScope: editor.roleScope,
    keywords: editor.keywords,
    sourceUrls: editor.sourceUrls,
    body,
  }
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}

function formatRoles(roles: KnowledgeRole[]): string {
  return roles.length ? roles.join(' / ') : '通用'
}

export default function StatsKnowledgeManagement({ className }: { className?: string }): JSX.Element {
  const rootClassName = ['stats-knowledge-management', className].filter(Boolean).join(' ')
  const [result, setResult] = React.useState<AdminKnowledgeListResponseDto | null>(null)
  const [query, setQuery] = React.useState<KnowledgeQueryState>(INITIAL_QUERY)
  const [searchText, setSearchText] = React.useState('')
  const [loading, setLoading] = React.useState(true)
  const [loaded, setLoaded] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [syncing, setSyncing] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [editor, setEditor] = React.useState<KnowledgeEditorState | null>(null)
  const [editorError, setEditorError] = React.useState<string | null>(null)
  const requestRef = React.useRef(0)

  const load = React.useCallback(async (): Promise<void> => {
    const requestId = requestRef.current + 1
    requestRef.current = requestId
    setLoading(true)
    setError(null)
    try {
      const response = await listAdminKnowledge({
        collection: query.collection,
        page: query.page,
        pageSize: query.pageSize,
        ...(query.query ? { query: query.query } : {}),
        ...(query.domain ? { domain: query.domain } : {}),
        ...(query.facet ? { facet: query.facet } : {}),
        ...(query.roleScope ? { roleScope: query.roleScope } : {}),
      })
      if (requestRef.current !== requestId) return
      setResult(response)
      setLoaded(true)
    } catch (reason: unknown) {
      if (requestRef.current !== requestId) return
      setError(errorMessage(reason, '知识库加载失败'))
    } finally {
      if (requestRef.current === requestId) setLoading(false)
    }
  }, [query])

  React.useEffect(() => {
    void load()
    return () => { requestRef.current += 1 }
  }, [load])

  React.useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const normalized = searchText.trim()
      setQuery((current) => current.query === normalized
        ? current
        : { ...current, query: normalized, page: 1 })
    }, 260)
    return () => window.clearTimeout(timeoutId)
  }, [searchText])

  const closeEditor = React.useCallback(() => {
    if (saving) return
    setEditor(null)
    setEditorError(null)
  }, [saving])

  const save = React.useCallback(async (): Promise<void> => {
    if (!editor || saving || !editor.editable) return
    const payload = parseEditor(editor)
    if (!payload) {
      setEditorError('id、领域、标题和正文不能为空。')
      return
    }
    setSaving(true)
    setEditorError(null)
    try {
      const result = await upsertAdminKnowledge(payload)
      setEditor(null)
      toast(`知识卡已保存并同步向量（${result.sync.embeddingModel}）`, 'success')
      await load()
    } catch (reason: unknown) {
      const message = errorMessage(reason, '知识卡保存或向量同步失败')
      setEditorError(message)
      toast(message, 'error')
    } finally {
      setSaving(false)
    }
  }, [editor, load, saving])

  const syncAll = React.useCallback(async (): Promise<void> => {
    if (syncing) return
    setSyncing(true)
    setError(null)
    try {
      const result = await syncAdminKnowledge()
      toast(`已重新同步 ${result.indexedCards} 张内置知识卡（${result.embeddingModel}）`, 'success')
      await load()
    } catch (reason: unknown) {
      const message = errorMessage(reason, '知识库同步失败')
      setError(message)
      toast(message, 'error')
    } finally {
      setSyncing(false)
    }
  }, [load, syncing])

  const cards = result?.cards ?? []
  const embeddingModel = result?.embeddingModel ?? ''
  const pagination = result?.pagination
  const collections = result?.filters.collections ?? []
  const totalIndexed = collections.reduce((total, collection) => total + collection.count, 0)
  const hasActiveFilters = query.collection !== 'all'
    || Boolean(query.query || query.domain || query.facet || query.roleScope)

  const updateQuery = React.useCallback((patch: Partial<KnowledgeQueryState>): void => {
    setQuery((current) => ({ ...current, ...patch, page: patch.page ?? 1 }))
  }, [])

  const resetFilters = React.useCallback((): void => {
    setSearchText('')
    setQuery((current) => ({ ...INITIAL_QUERY, pageSize: current.pageSize }))
  }, [])

  return (
    <Stack className={rootClassName} gap="md">
      <Group className="stats-knowledge-management__header" justify="space-between" align="flex-start" wrap="wrap">
        <Stack className="stats-knowledge-management__heading" gap={2}>
          <Text className="stats-knowledge-management__title" fw={700}>知识库管理</Text>
          <Text className="stats-knowledge-management__description" size="xs" c="dimmed">
            统一查询内置知识、图片提示词与视频提示词向量。内置知识可编辑；提示词案例只读，须从提示词库真源更新。
          </Text>
          {embeddingModel ? (
            <Text className="stats-knowledge-management__model" size="xs" c="dimmed">
              当前嵌入模型：{embeddingModel} · 共 {totalIndexed.toLocaleString('zh-CN')} 张已索引卡
            </Text>
          ) : null}
        </Stack>
        <Group className="stats-knowledge-management__actions" gap={6}>
          <Tooltip className="stats-knowledge-management__refresh-tooltip" label="重新读取知识库" withinPortal>
            <IconActionButton
              className="stats-knowledge-management__refresh"
              aria-label="重新读取知识库"
              loading={loading}
              icon={<IconRefresh className="stats-knowledge-management__refresh-icon" size={16} />}
              onClick={() => void load()}
            />
          </Tooltip>
          <Button
            className="stats-knowledge-management__sync-all"
            size="xs"
            variant="light"
            leftSection={<IconRefresh className="stats-knowledge-management__sync-all-icon" size={14} />}
            loading={syncing}
            onClick={() => void syncAll()}
          >
            同步内置知识
          </Button>
          <Tooltip className="stats-knowledge-management__create-tooltip" label="新建知识卡" withinPortal>
            <IconActionButton
              className="stats-knowledge-management__create"
              aria-label="新建知识卡"
              icon={<IconPlus className="stats-knowledge-management__create-icon" size={16} />}
              onClick={() => { setEditor(createEditor()); setEditorError(null) }}
            />
          </Tooltip>
        </Group>
      </Group>

      <Group className="stats-knowledge-management__filters" gap="xs" align="flex-end" wrap="wrap">
        <TextInput
          className="stats-knowledge-management__search"
          aria-label="搜索知识卡"
          placeholder="搜索标题、ID、正文、关键词或来源…"
          leftSection={<IconSearch className="stats-knowledge-management__search-icon" size={15} />}
          value={searchText}
          onChange={(event) => setSearchText(event.currentTarget.value)}
        />
        <Select
          className="stats-knowledge-management__collection-filter"
          aria-label="按知识来源筛选"
          value={query.collection}
          data={[
            { value: 'all', label: `全部来源 · ${totalIndexed.toLocaleString('zh-CN')}` },
            ...collections.map((collection) => ({
              value: collection.id,
              label: `${collection.label} · ${collection.count.toLocaleString('zh-CN')}`,
            })),
          ]}
          onChange={(value) => updateQuery({
            collection: value ?? 'all',
            domain: null,
            facet: null,
          })}
        />
        <Select
          className="stats-knowledge-management__domain-filter"
          aria-label="按领域筛选"
          placeholder="全部领域"
          searchable
          clearable
          value={query.domain}
          data={(result?.filters.domains ?? []).map((domain) => ({ value: domain, label: domain }))}
          onChange={(value) => updateQuery({ domain: value })}
        />
        <Select
          className="stats-knowledge-management__facet-filter"
          aria-label="按 Facet 筛选"
          placeholder="全部 Facet"
          searchable
          clearable
          value={query.facet}
          data={(result?.filters.facets ?? []).map((facet) => ({ value: facet, label: facet }))}
          onChange={(value) => updateQuery({ facet: value })}
        />
        <Select
          className="stats-knowledge-management__role-filter"
          aria-label="按角色筛选"
          placeholder="全部角色"
          clearable
          value={query.roleScope}
          data={ROLE_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
          onChange={(value) => updateQuery({ roleScope: value as KnowledgeRole | null })}
        />
        <Tooltip className="stats-knowledge-management__reset-tooltip" label="清除筛选" withinPortal>
          <IconActionButton
            className="stats-knowledge-management__reset"
            aria-label="清除知识库筛选"
            disabled={!hasActiveFilters}
            icon={<IconFilterOff className="stats-knowledge-management__reset-icon" size={16} />}
            onClick={resetFilters}
          />
        </Tooltip>
      </Group>

      {error ? (
        <StatePanel
          className="stats-knowledge-management__error"
          title={loaded ? '刷新或同步失败，以下仍是上次成功读取的数据' : '知识库加载失败'}
          description={error}
          tone="error"
        />
      ) : null}

      {loading && !loaded ? (
        <StatePanel className="stats-knowledge-management__loading" title="正在读取知识库…" tone="loading" />
      ) : cards.length === 0 ? (
        <StatePanel
          className="stats-knowledge-management__empty"
          title={hasActiveFilters ? '没有符合条件的知识卡' : '暂无已索引知识卡'}
          description={hasActiveFilters
            ? '调整来源或筛选条件后重试。'
            : '点击右上角新建知识卡；保存后会先完成嵌入并写入向量库。'}
        />
      ) : (
        <PanelCard className="stats-knowledge-management__list" padding="compact">
          <ScrollArea className="stats-knowledge-management__scroll" type="auto">
            <Table className="stats-knowledge-management__table" verticalSpacing="xs" horizontalSpacing="sm">
              <Table.Thead className="stats-knowledge-management__table-head">
                <Table.Tr className="stats-knowledge-management__header-row">
                  <Table.Th className="stats-knowledge-management__header-cell">知识卡</Table.Th>
                  <Table.Th className="stats-knowledge-management__header-cell">来源</Table.Th>
                  <Table.Th className="stats-knowledge-management__header-cell">领域 / Facet</Table.Th>
                  <Table.Th className="stats-knowledge-management__header-cell">角色</Table.Th>
                  <Table.Th className="stats-knowledge-management__header-cell">内容</Table.Th>
                  <Table.Th className="stats-knowledge-management__header-cell">更新时间</Table.Th>
                  <Table.Th className="stats-knowledge-management__header-cell stats-knowledge-management__header-cell--actions">操作</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody className="stats-knowledge-management__table-body">
                {cards.map((card) => (
                  <Table.Tr className="stats-knowledge-management__row" key={`${card.sourceRoot}:${card.id}`}>
                    <Table.Td className="stats-knowledge-management__cell stats-knowledge-management__cell--identity">
                      <Stack className="stats-knowledge-management__identity" gap={1}>
                        <Text className="stats-knowledge-management__card-title" size="sm" fw={600}>{card.title}</Text>
                        <Text className="stats-knowledge-management__card-id" size="xs" c="dimmed">{card.id}</Text>
                      </Stack>
                    </Table.Td>
                    <Table.Td className="stats-knowledge-management__cell stats-knowledge-management__cell--collection">
                      <StatusBadge className="stats-knowledge-management__collection-badge" tone="neutral">
                        {card.collectionLabel}
                      </StatusBadge>
                    </Table.Td>
                    <Table.Td className="stats-knowledge-management__cell">
                      <Stack className="stats-knowledge-management__domain" gap={1}>
                        <StatusBadge className="stats-knowledge-management__domain-badge" tone="neutral">{card.domain}</StatusBadge>
                        {card.facet ? <Text className="stats-knowledge-management__facet" size="xs" c="dimmed">{card.facet}</Text> : null}
                      </Stack>
                    </Table.Td>
                    <Table.Td className="stats-knowledge-management__cell">
                      <Text className="stats-knowledge-management__roles" size="xs" c="dimmed">{formatRoles(card.roleScope)}</Text>
                    </Table.Td>
                    <Table.Td className="stats-knowledge-management__cell">
                      <Text className="stats-knowledge-management__body-size" size="xs" c="dimmed">
                        {card.body.length.toLocaleString('zh-CN')} 字符 · {card.keywords.length} 关键词
                      </Text>
                    </Table.Td>
                    <Table.Td className="stats-knowledge-management__cell">
                      <Text className="stats-knowledge-management__updated-at" size="xs" c="dimmed">{formatUpdatedAt(card.updatedAt)}</Text>
                    </Table.Td>
                    <Table.Td className="stats-knowledge-management__cell stats-knowledge-management__cell--actions">
                      <Group className="stats-knowledge-management__row-actions" gap={2} justify="flex-end" wrap="nowrap">
                        {card.editable ? (
                          <Tooltip className="stats-knowledge-management__edit-tooltip" label="编辑知识卡" withinPortal>
                            <IconActionButton
                              className="stats-knowledge-management__edit"
                              aria-label={`编辑 ${card.title}`}
                              icon={<IconPencil className="stats-knowledge-management__edit-icon" size={15} />}
                              onClick={() => { setEditor(createEditor(card)); setEditorError(null) }}
                            />
                          </Tooltip>
                        ) : (
                          <Tooltip className="stats-knowledge-management__view-tooltip" label="查看只读案例" withinPortal>
                            <IconActionButton
                              className="stats-knowledge-management__view"
                              aria-label={`查看 ${card.title}`}
                              icon={<IconEye className="stats-knowledge-management__view-icon" size={15} />}
                              onClick={() => { setEditor(createEditor(card)); setEditorError(null) }}
                            />
                          </Tooltip>
                        )}
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
          {pagination ? (
            <Group className="stats-knowledge-management__pagination" justify="space-between" gap="sm" wrap="wrap">
              <Text className="stats-knowledge-management__pagination-summary" size="xs" c="dimmed">
                共 {pagination.total.toLocaleString('zh-CN')} 条 · 第 {pagination.page} / {Math.max(pagination.totalPages, 1)} 页
              </Text>
              <Group className="stats-knowledge-management__pagination-actions" gap="xs" wrap="nowrap">
                <Select
                  className="stats-knowledge-management__page-size"
                  aria-label="每页知识卡数量"
                  value={String(query.pageSize)}
                  data={[
                    { value: '24', label: '24 条/页' },
                    { value: '50', label: '50 条/页' },
                    { value: '100', label: '100 条/页' },
                  ]}
                  allowDeselect={false}
                  onChange={(value) => updateQuery({ pageSize: Number(value ?? DEFAULT_PAGE_SIZE) })}
                />
                <Pagination
                  className="stats-knowledge-management__pages"
                  value={pagination.page}
                  total={Math.max(pagination.totalPages, 1)}
                  size="sm"
                  siblings={1}
                  boundaries={1}
                  onChange={(page) => updateQuery({ page })}
                />
              </Group>
            </Group>
          ) : null}
        </PanelCard>
      )}

      <Modal
        className="stats-knowledge-management__editor-modal"
        opened={editor !== null}
        onClose={closeEditor}
        title={editor?.existing ? editor.editable ? '编辑知识卡' : '查看提示词案例' : '新建知识卡'}
        centered
        size="xl"
        closeOnClickOutside={!saving}
        closeOnEscape={!saving}
      >
        {editor ? (
          <Stack className="stats-knowledge-management__editor" gap="sm">
            {editorError ? <StatePanel className="stats-knowledge-management__editor-error" title="无法保存" description={editorError} tone="error" /> : null}
            <Group className="stats-knowledge-management__editor-row" grow align="flex-start">
              <TextInput
                className="stats-knowledge-management__id-input"
                label="ID"
                description={editor.existing ? '已有知识卡的 ID 不允许修改' : '必填；仅用于稳定识别这张知识卡'}
                value={editor.id}
                disabled={editor.existing}
                onChange={(event) => setEditor({ ...editor, id: event.currentTarget.value })}
                required
              />
              <TextInput
                className="stats-knowledge-management__domain-input"
                label="领域"
                value={editor.domain}
                readOnly={!editor.editable}
                onChange={(event) => setEditor({ ...editor, domain: event.currentTarget.value })}
                required
              />
            </Group>
            <Group className="stats-knowledge-management__editor-row" grow align="flex-start">
              <TextInput
                className="stats-knowledge-management__title-input"
                label="标题"
                value={editor.title}
                readOnly={!editor.editable}
                onChange={(event) => setEditor({ ...editor, title: event.currentTarget.value })}
                required
              />
              <TextInput
                className="stats-knowledge-management__facet-input"
                label="Facet"
                value={editor.facet}
                readOnly={!editor.editable}
                onChange={(event) => setEditor({ ...editor, facet: event.currentTarget.value })}
              />
            </Group>
            <MultiSelect
              className="stats-knowledge-management__role-input"
              label="角色范围"
              description="留空表示通用知识卡"
              data={ROLE_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
              value={editor.roleScope}
              disabled={!editor.editable}
              onChange={(value) => setEditor({ ...editor, roleScope: value as KnowledgeRole[] })}
              clearable
              searchable
            />
            <Textarea
              className="stats-knowledge-management__keywords-input"
              label="关键词"
              description="每行一个，也可以使用逗号分隔"
              autosize
              minRows={2}
              maxRows={5}
              value={joinList(editor.keywords)}
              readOnly={!editor.editable}
              onChange={(event) => setEditor({ ...editor, keywords: splitList(event.currentTarget.value) })}
            />
            <Textarea
              className="stats-knowledge-management__source-urls-input"
              label="来源 URL"
              description="每行一个；用于保留知识来源，不会替代正文"
              autosize
              minRows={2}
              maxRows={5}
              value={joinList(editor.sourceUrls)}
              readOnly={!editor.editable}
              onChange={(event) => setEditor({ ...editor, sourceUrls: splitList(event.currentTarget.value) })}
            />
            <Textarea
              className="stats-knowledge-management__body-input"
              label="正文"
              description="保存后会重新生成这张卡的向量；正文是运行时被 knowledge_read 读取的内容"
              autosize
              minRows={14}
              maxRows={30}
              value={editor.body}
              readOnly={!editor.editable}
              onChange={(event) => setEditor({ ...editor, body: event.currentTarget.value })}
              required
            />
            <Group className="stats-knowledge-management__editor-actions" justify="flex-end" gap="xs">
              <Button className="stats-knowledge-management__cancel" variant="subtle" onClick={closeEditor} disabled={saving}>
                {editor.editable ? '取消' : '关闭'}
              </Button>
              {editor.editable ? (
                <Button
                  className="stats-knowledge-management__save"
                  leftSection={<IconDeviceFloppy className="stats-knowledge-management__save-icon" size={15} />}
                  loading={saving}
                  onClick={() => void save()}
                >
                  保存并同步
                </Button>
              ) : null}
            </Group>
          </Stack>
        ) : null}
      </Modal>
    </Stack>
  )
}
