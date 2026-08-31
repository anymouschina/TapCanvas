import React from 'react'
import {
  Badge,
  Button,
  Center,
  Group,
  Loader,
  Modal,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from '@mantine/core'
import { IconRefresh, IconSearch } from '@tabler/icons-react'
import {
  listProjectBooks,
  listServerAssets,
  type ProjectBookListItemDto,
  type ProjectMaterialKind,
  type ServerAssetDto,
} from '../api/server'
import { InlinePanel } from '../ui/InlinePanel'
import { PanelCard } from '../ui/PanelCard'
import { toast } from '../ui/toast'

type ProjectDocAsset = {
  id: string
  name: string
  kind: ProjectMaterialKind | 'novelBook'
  content: string
  source: string
  chapter: number | null
  chapterCount?: number
  createdAt: string
  updatedAt: string
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
    kind: kindRaw as ProjectMaterialKind,
    content: String(content || '').trim(),
    source: typeof dataUnknown.source === 'string' ? dataUnknown.source.trim() : '',
    chapter,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  }
}

function bookToDocItem(book: ProjectBookListItemDto): ProjectDocAsset {
  return {
    id: `book:${book.bookId}`,
    name: book.title || '未命名小说',
    kind: 'novelBook',
    content: '',
    source: 'bookUpload',
    chapter: null,
    chapterCount: book.chapterCount,
    createdAt: book.updatedAt,
    updatedAt: book.updatedAt,
  }
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

function toKindLabel(kind: ProjectDocAsset['kind']): string {
  if (kind === 'novelBook') return '小说原文'
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
  const [query, setQuery] = React.useState('')
  const [docs, setDocs] = React.useState<ProjectDocAsset[]>([])
  const [books, setBooks] = React.useState<ProjectBookListItemDto[]>([])
  const [activeDoc, setActiveDoc] = React.useState<ProjectDocAsset | null>(null)

  const loadAssets = React.useCallback(async () => {
    const pid = String(projectId || '').trim()
    if (!pid) {
      setDocs([])
      setBooks([])
      return
    }
    setLoading(true)
    try {
      const [allBooks, scriptRows, storyboardRows, visualManualRows, directorManualRows] = await Promise.all([
        listProjectBooks(pid),
        listAllAssetsByKind(pid, 'scriptDoc'),
        listAllAssetsByKind(pid, 'storyboardScript'),
        listAllAssetsByKind(pid, 'visualManualDoc'),
        listAllAssetsByKind(pid, 'directorManualDoc'),
      ])

      // novelDoc 原文存在 book 文件系统，不在 D1 asset 表；直接用 books 列表展示
      const bookDocItems = (Array.isArray(allBooks) ? allBooks : []).map(bookToDocItem)
      const parsedDocs = [...scriptRows, ...storyboardRows, ...visualManualRows, ...directorManualRows]
        .map((row) => parseDocAsset(row))
        .filter((row): row is ProjectDocAsset => row !== null)

      const nextDocs = [...bookDocItems, ...parsedDocs]
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))

      setBooks(Array.isArray(allBooks) ? allBooks : [])
      setDocs(nextDocs)
    } catch (error: unknown) {
      const message = error instanceof Error && error.message ? error.message : '加载项目素材失败'
      toast(message, 'error')
      setDocs([])
      setBooks([])
    } finally {
      setLoading(false)
    }
  }, [projectId])

  React.useEffect(() => {
    if (!opened) return
    void loadAssets()
  }, [loadAssets, opened])

  const filteredDocs = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return docs
    return docs.filter((doc) => {
      const title = doc.name.toLowerCase()
      const content = doc.content.toLowerCase()
      return title.includes(q) || content.includes(q)
    })
  }, [docs, query])

  const novelBooks = React.useMemo(() => docs.filter((d) => d.kind === 'novelBook'), [docs])
  const storyboardDocs = React.useMemo(() => docs.filter((doc) => doc.kind === 'storyboardScript'), [docs])
  const chapterBoundDocs = React.useMemo(
    () => docs.filter((doc) => typeof doc.chapter === 'number' && doc.chapter > 0),
    [docs],
  )

  const overviewOriginText = books.length > 0
    ? books.map((b) => `${b.title}（${b.chapterCount} 章）`).join('、')
    : '未导入'

  const reusableNowItems = [
    `项目原文：${overviewOriginText}`,
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
                  查看当前项目的原文与文档脚本。
                </Text>
              </Stack>
              <SimpleGrid cols={{ base: 1, md: 3 }} spacing="sm" style={{ minWidth: 320 }}>
                <InlinePanel className="tc-pm-assets__overview-metric">
                  <Text size="xs" c="dimmed">项目原文</Text>
                  <Text size="sm" fw={700} mt={4} lineClamp={1}>
                    {books.length > 0 ? `${books.length} 部（共 ${books.reduce((s, b) => s + b.chapterCount, 0)} 章）` : '未导入'}
                  </Text>
                </InlinePanel>
                <InlinePanel className="tc-pm-assets__overview-metric">
                  <Text size="xs" c="dimmed">文档脚本</Text>
                  <Text size="sm" fw={700} mt={4}>{docs.filter((d) => d.kind !== 'novelBook').length}</Text>
                </InlinePanel>
                <InlinePanel className="tc-pm-assets__overview-metric">
                  <Text size="xs" c="dimmed">最近更新</Text>
                  <Text size="sm" fw={700} mt={4}>{formatTime((docs[0]?.updatedAt || '').trim())}</Text>
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
                    <Text size="sm" fw={700} mt={4}>{books.length > 0 ? `已导入 ${books.length} 部` : '未导入'}</Text>
                  </InlinePanel>
                  <InlinePanel className="tc-pm-assets__overview-stat">
                    <Text size="xs" c="dimmed">章节脚本</Text>
                    <Text size="sm" fw={700} mt={4}>{storyboardDocs.length}</Text>
                  </InlinePanel>
                  <InlinePanel className="tc-pm-assets__overview-stat">
                    <Text size="xs" c="dimmed">章节可追溯文档</Text>
                    <Text size="sm" fw={700} mt={4}>{chapterBoundDocs.length}</Text>
                  </InlinePanel>
                </SimpleGrid>
              </InlinePanel>
            </SimpleGrid>
          </PanelCard>
          <Group className="tc-pm-assets__toolbar" justify="space-between" align="center" wrap="wrap" gap="xs">
            <Text className="tc-pm-assets__filter-label" size="sm" fw={600}>文档脚本</Text>
            <Group className="tc-pm-assets__toolbar-right" gap="xs">
              <TextInput
                className="tc-pm-assets__search"
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                leftSection={<IconSearch className="tc-pm-assets__search-icon" size={14} />}
                placeholder="搜索文档标题或分镜脚本内容"
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
                                {doc.kind === 'novelBook' && typeof doc.chapterCount === 'number' ? (
                                  <Badge className="tc-pm-assets__doc-chapter" size="xs" variant="outline">{`${doc.chapterCount} 章`}</Badge>
                                ) : typeof doc.chapter === 'number' ? (
                                  <Badge className="tc-pm-assets__doc-chapter" size="xs" variant="outline">{`第${doc.chapter}章`}</Badge>
                                ) : null}
                              </Group>
                            </Group>
                            <Text className="tc-pm-assets__doc-summary" size="xs" c="dimmed" lineClamp={4}>
                              {doc.kind === 'novelBook'
                                ? `小说原文已导入（${doc.chapterCount ?? 0} 章），由书籍上传系统管理，内容在 AI 生成时自动注入上下文。`
                                : summarize(doc.content) || '无内容'}
                            </Text>
                            <Group className="tc-pm-assets__doc-footer" justify="space-between" align="center">
                              <Text className="tc-pm-assets__doc-time" size="xs" c="dimmed">{formatTime(doc.updatedAt)}</Text>
                              {doc.kind !== 'novelBook' && (
                                <Button className="tc-pm-assets__doc-preview-btn" size="xs" variant="light" onClick={() => setActiveDoc(doc)}>
                                  预览全文
                                </Button>
                              )}
                            </Group>
                          </Stack>
                        </PanelCard>
                      ))}
                    </SimpleGrid>
                  )}
              </Stack>
            </Stack>
          )}
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
