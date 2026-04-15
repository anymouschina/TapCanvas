import React from 'react'
import {
  Badge,
  Button,
  Center,
  Group,
  Image,
  Loader,
  Modal,
  Box,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from '@mantine/core'
import { IconPhoto, IconRefresh, IconSearch } from '@tabler/icons-react'
import {
  getProjectBookIndex,
  listProjectBooks,
  listProjectRoleCardAssets,
  listServerAssets,
  type ProjectBookIndexDto,
  type ProjectMaterialKind,
  type ProjectRoleCardAssetDto,
  type ServerAssetDto,
} from '../api/server'
import { InlinePanel } from '../ui/InlinePanel'
import { PanelCard } from '../ui/PanelCard'
import { toast } from '../ui/toast'

type ViewerFilter = 'all' | 'roleCards' | 'docs'

type ProjectDocAsset = {
  id: string
  name: string
  kind: ProjectMaterialKind
  content: string
  source: string
  chapter: number | null
  createdAt: string
  updatedAt: string
}

type BookRoleCard = NonNullable<NonNullable<ProjectBookIndexDto['assets']>['roleCards']>[number]

type ProjectRoleCardView = {
  id: string
  name: string
  roleName: string
  stateDescription: string
  prompt: string
  status: 'draft' | 'generated'
  chapter: number | null
  imageUrl: string
  updatedAt: string
}

function resolveRoleCardImageUrl(input: {
  imageUrl?: string | null
  threeViewImageUrl?: string | null
}): string {
  return String(input.threeViewImageUrl || input.imageUrl || '').trim()
}

type ProjectAssetsViewerProps = {
  opened: boolean
  projectId: string
  projectName: string
  onClose: () => void
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseDocAsset(asset: ServerAssetDto): ProjectDocAsset | null {
  const dataUnknown: unknown = asset.data
  if (!isObjectRecord(dataUnknown)) return null
  const kindRaw = String(dataUnknown.kind || '').trim()
  if (
    kindRaw !== 'novelDoc' &&
    kindRaw !== 'scriptDoc' &&
    kindRaw !== 'storyboardScript' &&
    kindRaw !== 'visualManualDoc' &&
    kindRaw !== 'directorManualDoc'
  ) return null
  const chapterRaw = Number(dataUnknown.chapter)
  const chapter = Number.isFinite(chapterRaw) && chapterRaw > 0 ? Math.trunc(chapterRaw) : null
  const content =
    typeof dataUnknown.content === 'string'
      ? dataUnknown.content
      : typeof dataUnknown.prompt === 'string'
        ? dataUnknown.prompt
        : ''
  return {
    id: asset.id,
    name: String(asset.name || '').trim() || '未命名文档',
    kind: kindRaw,
    content: String(content || '').trim(),
    source: typeof dataUnknown.source === 'string' ? dataUnknown.source.trim() : '',
    chapter,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  }
}

const PROJECT_TEXT_SINGLETON_SOURCE = 'projectTextSingleton'
const LEGACY_PROJECT_TEXT_SOURCES = new Set<string>(['uploadedTextCombined'])

function pickCurrentProjectTextDoc(docs: ProjectDocAsset[]): ProjectDocAsset | null {
  const textDocs = docs.filter((doc) => doc.kind === 'novelDoc' || doc.kind === 'scriptDoc')
  if (!textDocs.length) return null
  const preferred = textDocs.filter((doc) =>
    doc.source === PROJECT_TEXT_SINGLETON_SOURCE || LEGACY_PROJECT_TEXT_SOURCES.has(doc.source),
  )
  const pool = preferred.length ? preferred : textDocs
  return pool
    .slice()
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0] || null
}

function summarize(text: string): string {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  return lines.slice(0, 3).join(' ')
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const mi = String(date.getMinutes()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`
}

async function listAllAssetsByKind(projectId: string, kind: ProjectMaterialKind): Promise<ServerAssetDto[]> {
  const items: ServerAssetDto[] = []
  let cursor: string | null = null
  for (let i = 0; i < 30; i += 1) {
    const page = await listServerAssets({ projectId, kind, limit: 200, cursor })
    const batch = Array.isArray(page.items) ? page.items : []
    items.push(...batch)
    cursor = page.cursor
    if (!cursor) break
  }
  return items
}

async function listProjectBookRoleCards(projectId: string): Promise<ProjectRoleCardView[]> {
  const books = await listProjectBooks(projectId)
  if (!Array.isArray(books) || books.length === 0) return []
  const indexes = await Promise.all(
    books.map(async (book) => {
      const bookId = String(book?.bookId || '').trim()
      if (!bookId) return null
      try {
        return await getProjectBookIndex(projectId, bookId)
      } catch {
        return null
      }
    }),
  )
  const out: ProjectRoleCardView[] = []
  for (const index of indexes) {
    if (!index) continue
    const roleCards = Array.isArray(index.assets?.roleCards) ? index.assets.roleCards : []
    for (const card of roleCards) {
      out.push(normalizeBookRoleCard(card))
    }
  }
  return out
}

function normalizeProjectRoleCardAsset(asset: ProjectRoleCardAssetDto): ProjectRoleCardView {
  const chapterRaw = Number((asset.data as Record<string, unknown>).chapter)
  const chapter = Number.isFinite(chapterRaw) && chapterRaw > 0 ? Math.trunc(chapterRaw) : null
  const status = String(asset.data.status || '').trim() === 'draft' ? 'draft' : 'generated'
  return {
    id: String(asset.id || '').trim(),
    name: String(asset.name || asset.data.roleName || '').trim() || '未命名角色',
    roleName: String(asset.data.roleName || '').trim() || '未命名角色',
    stateDescription: String((asset.data as Record<string, unknown>).stateDescription || '').trim(),
    prompt: String(asset.data.prompt || '').trim(),
    status,
    chapter,
    imageUrl: resolveRoleCardImageUrl({
      imageUrl: asset.data.imageUrl,
      threeViewImageUrl: asset.data.threeViewImageUrl,
    }),
    updatedAt: String(asset.updatedAt || asset.data.updatedAt || asset.createdAt || ''),
  }
}

function normalizeBookRoleCard(card: BookRoleCard): ProjectRoleCardView {
  const chapterRaw = Number(card.chapter)
  const chapter = Number.isFinite(chapterRaw) && chapterRaw > 0 ? Math.trunc(chapterRaw) : null
  const status = card.status === 'draft' ? 'draft' : 'generated'
  const roleName = String(card.roleName || '').trim() || '未命名角色'
  const cardId = String(card.cardId || '').trim()
  return {
    id: cardId || `${roleName}:${String(card.updatedAt || '')}`,
    name: roleName,
    roleName,
    stateDescription: String(card.stateDescription || '').trim(),
    prompt: String(card.prompt || '').trim(),
    status,
    chapter,
    imageUrl: resolveRoleCardImageUrl({
      imageUrl: card.imageUrl,
      threeViewImageUrl: card.threeViewImageUrl,
    }),
    updatedAt: String(card.updatedAt || card.createdAt || ''),
  }
}

function mergeRoleCards(
  assetCards: ProjectRoleCardAssetDto[],
  bookCards: ProjectRoleCardView[],
): ProjectRoleCardView[] {
  const merged = new Map<string, ProjectRoleCardView>()
  const put = (card: ProjectRoleCardView) => {
    const roleNameKey = String(card.roleName || '').trim().toLowerCase()
    const chapterKey = card.chapter && card.chapter > 0 ? String(card.chapter) : 'na'
    const stateKey = String(card.stateDescription || '').trim().toLowerCase().replace(/\s+/g, ' ') || 'default'
    const dedupeKey = `${roleNameKey}#${stateKey}#${chapterKey}`
    const prev = merged.get(dedupeKey)
    if (!prev) {
      merged.set(dedupeKey, card)
      return
    }
    const prevTs = Date.parse(String(prev.updatedAt || ''))
    const nextTs = Date.parse(String(card.updatedAt || ''))
    if ((Number.isFinite(nextTs) ? nextTs : 0) >= (Number.isFinite(prevTs) ? prevTs : 0)) {
      merged.set(dedupeKey, card)
    }
  }
  for (const card of bookCards) put(card)
  for (const card of assetCards) put(normalizeProjectRoleCardAsset(card))
  return Array.from(merged.values()).sort(
    (a, b) => Date.parse(String(b.updatedAt || '')) - Date.parse(String(a.updatedAt || '')),
  )
}

function toKindLabel(kind: ProjectMaterialKind): string {
  if (kind === 'novelDoc') return '小说文档'
  if (kind === 'scriptDoc') return '剧本文档'
  if (kind === 'visualManualDoc') return '视觉手册'
  if (kind === 'directorManualDoc') return '导演手册'
  return '分镜脚本'
}

export default function ProjectAssetsViewer({
  opened,
  projectId,
  projectName,
  onClose,
}: ProjectAssetsViewerProps): JSX.Element {
  const [loading, setLoading] = React.useState(false)
  const [filter, setFilter] = React.useState<ViewerFilter>('all')
  const [query, setQuery] = React.useState('')
  const [roleCards, setRoleCards] = React.useState<ProjectRoleCardView[]>([])
  const [docs, setDocs] = React.useState<ProjectDocAsset[]>([])
  const [activeRoleCard, setActiveRoleCard] = React.useState<ProjectRoleCardView | null>(null)
  const [activeDoc, setActiveDoc] = React.useState<ProjectDocAsset | null>(null)

  const loadAssets = React.useCallback(async () => {
    const pid = String(projectId || '').trim()
    if (!pid) {
      setRoleCards([])
      setDocs([])
      return
    }
    setLoading(true)
    try {
      const [roleCardRows, bookRoleCards, novelRows, scriptRows, storyboardRows, visualManualRows, directorManualRows] = await Promise.all([
        listProjectRoleCardAssets(pid),
        listProjectBookRoleCards(pid),
        listAllAssetsByKind(pid, 'novelDoc'),
        listAllAssetsByKind(pid, 'scriptDoc'),
        listAllAssetsByKind(pid, 'storyboardScript'),
        listAllAssetsByKind(pid, 'visualManualDoc'),
        listAllAssetsByKind(pid, 'directorManualDoc'),
      ])
      const nextRoleCards = mergeRoleCards(Array.isArray(roleCardRows) ? roleCardRows : [], bookRoleCards)
      const parsedDocs = [...novelRows, ...scriptRows, ...storyboardRows, ...visualManualRows, ...directorManualRows]
        .map((row) => parseDocAsset(row))
        .filter((row): row is ProjectDocAsset => row !== null)
      const currentProjectText = pickCurrentProjectTextDoc(parsedDocs)
      const storyboardDocs = parsedDocs.filter((doc) => doc.kind === 'storyboardScript')
      const setupDocs = parsedDocs.filter((doc) => doc.kind === 'visualManualDoc' || doc.kind === 'directorManualDoc')
      const nextDocs = [...setupDocs, ...storyboardDocs, ...(currentProjectText ? [currentProjectText] : [])]
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      setRoleCards(nextRoleCards)
      setDocs(nextDocs)
    } catch (error: unknown) {
      const message = error instanceof Error && error.message ? error.message : '加载项目素材失败'
      toast(message, 'error')
      setRoleCards([])
      setDocs([])
    } finally {
      setLoading(false)
    }
  }, [projectId])

  React.useEffect(() => {
    if (!opened) return
    void loadAssets()
  }, [loadAssets, opened])

  const filteredRoleCards = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return roleCards
    return roleCards.filter((card) => {
      const roleName = String(card.roleName || '').trim().toLowerCase()
      const stateDesc = String(card.stateDescription || '').trim().toLowerCase()
      const prompt = String(card.prompt || '').trim().toLowerCase()
      return roleName.includes(q) || stateDesc.includes(q) || prompt.includes(q)
    })
  }, [query, roleCards])

  const filteredDocs = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return docs
    return docs.filter((doc) => {
      const title = doc.name.toLowerCase()
      const content = doc.content.toLowerCase()
      return title.includes(q) || content.includes(q)
    })
  }, [docs, query])

  const currentTextDoc = React.useMemo(() => pickCurrentProjectTextDoc(docs), [docs])
  const storyboardDocs = React.useMemo(() => docs.filter((doc) => doc.kind === 'storyboardScript'), [docs])
  const chapterBoundDocs = React.useMemo(
    () => docs.filter((doc) => typeof doc.chapter === 'number' && doc.chapter > 0),
    [docs],
  )
  const reusableNowItems = [
    currentTextDoc ? `项目原文：${currentTextDoc.name}` : '项目原文：未导入',
    roleCards.length > 0 ? `角色卡：${roleCards.length}` : '角色卡：0',
    storyboardDocs.length > 0 ? `分镜脚本：${storyboardDocs.length}` : '分镜脚本：0',
    chapterBoundDocs.length > 0 ? `章节文档：${chapterBoundDocs.length}` : '章节文档：0',
  ]

  return (
    <>
      <Modal
        className="tc-pm-assets__modal"
        opened={opened}
        onClose={onClose}
        title={`项目资料库 · ${projectName || projectId}`}
        centered
        size="xl"
      >
        <Stack className="tc-pm-assets__stack" gap="sm">
          <PanelCard className="tc-pm-assets__overview-card" padding="compact">
            <Group justify="space-between" align="flex-start" gap="md">
              <Stack gap={4} style={{ flex: 1, minWidth: 240 }}>
                <Text size="sm" fw={700}>项目资料概览</Text>
                <Text size="xs" c="dimmed">
                  查看当前项目的原文、角色卡和文档脚本。
                </Text>
              </Stack>
              <SimpleGrid cols={{ base: 2, md: 4 }} spacing="sm" style={{ minWidth: 320 }}>
                <InlinePanel className="tc-pm-assets__overview-metric">
                  <Text size="xs" c="dimmed">项目原文</Text>
                  <Text size="sm" fw={700} mt={4} lineClamp={1}>{currentTextDoc?.name || '未导入'}</Text>
                </InlinePanel>
                <InlinePanel className="tc-pm-assets__overview-metric">
                  <Text size="xs" c="dimmed">角色记忆</Text>
                  <Text size="sm" fw={700} mt={4}>{roleCards.length}</Text>
                </InlinePanel>
                <InlinePanel className="tc-pm-assets__overview-metric">
                  <Text size="xs" c="dimmed">文档脚本</Text>
                  <Text size="sm" fw={700} mt={4}>{docs.length}</Text>
                </InlinePanel>
                <InlinePanel className="tc-pm-assets__overview-metric">
                  <Text size="xs" c="dimmed">最近更新</Text>
                  <Text size="sm" fw={700} mt={4}>{formatTime((docs[0]?.updatedAt || roleCards[0]?.updatedAt || '').trim())}</Text>
                </InlinePanel>
              </SimpleGrid>
            </Group>
            <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm" mt="sm">
              <InlinePanel className="tc-pm-assets__overview-section">
                <Text size="sm" fw={700}>当前项目内容</Text>
                <Stack gap={8} mt="sm">
                  {reusableNowItems.map((item) => (
                    <Text key={item} size="xs" c="dimmed">{item}</Text>
                  ))}
                </Stack>
              </InlinePanel>
              <InlinePanel className="tc-pm-assets__overview-section">
                <Text size="sm" fw={700}>项目统计</Text>
                <SimpleGrid cols={2} spacing="sm" mt="sm">
                  <InlinePanel className="tc-pm-assets__overview-stat">
                    <Text size="xs" c="dimmed">项目原文</Text>
                    <Text size="sm" fw={700} mt={4}>{currentTextDoc ? '已导入' : '未导入'}</Text>
                  </InlinePanel>
                  <InlinePanel className="tc-pm-assets__overview-stat">
                    <Text size="xs" c="dimmed">章节脚本</Text>
                    <Text size="sm" fw={700} mt={4}>{storyboardDocs.length}</Text>
                  </InlinePanel>
                  <InlinePanel className="tc-pm-assets__overview-stat">
                    <Text size="xs" c="dimmed">章节可追溯文档</Text>
                    <Text size="sm" fw={700} mt={4}>{chapterBoundDocs.length}</Text>
                  </InlinePanel>
                  <InlinePanel className="tc-pm-assets__overview-stat">
                    <Text size="xs" c="dimmed">角色连续性记忆</Text>
                    <Text size="sm" fw={700} mt={4}>{roleCards.length}</Text>
                  </InlinePanel>
                </SimpleGrid>
              </InlinePanel>
            </SimpleGrid>
          </PanelCard>
          <Group className="tc-pm-assets__toolbar" justify="space-between" align="center" wrap="wrap" gap="xs">
            <SegmentedControl
              className="tc-pm-assets__filter"
              value={filter}
              onChange={(value) => setFilter(value === 'roleCards' || value === 'docs' ? value : 'all')}
              data={[
                { value: 'all', label: '全部' },
                { value: 'roleCards', label: '角色卡' },
                { value: 'docs', label: '文档脚本' },
              ]}
            />
            <Group className="tc-pm-assets__toolbar-right" gap="xs">
              <TextInput
                className="tc-pm-assets__search"
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                leftSection={<IconSearch className="tc-pm-assets__search-icon" size={14} />}
                placeholder="搜索角色名 / 角色描述 / 提示词 / 分镜脚本内容"
                w={320}
              />
              <Button
                className="tc-pm-assets__refresh"
                size="xs"
                variant="light"
                leftSection={<IconRefresh className="tc-pm-assets__refresh-icon" size={14} />}
                loading={loading}
                onClick={() => {
                  if (!loading) void loadAssets()
                }}
              >
                刷新
              </Button>
            </Group>
          </Group>

          {loading ? (
            <Center className="tc-pm-assets__loading" mih={180}>
              <Group className="tc-pm-assets__loading-group" gap="xs">
                <Loader className="tc-pm-assets__loading-icon" size="sm" />
                <Text className="tc-pm-assets__loading-text" size="sm" c="dimmed">加载中…</Text>
              </Group>
            </Center>
          ) : (
            <Stack className="tc-pm-assets__content" gap="lg">
              {(filter === 'all' || filter === 'roleCards') && (
                <Stack className="tc-pm-assets__section" gap="xs">
                  <Group className="tc-pm-assets__section-header" justify="space-between" align="center">
                    <Text className="tc-pm-assets__section-title" size="sm" fw={600}>角色共享记忆</Text>
                    <Badge className="tc-pm-assets__section-count" size="sm" variant="light">{filteredRoleCards.length}</Badge>
                  </Group>
                  {filteredRoleCards.length === 0 ? (
                    <Text className="tc-pm-assets__empty" size="sm" c="dimmed">暂无角色卡素材</Text>
                  ) : (
                    <SimpleGrid className="tc-pm-assets__role-grid" cols={{ base: 1, sm: 2 }} spacing="sm">
                      {filteredRoleCards.map((card) => (
                        <PanelCard className="tc-pm-assets__role-card" key={card.id}>
                          {card.imageUrl ? (
                            <Image className="tc-pm-assets__role-image" src={card.imageUrl} alt={card.roleName} radius="sm" h={180} fit="cover" />
                          ) : (
                            <Center className="tc-pm-assets__role-placeholder" h={180}>
                              <IconPhoto className="tc-pm-assets__role-placeholder-icon" size={22} />
                            </Center>
                          )}
                          <Stack className="tc-pm-assets__role-body" mt="xs" gap={6}>
                            <Text className="tc-pm-assets__role-title" size="sm" fw={600} lineClamp={1}>{card.roleName}</Text>
                            <Group className="tc-pm-assets__role-meta" gap={6}>
                              <Badge className="tc-pm-assets__role-status" size="xs" variant="light">
                                {card.status === 'draft' ? '草稿' : '已生成'}
                              </Badge>
                              {typeof card.chapter === 'number' ? (
                                <Badge className="tc-pm-assets__role-chapter" size="xs" variant="outline">
                                  {`第${card.chapter}章`}
                                </Badge>
                              ) : null}
                            </Group>
                            <Text className="tc-pm-assets__role-time" size="xs" c="dimmed">{formatTime(card.updatedAt)}</Text>
                            <Group className="tc-pm-assets__role-actions" justify="flex-end">
                              <Button className="tc-pm-assets__role-preview-btn" size="xs" variant="light" onClick={() => setActiveRoleCard(card)}>
                                预览详情
                              </Button>
                            </Group>
                          </Stack>
                        </PanelCard>
                      ))}
                    </SimpleGrid>
                  )}
                </Stack>
              )}

              {(filter === 'all' || filter === 'docs') && (
                <Stack className="tc-pm-assets__section" gap="xs">
                  <Group className="tc-pm-assets__section-header" justify="space-between" align="center">
                    <Text className="tc-pm-assets__section-title" size="sm" fw={600}>文本与分镜记忆</Text>
                    <Badge className="tc-pm-assets__section-count" size="sm" variant="light">{filteredDocs.length}</Badge>
                  </Group>
                  {filteredDocs.length === 0 ? (
                    <Text className="tc-pm-assets__empty" size="sm" c="dimmed">暂无文档素材</Text>
                  ) : (
                    <SimpleGrid className="tc-pm-assets__doc-grid" cols={{ base: 1, sm: 2 }} spacing="sm">
                      {filteredDocs.map((doc) => (
                        <PanelCard className="tc-pm-assets__doc-card" key={doc.id}>
                          <Stack className="tc-pm-assets__doc-body" gap={8}>
                            <Group className="tc-pm-assets__doc-header" justify="space-between" align="flex-start" gap="xs">
                              <Text className="tc-pm-assets__doc-title" size="sm" fw={600} lineClamp={1}>{doc.name}</Text>
                              <Group className="tc-pm-assets__doc-badges" gap={6}>
                                <Badge className="tc-pm-assets__doc-kind" size="xs" variant="light">{toKindLabel(doc.kind)}</Badge>
                                {typeof doc.chapter === 'number' ? (
                                  <Badge className="tc-pm-assets__doc-chapter" size="xs" variant="outline">{`第${doc.chapter}章`}</Badge>
                                ) : null}
                              </Group>
                            </Group>
                            <Text className="tc-pm-assets__doc-summary" size="xs" c="dimmed" lineClamp={4}>
                              {summarize(doc.content) || '无内容'}
                            </Text>
                            <Group className="tc-pm-assets__doc-footer" justify="space-between" align="center">
                              <Text className="tc-pm-assets__doc-time" size="xs" c="dimmed">{formatTime(doc.updatedAt)}</Text>
                              <Button className="tc-pm-assets__doc-preview-btn" size="xs" variant="light" onClick={() => setActiveDoc(doc)}>
                                预览全文
                              </Button>
                            </Group>
                          </Stack>
                        </PanelCard>
                      ))}
                    </SimpleGrid>
                  )}
                </Stack>
              )}
            </Stack>
          )}
        </Stack>
      </Modal>

      <Modal
        className="tc-pm-assets__role-preview-modal"
        opened={Boolean(activeRoleCard)}
        onClose={() => setActiveRoleCard(null)}
        title={String(activeRoleCard?.roleName || activeRoleCard?.name || '角色卡详情')}
        centered
        size="lg"
      >
        <Stack className="tc-pm-assets__role-preview-stack" gap="sm">
          {String(activeRoleCard?.imageUrl || '').trim() ? (
            <Image
              className="tc-pm-assets__role-preview-image"
              src={String(activeRoleCard?.imageUrl || '').trim()}
              alt={String(activeRoleCard?.roleName || activeRoleCard?.name || '角色卡')}
              radius="md"
              fit="contain"
            />
          ) : null}
          <div className="tc-pm-assets__role-preview-scroll">
            <Stack className="tc-pm-assets__role-preview-content" gap={8}>
              <Text className="tc-pm-assets__role-preview-line" size="sm">
                <Text className="tc-pm-assets__role-preview-label" component="span" fw={600}>角色状态：</Text>
                {String(activeRoleCard?.stateDescription || '').trim() || '无'}
              </Text>
              <Text className="tc-pm-assets__role-preview-line" size="sm">
                <Text className="tc-pm-assets__role-preview-label" component="span" fw={600}>完整提示词：</Text>
              </Text>
              <Text className="tc-pm-assets__role-preview-prompt" size="sm" c="dimmed">
                {String(activeRoleCard?.prompt || '').trim() || '无'}
              </Text>
            </Stack>
          </div>
        </Stack>
      </Modal>

      <Modal
        className="tc-pm-assets__doc-preview-modal"
        opened={Boolean(activeDoc)}
        onClose={() => setActiveDoc(null)}
        title={String(activeDoc?.name || '文档预览')}
        centered
        size="xl"
      >
        <Stack className="tc-pm-assets__doc-preview-stack" gap="sm">
          <Group className="tc-pm-assets__doc-preview-meta" gap={6}>
            <Badge className="tc-pm-assets__doc-preview-kind" size="sm" variant="light">
              {activeDoc ? toKindLabel(activeDoc.kind) : '-'}
            </Badge>
            {typeof activeDoc?.chapter === 'number' ? (
              <Badge className="tc-pm-assets__doc-preview-chapter" size="sm" variant="outline">
                {`第${activeDoc.chapter}章`}
              </Badge>
            ) : null}
            <Text className="tc-pm-assets__doc-preview-time" size="xs" c="dimmed">
              {activeDoc ? formatTime(activeDoc.updatedAt) : '-'}
            </Text>
          </Group>
          <div className="tc-pm-assets__doc-preview-scroll">
            <Text className="tc-pm-assets__doc-preview-content" size="sm">
              {String(activeDoc?.content || '').trim() || '无内容'}
            </Text>
          </div>
        </Stack>
      </Modal>
    </>
  )
}
