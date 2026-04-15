import React from 'react'
import {
  ActionIcon,
  Button,
  Divider,
  Group,
  Image,
  Loader,
  Modal,
  Pagination,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Textarea,
  Tooltip,
} from '@mantine/core'
import { IconPencil, IconPlus, IconRefresh, IconSearch, IconTrash, IconUpload } from '@tabler/icons-react'
import { InlinePanel } from './InlinePanel'
import { PanelCard } from './PanelCard'
import {
  createAiCharacterLibraryCharacter,
  deleteAiCharacterLibraryCharacter,
  importAiCharacterLibraryJson,
  listAiCharacterLibraryCharacters,
  updateAiCharacterLibraryCharacter,
  type AiCharacterLibraryCharacterDto,
  type AiCharacterLibrarySyncStateDto,
  type AiCharacterLibraryUpsertPayload,
} from '../api/server'
import { toast } from './toast'

const PAGE_SIZE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '10', label: '10 / 页' },
  { value: '20', label: '20 / 页' },
  { value: '50', label: '50 / 页' },
]

type AiCharacterLibraryManagementPanelProps = {
  className?: string
  opened: boolean
  projectId?: string | null
  canEdit?: boolean
}

type CharacterEditorState = {
  id?: string
  name: string
  character_id: string
  group_number: string
  identity_hint: string
  gender: string
  age_group: string
  species: string
  era: string
  genre: string
  outfit: string
  distinctive_features: string
  filter_worldview: string
  filter_theme: string
  filter_scene: string
  full_body_image_url: string
  three_view_image_url: string
  expression_image_url: string
  closeup_image_url: string
}

function formatTime(value?: string | null): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return '—'
  const ts = Date.parse(raw)
  if (!Number.isFinite(ts)) return raw
  return new Date(ts).toLocaleString()
}

function normalizeEditorValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function buildEditorState(character?: AiCharacterLibraryCharacterDto | null): CharacterEditorState {
  return {
    ...(character?.id ? { id: character.id } : {}),
    name: normalizeEditorValue(character?.name),
    character_id: normalizeEditorValue(character?.character_id),
    group_number: normalizeEditorValue(character?.group_number),
    identity_hint: normalizeEditorValue(character?.identity_hint),
    gender: normalizeEditorValue(character?.gender),
    age_group: normalizeEditorValue(character?.age_group),
    species: normalizeEditorValue(character?.species),
    era: normalizeEditorValue(character?.era),
    genre: normalizeEditorValue(character?.genre),
    outfit: normalizeEditorValue(character?.outfit),
    distinctive_features: normalizeEditorValue(character?.distinctive_features),
    filter_worldview: normalizeEditorValue(character?.filter_worldview),
    filter_theme: normalizeEditorValue(character?.filter_theme),
    filter_scene: normalizeEditorValue(character?.filter_scene),
    full_body_image_url: normalizeEditorValue(character?.full_body_image_url),
    three_view_image_url: normalizeEditorValue(character?.three_view_image_url),
    expression_image_url: normalizeEditorValue(character?.expression_image_url),
    closeup_image_url: normalizeEditorValue(character?.closeup_image_url),
  }
}

function buildUpsertPayload(editor: CharacterEditorState, projectId?: string | null): AiCharacterLibraryUpsertPayload {
  return {
    ...(projectId ? { projectId } : {}),
    name: editor.name,
    character_id: editor.character_id,
    group_number: editor.group_number,
    identity_hint: editor.identity_hint,
    gender: editor.gender,
    age_group: editor.age_group,
    species: editor.species,
    era: editor.era,
    genre: editor.genre,
    outfit: editor.outfit,
    distinctive_features: editor.distinctive_features,
    filter_worldview: editor.filter_worldview,
    filter_theme: editor.filter_theme,
    filter_scene: editor.filter_scene,
    full_body_image_url: editor.full_body_image_url,
    three_view_image_url: editor.three_view_image_url,
    expression_image_url: editor.expression_image_url,
    closeup_image_url: editor.closeup_image_url,
  }
}

function normalizeImportCharacter(raw: unknown): AiCharacterLibraryUpsertPayload {
  if (!raw || typeof raw !== 'object') {
    throw new Error('JSON 导入数组中的每一项都必须是对象')
  }
  const item = raw as Record<string, unknown>
  return {
    name: normalizeEditorValue(item.name),
    character_id: normalizeEditorValue(item.character_id),
    group_number: normalizeEditorValue(item.group_number),
    identity_hint: normalizeEditorValue(item.identity_hint),
    gender: normalizeEditorValue(item.gender),
    age_group: normalizeEditorValue(item.age_group),
    species: normalizeEditorValue(item.species),
    era: normalizeEditorValue(item.era),
    genre: normalizeEditorValue(item.genre),
    outfit: normalizeEditorValue(item.outfit),
    distinctive_features: normalizeEditorValue(item.distinctive_features),
    filter_worldview: normalizeEditorValue(item.filter_worldview),
    filter_theme: normalizeEditorValue(item.filter_theme),
    filter_scene: normalizeEditorValue(item.filter_scene),
    full_body_image_url: normalizeEditorValue(item.full_body_image_url),
    three_view_image_url: normalizeEditorValue(item.three_view_image_url),
    expression_image_url: normalizeEditorValue(item.expression_image_url),
    closeup_image_url: normalizeEditorValue(item.closeup_image_url),
  }
}

function stripJsonCodeFence(text: string): string {
  const raw = String(text || '').trim()
  const match = raw.match(/^```(?:json|javascript|js)?\s*([\s\S]*?)\s*```$/i)
  return match?.[1] ? match[1].trim() : raw
}

function extractImportItems(input: unknown): unknown[] | null {
  if (Array.isArray(input)) return input
  if (!input || typeof input !== 'object') return null
  const record = input as Record<string, unknown>
  if (Array.isArray(record.characters)) return record.characters
  const nestedKeys = ['code', 'content', 'payload', 'data', 'body', 'json']
  for (const key of nestedKeys) {
    const nested = record[key]
    if (typeof nested === 'string') {
      const parsed = safeParseImportJson(nested)
      const next = extractImportItems(parsed)
      if (next?.length) return next
      continue
    }
    const next = extractImportItems(nested)
    if (next?.length) return next
  }
  return null
}

function safeParseImportJson(text: string): unknown {
  return JSON.parse(stripJsonCodeFence(text))
}

function parseImportJsonText(text: string): AiCharacterLibraryUpsertPayload[] {
  const rawText = String(text || '').trim()
  if (!rawText) throw new Error('请先填写 JSON')
  let parsed: unknown
  try {
    parsed = safeParseImportJson(rawText)
  } catch {
    throw new Error('JSON 格式错误')
  }
  const items = extractImportItems(parsed)
  if (!items || !items.length) {
    throw new Error('JSON 必须是数组、{ "characters": [...] }，或包在 code/content/payload 中的 JSON / ```json code``` 文本')
  }
  return items.map(normalizeImportCharacter)
}

function pickPreviewUrl(character: AiCharacterLibraryCharacterDto): string {
  return (
    normalizeEditorValue(character.full_body_image_url) ||
    normalizeEditorValue(character.three_view_image_url) ||
    normalizeEditorValue(character.expression_image_url) ||
    normalizeEditorValue(character.closeup_image_url)
  )
}

function buildCharacterMeta(character: AiCharacterLibraryCharacterDto): string {
  return [
    normalizeEditorValue(character.identity_hint),
    normalizeEditorValue(character.gender),
    normalizeEditorValue(character.age_group),
    normalizeEditorValue(character.species),
    normalizeEditorValue(character.genre),
  ].filter(Boolean).join(' / ')
}

export default function AiCharacterLibraryManagementPanel(props: AiCharacterLibraryManagementPanelProps): JSX.Element {
  const { className, opened, projectId, canEdit = false } = props
  const rootClassName = ['ai-character-library-management', className].filter(Boolean).join(' ')
  const importFileInputRef = React.useRef<HTMLInputElement | null>(null)

  const [search, setSearch] = React.useState('')
  const [currentProjectOnly, setCurrentProjectOnly] = React.useState(Boolean(projectId))
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(10)
  const [loading, setLoading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [importing, setImporting] = React.useState(false)
  const [deletingId, setDeletingId] = React.useState('')
  const [items, setItems] = React.useState<AiCharacterLibraryCharacterDto[]>([])
  const [total, setTotal] = React.useState(0)
  const [syncState, setSyncState] = React.useState<AiCharacterLibrarySyncStateDto | null>(null)
  const [editor, setEditor] = React.useState<CharacterEditorState | null>(null)
  const [importText, setImportText] = React.useState('')

  const effectiveProjectId = currentProjectOnly ? (projectId || undefined) : undefined
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const reload = React.useCallback(async () => {
    if (!opened) return
    setLoading(true)
    try {
      const result = await listAiCharacterLibraryCharacters({
        q: search,
        page,
        pageSize,
        ...(effectiveProjectId ? { projectId: effectiveProjectId } : {}),
      })
      setItems(Array.isArray(result.characters) ? result.characters : [])
      setTotal(typeof result.total === 'number' && Number.isFinite(result.total) ? result.total : 0)
      setSyncState(result.syncState ?? null)
    } catch (err: unknown) {
      console.error('list ai character library failed', err)
      setItems([])
      setTotal(0)
      toast(err instanceof Error ? err.message : '加载角色库失败', 'error')
    } finally {
      setLoading(false)
    }
  }, [effectiveProjectId, opened, page, pageSize, search])

  React.useEffect(() => {
    if (!projectId) setCurrentProjectOnly(false)
  }, [projectId])

  React.useEffect(() => {
    if (!opened) return
    void reload()
  }, [opened, reload])

  React.useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  const handleSubmitEditor = React.useCallback(async () => {
    if (!editor) return
    const payload = buildUpsertPayload(editor, effectiveProjectId)
    if (!payload.name && !payload.identity_hint && !payload.character_id) {
      toast('至少填写 名称 / identity_hint / character_id 之一', 'error')
      return
    }
    setSaving(true)
    try {
      if (editor.id) {
        await updateAiCharacterLibraryCharacter(editor.id, payload)
        toast('角色库记录已更新', 'success')
      } else {
        await createAiCharacterLibraryCharacter(payload)
        toast('角色库记录已创建', 'success')
      }
      setEditor(null)
      await reload()
    } catch (err: unknown) {
      console.error('save ai character library failed', err)
      toast(err instanceof Error ? err.message : '保存角色库记录失败', 'error')
    } finally {
      setSaving(false)
    }
  }, [editor, effectiveProjectId, reload])

  const handleDelete = React.useCallback(async (character: AiCharacterLibraryCharacterDto) => {
    if (!canEdit) return
    const label = character.name || character.identity_hint || character.character_id || character.id
    if (!window.confirm(`确定删除角色库记录「${label}」？`)) return
    setDeletingId(character.id)
    try {
      await deleteAiCharacterLibraryCharacter(character.id)
      toast('角色库记录已删除', 'success')
      await reload()
    } catch (err: unknown) {
      console.error('delete ai character library failed', err)
      toast(err instanceof Error ? err.message : '删除角色库记录失败', 'error')
    } finally {
      setDeletingId('')
    }
  }, [canEdit, reload])

  const handleImport = React.useCallback(async () => {
    if (!canEdit) return
    let characters: AiCharacterLibraryUpsertPayload[]
    try {
      characters = parseImportJsonText(importText)
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'JSON 解析失败', 'error')
      return
    }
    setImporting(true)
    try {
      const result = await importAiCharacterLibraryJson({
        ...(effectiveProjectId ? { projectId: effectiveProjectId } : {}),
        characters,
      })
      toast(`导入完成：新增 ${result.importedCharacters}，更新 ${result.updatedCharacters}`, 'success')
      setImportText('')
      setPage(1)
      await reload()
    } catch (err: unknown) {
      console.error('import ai character library json failed', err)
      toast(err instanceof Error ? err.message : 'JSON 导入失败', 'error')
    } finally {
      setImporting(false)
    }
  }, [canEdit, effectiveProjectId, importText, reload])

  const handleImportFileChange = React.useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      setImportText(text)
    } catch (err: unknown) {
      console.error('read import file failed', err)
      toast(err instanceof Error ? err.message : '读取导入文件失败', 'error')
    } finally {
      event.currentTarget.value = ''
    }
  }, [])

  const pageStart = total > 0 ? (page - 1) * pageSize + 1 : 0
  const pageEnd = total > 0 ? Math.min(total, page * pageSize) : 0

  return (
    <PanelCard className={rootClassName}>
      <Stack className="ai-character-library-management-stack" gap="sm">
        <Group className="ai-character-library-management-header" justify="space-between" align="flex-start" wrap="wrap">
          <Stack className="ai-character-library-management-copy" gap={2}>
            <Text className="ai-character-library-management-title" fw={700}>AI 角色库管理</Text>
            <Text className="ai-character-library-management-subtitle" size="xs" c="dimmed">
              支持分页查询、单条 CRUD 和 JSON 批量导入。{syncState?.lastSyncedAt ? `最近同步：${formatTime(syncState.lastSyncedAt)}` : '当前为本地角色库。'}
            </Text>
          </Stack>
          <Group className="ai-character-library-management-actions" gap="xs" wrap="wrap">
            {projectId ? (
              <Switch
                className="ai-character-library-management-project-switch"
                size="xs"
                checked={currentProjectOnly}
                onChange={(event) => {
                  setCurrentProjectOnly(event.currentTarget.checked)
                  setPage(1)
                }}
                label="仅当前项目"
              />
            ) : null}
            <Tooltip className="ai-character-library-management-refresh-tooltip" label="刷新" withArrow>
              <ActionIcon className="ai-character-library-management-refresh" variant="subtle" onClick={() => void reload()} loading={loading} aria-label="刷新角色库">
                <IconRefresh className="ai-character-library-management-refresh-icon" size={16} />
              </ActionIcon>
            </Tooltip>
            <Button
              className="ai-character-library-management-create"
              size="xs"
              leftSection={<IconPlus className="ai-character-library-management-create-icon" size={14} />}
              disabled={!canEdit}
              onClick={() => setEditor(buildEditorState())}
            >
              新建角色
            </Button>
          </Group>
        </Group>

        <Group className="ai-character-library-management-toolbar" justify="space-between" align="center" wrap="wrap">
          <TextInput
            className="ai-character-library-management-search"
            value={search}
            onChange={(event) => {
              setSearch(event.currentTarget.value)
              setPage(1)
            }}
            leftSection={<IconSearch className="ai-character-library-management-search-icon" size={14} />}
            placeholder="搜索：名称 / character_id / 标签 / 设定"
            w={320}
          />
          <Group className="ai-character-library-management-meta" gap="xs" wrap="wrap">
            <Text className="ai-character-library-management-summary" size="xs" c="dimmed">
              {total > 0 ? `第 ${pageStart}-${pageEnd} / 共 ${total} 条` : '共 0 条'}
            </Text>
            <Select
              className="ai-character-library-management-page-size"
              value={String(pageSize)}
              data={PAGE_SIZE_OPTIONS}
              onChange={(value) => {
                const nextPageSize = Number.parseInt(String(value || pageSize), 10)
                if (!Number.isFinite(nextPageSize) || nextPageSize <= 0) return
                setPageSize(nextPageSize)
                setPage(1)
              }}
              allowDeselect={false}
              w={100}
            />
          </Group>
        </Group>

        <InlinePanel className="ai-character-library-management-import">
          <Stack className="ai-character-library-management-import-stack" gap="xs">
            <Group className="ai-character-library-management-import-header" justify="space-between" align="center" wrap="wrap">
              <Text className="ai-character-library-management-import-title" fw={600}>JSON 批量导入</Text>
              <Group className="ai-character-library-management-import-actions" gap="xs" wrap="wrap">
                <Button
                  className="ai-character-library-management-import-file"
                  size="xs"
                  variant="light"
                  disabled={!canEdit}
                  leftSection={<IconUpload className="ai-character-library-management-import-file-icon" size={14} />}
                  onClick={() => importFileInputRef.current?.click()}
                >
                  加载 JSON 文件
                </Button>
                <Button
                  className="ai-character-library-management-import-submit"
                  size="xs"
                  loading={importing}
                  disabled={!canEdit}
                  onClick={() => void handleImport()}
                >
                  导入 JSON
                </Button>
              </Group>
            </Group>
            <input
              className="ai-character-library-management-import-input"
              ref={importFileInputRef}
              type="file"
              accept="application/json,.json"
              onChange={handleImportFileChange}
              hidden
            />
            <Text className="ai-character-library-management-import-hint" size="xs" c="dimmed">
              支持 <code className="ai-character-library-management-import-code">[{`{...}`}]</code> 或 <code className="ai-character-library-management-import-code">{'{ "characters": [...] }'}</code>。导入按 sourceCharacterUid / 角色关键信息做 upsert，不会静默丢弃。
            </Text>
            <Textarea
              className="ai-character-library-management-import-textarea"
              value={importText}
              onChange={(event) => setImportText(event.currentTarget.value)}
              minRows={6}
              autosize
              placeholder='[{"name":"角色A","character_id":"role_a","identity_hint":"主角","full_body_image_url":"https://..."}]'
            />
          </Stack>
        </InlinePanel>

        <Divider className="ai-character-library-management-divider" />

        {loading ? (
          <Group className="ai-character-library-management-loading" justify="center" py="xl">
            <Loader className="ai-character-library-management-loading-icon" size="sm" />
            <Text className="ai-character-library-management-loading-text" size="sm" c="dimmed">加载中…</Text>
          </Group>
        ) : items.length === 0 ? (
          <InlinePanel className="ai-character-library-management-empty" padding="default">
            <Text className="ai-character-library-management-empty-text" size="sm" c="dimmed">当前筛选下没有角色库记录。</Text>
          </InlinePanel>
        ) : (
          <Table.ScrollContainer className="ai-character-library-management-table-scroll" minWidth={960}>
            <Table className="ai-character-library-management-table" striped highlightOnHover withTableBorder>
              <Table.Thead className="ai-character-library-management-table-head">
                <Table.Tr className="ai-character-library-management-table-head-row">
                  <Table.Th className="ai-character-library-management-table-head-cell">预览</Table.Th>
                  <Table.Th className="ai-character-library-management-table-head-cell">角色</Table.Th>
                  <Table.Th className="ai-character-library-management-table-head-cell">标签</Table.Th>
                  <Table.Th className="ai-character-library-management-table-head-cell">图片</Table.Th>
                  <Table.Th className="ai-character-library-management-table-head-cell">更新时间</Table.Th>
                  <Table.Th className="ai-character-library-management-table-head-cell">操作</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody className="ai-character-library-management-table-body">
                {items.map((character) => {
                  const previewUrl = pickPreviewUrl(character)
                  const imageCount = [
                    character.full_body_image_url,
                    character.three_view_image_url,
                    character.expression_image_url,
                    character.closeup_image_url,
                  ].filter((value) => normalizeEditorValue(value)).length
                  return (
                    <Table.Tr className="ai-character-library-management-table-row" key={character.id}>
                      <Table.Td className="ai-character-library-management-table-cell">
                        {previewUrl ? (
                          <Image className="ai-character-library-management-preview" src={previewUrl} alt={character.name || character.character_id || character.id} w={72} h={72} radius="sm" fit="cover" />
                        ) : (
                          <InlinePanel className="ai-character-library-management-preview ai-character-library-management-preview--empty" padding="compact">
                            <Text className="ai-character-library-management-preview-empty-text" size="xs" c="dimmed">无图</Text>
                          </InlinePanel>
                        )}
                      </Table.Td>
                      <Table.Td className="ai-character-library-management-table-cell">
                        <Stack className="ai-character-library-management-role" gap={2}>
                          <Text className="ai-character-library-management-role-name" fw={600}>{character.name || '未命名角色'}</Text>
                          <Text className="ai-character-library-management-role-id" size="xs" c="dimmed">
                            {character.character_id || '无 character_id'}
                          </Text>
                          <Text className="ai-character-library-management-role-meta" size="xs" c="dimmed">
                            {buildCharacterMeta(character) || '无附加标签'}
                          </Text>
                        </Stack>
                      </Table.Td>
                      <Table.Td className="ai-character-library-management-table-cell">
                        <Stack className="ai-character-library-management-tags" gap={2}>
                          <Text className="ai-character-library-management-tag-line" size="xs" c="dimmed">
                            世界观：{character.filter_worldview || '—'}
                          </Text>
                          <Text className="ai-character-library-management-tag-line" size="xs" c="dimmed">
                            主题：{character.filter_theme || '—'}
                          </Text>
                          <Text className="ai-character-library-management-tag-line" size="xs" c="dimmed">
                            场景：{character.filter_scene || '—'}
                          </Text>
                        </Stack>
                      </Table.Td>
                      <Table.Td className="ai-character-library-management-table-cell">
                        <Text className="ai-character-library-management-image-count" size="sm">{imageCount} / 4</Text>
                        <Text className="ai-character-library-management-import-time" size="xs" c="dimmed">
                          导入：{formatTime(character.imported_at)}
                        </Text>
                      </Table.Td>
                      <Table.Td className="ai-character-library-management-table-cell">
                        <Text className="ai-character-library-management-updated-time" size="xs" c="dimmed">
                          {formatTime(character.updated_at)}
                        </Text>
                      </Table.Td>
                      <Table.Td className="ai-character-library-management-table-cell">
                        <Group className="ai-character-library-management-row-actions" gap="xs" wrap="nowrap">
                          <Tooltip className="ai-character-library-management-edit-tooltip" label="编辑" withArrow>
                            <ActionIcon
                              className="ai-character-library-management-edit"
                              variant="subtle"
                              color="blue"
                              disabled={!canEdit}
                              aria-label="编辑角色库记录"
                              onClick={() => setEditor(buildEditorState(character))}
                            >
                              <IconPencil className="ai-character-library-management-edit-icon" size={16} />
                            </ActionIcon>
                          </Tooltip>
                          <Tooltip className="ai-character-library-management-delete-tooltip" label="删除" withArrow>
                            <ActionIcon
                              className="ai-character-library-management-delete"
                              variant="subtle"
                              color="red"
                              disabled={!canEdit}
                              loading={deletingId === character.id}
                              aria-label="删除角色库记录"
                              onClick={() => void handleDelete(character)}
                            >
                              <IconTrash className="ai-character-library-management-delete-icon" size={16} />
                            </ActionIcon>
                          </Tooltip>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  )
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}

        {total > pageSize ? (
          <Group className="ai-character-library-management-pagination" justify="flex-end">
            <Pagination
              className="ai-character-library-management-pagination-control"
              value={Math.min(page, totalPages)}
              onChange={setPage}
              total={totalPages}
              size="sm"
            />
          </Group>
        ) : null}
      </Stack>

      <Modal
        className="ai-character-library-management-editor-modal"
        opened={Boolean(editor)}
        onClose={() => setEditor(null)}
        title={editor?.id ? '编辑角色库记录' : '新建角色库记录'}
        size="lg"
      >
        {editor ? (
          <Stack className="ai-character-library-management-editor" gap="sm">
            <SimpleGrid className="ai-character-library-management-editor-grid" cols={{ base: 1, sm: 2 }} spacing="sm">
              <TextInput className="ai-character-library-management-editor-name" label="名称" value={editor.name} onChange={(event) => setEditor((prev) => (prev ? { ...prev, name: event.currentTarget.value } : prev))} />
              <TextInput className="ai-character-library-management-editor-character-id" label="character_id" value={editor.character_id} onChange={(event) => setEditor((prev) => (prev ? { ...prev, character_id: event.currentTarget.value } : prev))} />
              <TextInput className="ai-character-library-management-editor-group-number" label="group_number" value={editor.group_number} onChange={(event) => setEditor((prev) => (prev ? { ...prev, group_number: event.currentTarget.value } : prev))} />
              <TextInput className="ai-character-library-management-editor-identity-hint" label="identity_hint" value={editor.identity_hint} onChange={(event) => setEditor((prev) => (prev ? { ...prev, identity_hint: event.currentTarget.value } : prev))} />
              <TextInput className="ai-character-library-management-editor-gender" label="gender" value={editor.gender} onChange={(event) => setEditor((prev) => (prev ? { ...prev, gender: event.currentTarget.value } : prev))} />
              <TextInput className="ai-character-library-management-editor-age-group" label="age_group" value={editor.age_group} onChange={(event) => setEditor((prev) => (prev ? { ...prev, age_group: event.currentTarget.value } : prev))} />
              <TextInput className="ai-character-library-management-editor-species" label="species" value={editor.species} onChange={(event) => setEditor((prev) => (prev ? { ...prev, species: event.currentTarget.value } : prev))} />
              <TextInput className="ai-character-library-management-editor-era" label="era" value={editor.era} onChange={(event) => setEditor((prev) => (prev ? { ...prev, era: event.currentTarget.value } : prev))} />
              <TextInput className="ai-character-library-management-editor-genre" label="genre" value={editor.genre} onChange={(event) => setEditor((prev) => (prev ? { ...prev, genre: event.currentTarget.value } : prev))} />
              <TextInput className="ai-character-library-management-editor-outfit" label="outfit" value={editor.outfit} onChange={(event) => setEditor((prev) => (prev ? { ...prev, outfit: event.currentTarget.value } : prev))} />
              <TextInput className="ai-character-library-management-editor-worldview" label="filter_worldview" value={editor.filter_worldview} onChange={(event) => setEditor((prev) => (prev ? { ...prev, filter_worldview: event.currentTarget.value } : prev))} />
              <TextInput className="ai-character-library-management-editor-theme" label="filter_theme" value={editor.filter_theme} onChange={(event) => setEditor((prev) => (prev ? { ...prev, filter_theme: event.currentTarget.value } : prev))} />
              <TextInput className="ai-character-library-management-editor-scene" label="filter_scene" value={editor.filter_scene} onChange={(event) => setEditor((prev) => (prev ? { ...prev, filter_scene: event.currentTarget.value } : prev))} />
              <TextInput className="ai-character-library-management-editor-full-body" label="full_body_image_url" value={editor.full_body_image_url} onChange={(event) => setEditor((prev) => (prev ? { ...prev, full_body_image_url: event.currentTarget.value } : prev))} />
              <TextInput className="ai-character-library-management-editor-three-view" label="three_view_image_url" value={editor.three_view_image_url} onChange={(event) => setEditor((prev) => (prev ? { ...prev, three_view_image_url: event.currentTarget.value } : prev))} />
              <TextInput className="ai-character-library-management-editor-expression" label="expression_image_url" value={editor.expression_image_url} onChange={(event) => setEditor((prev) => (prev ? { ...prev, expression_image_url: event.currentTarget.value } : prev))} />
              <TextInput className="ai-character-library-management-editor-closeup" label="closeup_image_url" value={editor.closeup_image_url} onChange={(event) => setEditor((prev) => (prev ? { ...prev, closeup_image_url: event.currentTarget.value } : prev))} />
            </SimpleGrid>
            <Textarea className="ai-character-library-management-editor-features" label="distinctive_features" minRows={3} autosize value={editor.distinctive_features} onChange={(event) => setEditor((prev) => (prev ? { ...prev, distinctive_features: event.currentTarget.value } : prev))} />
            <Group className="ai-character-library-management-editor-actions" justify="flex-end">
              <Button className="ai-character-library-management-editor-cancel" variant="light" onClick={() => setEditor(null)}>
                取消
              </Button>
              <Button className="ai-character-library-management-editor-submit" loading={saving} disabled={!canEdit} onClick={() => void handleSubmitEditor()}>
                {editor.id ? '保存修改' : '创建角色'}
              </Button>
            </Group>
          </Stack>
        ) : null}
      </Modal>
    </PanelCard>
  )
}
