import React from 'react'
import { Badge, Button, Code, Group, Loader, Modal, ScrollArea, Select, Stack, Text, TextInput, Textarea } from '@mantine/core'
import {
  fetchAdminProjectWorkspaceContext,
  type ProjectWorkspaceContextDto,
  type ProjectWorkspaceContextFileDto,
  type ProjectWorkspaceContextFileVersionContentDto,
  fetchAdminGlobalWorkspaceContextFileVersion,
  fetchProjectWorkspaceContextFileVersion,
  rollbackAdminGlobalWorkspaceContextFile,
  rollbackProjectWorkspaceContextFile,
  updateAdminGlobalWorkspaceContextFile,
  updateProjectWorkspaceContextFile,
  type ProjectWorkspaceContextVerifyResponseDto,
  verifyProjectWorkspaceContext,
} from '../api/server'
import { toast } from './toast'
import type { AgentTraceContextSelection } from './AgentDiagnosticsContent'

type AgentProjectContextContentProps = {
  className?: string
  opened: boolean
  projectId?: string | null
  selection?: AgentTraceContextSelection | null
  canEditGlobal?: boolean
  canEditProject?: boolean
}

type ContextFileOption = {
  value: string
  label: string
}

type ProjectEditableFileName = 'PROJECT.md' | 'RULES.md' | 'CHARACTERS.md' | 'STORY_STATE.md'

export default function AgentProjectContextContent(props: AgentProjectContextContentProps): JSX.Element {
  const { className, opened, projectId, selection, canEditGlobal = false, canEditProject = false } = props
  const [bookId, setBookId] = React.useState('')
  const [chapter, setChapter] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [activePath, setActivePath] = React.useState<string>('')
  const [draftContent, setDraftContent] = React.useState('')
  const [data, setData] = React.useState<ProjectWorkspaceContextDto | null>(null)
  const [versionModalOpen, setVersionModalOpen] = React.useState(false)
  const [versionLoading, setVersionLoading] = React.useState(false)
  const [versionData, setVersionData] = React.useState<ProjectWorkspaceContextFileVersionContentDto | null>(null)
  const [verifyModalOpen, setVerifyModalOpen] = React.useState(false)
  const [verifyLoading, setVerifyLoading] = React.useState(false)
  const [verifyData, setVerifyData] = React.useState<ProjectWorkspaceContextVerifyResponseDto | null>(null)

  const load = React.useCallback(async (refresh: boolean, nextBookId?: string, nextChapter?: string) => {
    if (!opened || !projectId) return
    const effectiveBookId = typeof nextBookId === 'string' ? nextBookId : bookId
    const effectiveChapter = typeof nextChapter === 'string' ? nextChapter : chapter
    setLoading(true)
    try {
      const result = await fetchAdminProjectWorkspaceContext({
        projectId,
        ...(effectiveBookId.trim() ? { bookId: effectiveBookId.trim() } : {}),
        ...(effectiveChapter.trim() ? { chapter: Number(effectiveChapter.trim()) } : {}),
        ...(refresh ? { refresh: true } : {}),
      })
      setData(result)
      const nextActivePath = result.projectFiles[0]?.path || result.globalFiles[0]?.path || ''
      setActivePath((current) => {
        const available = [...result.projectFiles, ...result.globalFiles]
        return current && available.some((item) => item.path === current) ? current : nextActivePath
      })
    } catch (error) {
      toast(error instanceof Error ? error.message : '加载项目上下文失败', 'error')
    } finally {
      setLoading(false)
    }
  }, [opened, projectId, bookId, chapter])

  React.useEffect(() => {
    void load(false)
  }, [load])

  React.useEffect(() => {
    if (!selection) return
    const nextBookId = selection.bookId || ''
    const nextChapter = selection.chapter !== null ? String(selection.chapter) : ''
    setBookId(nextBookId)
    setChapter(nextChapter)
    if (!opened || !projectId) return
    void load(false, nextBookId, nextChapter)
  }, [selection, opened, projectId, load])

  const allFiles = React.useMemo(
    () => [...(data?.globalFiles || []), ...(data?.projectFiles || [])],
    [data],
  )
  const activeFile = React.useMemo(
    () => allFiles.find((item) => item.path === activePath) ?? allFiles[0] ?? null,
    [activePath, allFiles],
  )
  const fileOptions = React.useMemo<ContextFileOption[]>(() => allFiles.map((item) => ({
    value: item.path,
    label: `${item.layer === 'global' ? '[全局]' : '[项目]'} ${item.path}`,
  })), [allFiles])

  React.useEffect(() => {
    setDraftContent(activeFile?.content || '')
  }, [activeFile])

  const canEditActiveFile = React.useMemo(() => {
    if (!activeFile) return false
    return activeFile.layer === 'global' ? canEditGlobal : canEditProject
  }, [activeFile, canEditGlobal, canEditProject])

  const hasDraftChanged = activeFile ? draftContent !== activeFile.content : false

  const handleSave = React.useCallback(async () => {
    if (!activeFile || !projectId || !canEditActiveFile) return
    setSaving(true)
    try {
      const fileName = getFileNameFromPath(activeFile.path)
      if (activeFile.layer === 'global') {
        if (fileName !== 'GLOBAL_RULES.md') {
          throw new Error('仅支持保存 GLOBAL_RULES.md')
        }
        await updateAdminGlobalWorkspaceContextFile({ fileName, content: draftContent })
      } else {
        if (!isProjectEditableFileName(fileName)) {
          throw new Error('不支持保存该项目上下文文件')
        }
        await updateProjectWorkspaceContextFile({
          projectId,
          fileName,
          content: draftContent,
        })
      }
      toast('保存成功', 'success')
      await load(false)
    } catch (error) {
      toast(error instanceof Error ? error.message : '保存上下文失败', 'error')
    } finally {
      setSaving(false)
    }
  }, [activeFile, projectId, canEditActiveFile, draftContent, load])

  const handleViewVersion = React.useCallback(async (versionId: string) => {
    if (!activeFile || !projectId) return
    const fileName = getFileNameFromPath(activeFile.path)
    setVersionLoading(true)
    setVersionModalOpen(true)
    try {
      if (activeFile.layer === 'global') {
        if (fileName !== 'GLOBAL_RULES.md') throw new Error('仅支持查看 GLOBAL_RULES.md 版本')
        const result = await fetchAdminGlobalWorkspaceContextFileVersion({ fileName, versionId })
        setVersionData(result)
      } else {
        if (!isProjectEditableFileName(fileName)) throw new Error('不支持查看该项目上下文文件版本')
        const result = await fetchProjectWorkspaceContextFileVersion({ projectId, fileName, versionId })
        setVersionData(result)
      }
    } catch (error) {
      setVersionData(null)
      toast(error instanceof Error ? error.message : '加载历史版本失败', 'error')
    } finally {
      setVersionLoading(false)
    }
  }, [activeFile, projectId])

  const handleRollbackVersion = React.useCallback(async (versionId: string) => {
    if (!activeFile || !projectId) return
    if (!canEditActiveFile) {
      toast('当前无权限回滚该文件', 'error')
      return
    }
    const ok = window.confirm(`确定回滚当前文件到版本 ${versionId.slice(0, 16)}？这会覆盖当前内容，但会自动生成一条新的历史记录。`)
    if (!ok) return
    setSaving(true)
    try {
      const fileName = getFileNameFromPath(activeFile.path)
      if (activeFile.layer === 'global') {
        if (fileName !== 'GLOBAL_RULES.md') throw new Error('仅支持回滚 GLOBAL_RULES.md')
        await rollbackAdminGlobalWorkspaceContextFile({ fileName, versionId })
      } else {
        if (!isProjectEditableFileName(fileName)) throw new Error('不支持回滚该项目上下文文件')
        await rollbackProjectWorkspaceContextFile({ projectId, fileName, versionId })
      }
      toast('回滚成功', 'success')
      await load(false)
    } catch (error) {
      toast(error instanceof Error ? error.message : '回滚失败', 'error')
    } finally {
      setSaving(false)
    }
  }, [activeFile, projectId, canEditActiveFile, load])

  const handleVerify = React.useCallback(async () => {
    if (!projectId) return
    setVerifyModalOpen(true)
    setVerifyLoading(true)
    try {
      const result = await verifyProjectWorkspaceContext({ projectId })
      setVerifyData(result)
    } catch (error) {
      setVerifyData(null)
      toast(error instanceof Error ? error.message : '规则自检失败', 'error')
    } finally {
      setVerifyLoading(false)
    }
  }, [projectId])

  return (
    <Stack className={className} gap="md">
      <Group className="agent-project-context-panel-filters" gap="sm" align="flex-end" wrap="wrap">
        <TextInput className="agent-project-context-panel-project-input" label="项目 ID" value={projectId || ''} readOnly w={220} />
        <TextInput className="agent-project-context-panel-book-input" label="书籍 ID" placeholder="可选" value={bookId} onChange={(event) => setBookId(event.currentTarget.value)} w={220} />
        <TextInput className="agent-project-context-panel-chapter-input" label="章节" placeholder="可选" value={chapter} onChange={(event) => setChapter(event.currentTarget.value)} w={120} />
        <Button className="agent-project-context-panel-load-button" variant="light" onClick={() => void load(false)} loading={loading}>查看</Button>
        <Button className="agent-project-context-panel-refresh-button" variant="light" color="grape" onClick={() => void load(true)} loading={loading}>刷新生成</Button>
        <Button className="agent-project-context-panel-verify-button" variant="light" color="teal" onClick={() => void handleVerify()} loading={verifyLoading}>
          规则自检
        </Button>
      </Group>

      <Group className="agent-project-context-panel-summary" gap="xs" wrap="wrap">
        <Text className="agent-project-context-panel-root" size="sm" c="dimmed">全局：{data?.globalContextDir || '.tapcanvas/context'}</Text>
        <Text className="agent-project-context-panel-root" size="sm" c="dimmed">项目：{data?.projectContextDir || '暂无项目上下文目录'}</Text>
        <Badge className="agent-project-context-panel-global-count" variant="light" color="gray">全局 {data?.globalFiles.length || 0}</Badge>
        <Badge className="agent-project-context-panel-project-count" variant="light" color="blue">项目 {data?.projectFiles.length || 0}</Badge>
        {selection?.traceId ? <Badge className="agent-project-context-panel-trace-badge" variant="light" color="blue">trace {selection.traceId.slice(0, 8)}</Badge> : null}
        {selection?.label ? <Badge className="agent-project-context-panel-label-badge" variant="light" color="grape">{selection.label}</Badge> : null}
      </Group>

      <Select className="agent-project-context-panel-file-select" label="上下文文件" placeholder="选择文件" data={fileOptions} value={activeFile?.path || null} onChange={(value) => setActivePath(value || '')} searchable nothingFoundMessage="暂无文件" />

      <ContextLayerHint activeFile={activeFile} canEditGlobal={canEditGlobal} canEditProject={canEditProject} />

      {activeFile ? (
        <Group className="agent-project-context-panel-meta" gap="xs" wrap="wrap">
          <Badge className="agent-project-context-panel-updated-at" variant="light" color="teal">更新时间 {activeFile.updatedAt || '—'}</Badge>
          <Badge className="agent-project-context-panel-updated-by" variant="light" color="cyan">修改人 {activeFile.updatedBy || '—'}</Badge>
          <Badge className="agent-project-context-panel-history-count" variant="light" color="violet">历史 {activeFile.history.length}</Badge>
        </Group>
      ) : null}

      <Group className="agent-project-context-panel-actions" gap="sm" justify="space-between" wrap="wrap">
        <Text className="agent-project-context-panel-editability" size="sm" c="dimmed">{canEditActiveFile ? '当前文件可编辑' : '当前文件只读'}</Text>
        <Button className="agent-project-context-panel-save-button" variant="light" color="blue" onClick={() => void handleSave()} loading={saving} disabled={!canEditActiveFile || !hasDraftChanged}>保存修改</Button>
      </Group>

      {activeFile?.history.length ? (
        <ScrollArea className="agent-project-context-panel-history-scroll" h={120} offsetScrollbars>
          <Stack className="agent-project-context-panel-history" gap={6}>
            {activeFile.history.map((item) => (
              <Group className="agent-project-context-panel-history-row" key={item.versionId} gap="xs" wrap="wrap">
                <Badge className="agent-project-context-panel-history-version" variant="outline">{item.versionId.slice(0, 16)}</Badge>
                <Text className="agent-project-context-panel-history-time" size="xs" c="dimmed">{item.updatedAt}</Text>
                <Text className="agent-project-context-panel-history-user" size="xs" c="dimmed">{item.updatedBy}</Text>
                <Button className="agent-project-context-panel-history-view" size="compact-xs" variant="subtle" onClick={() => void handleViewVersion(item.versionId)}>
                  查看
                </Button>
                <Button
                  className="agent-project-context-panel-history-rollback"
                  size="compact-xs"
                  variant="subtle"
                  color="red"
                  disabled={!canEditActiveFile}
                  onClick={() => void handleRollbackVersion(item.versionId)}
                >
                  回滚
                </Button>
              </Group>
            ))}
          </Stack>
        </ScrollArea>
      ) : null}

      <Modal
        className="agent-project-context-panel-version-modal"
        opened={versionModalOpen}
        onClose={() => setVersionModalOpen(false)}
        title="历史版本"
        centered={false}
        size="xl"
        padding="md"
      >
        <Stack className="agent-project-context-panel-version-stack" gap="sm">
          {versionLoading ? <Loader className="agent-project-context-panel-version-loader" size="sm" /> : null}
          {versionData ? (
            <>
              <Group className="agent-project-context-panel-version-meta" gap="xs" wrap="wrap">
                <Badge className="agent-project-context-panel-version-id" variant="light" color="violet">{versionData.versionId}</Badge>
                <Badge className="agent-project-context-panel-version-file" variant="light">{versionData.fileName}</Badge>
                <Badge className="agent-project-context-panel-version-layer" variant="outline">{versionData.layer}</Badge>
                <Text className="agent-project-context-panel-version-time" size="xs" c="dimmed">{versionData.updatedAt}</Text>
                <Text className="agent-project-context-panel-version-user" size="xs" c="dimmed">{versionData.updatedBy}</Text>
              </Group>
              <Group className="agent-project-context-panel-version-actions" gap="sm" justify="flex-end" wrap="wrap">
                <Button
                  className="agent-project-context-panel-version-load-draft"
                  variant="light"
                  onClick={() => {
                    setDraftContent(versionData.content)
                    setVersionModalOpen(false)
                  }}
                >
                  载入到编辑器
                </Button>
                <Button
                  className="agent-project-context-panel-version-rollback"
                  variant="light"
                  color="red"
                  disabled={!canEditActiveFile}
                  onClick={() => void handleRollbackVersion(versionData.versionId)}
                >
                  回滚为当前
                </Button>
              </Group>
              <Code className="agent-project-context-panel-version-content" block style={{ whiteSpace: 'pre-wrap', lineHeight: 1.55, padding: 12 }}>
                {versionData.content}
              </Code>
              {activeFile ? (
                <Code className="agent-project-context-panel-version-current" block style={{ whiteSpace: 'pre-wrap', lineHeight: 1.55, padding: 12, opacity: 0.9 }}>
                  {activeFile.content}
                </Code>
              ) : null}
            </>
          ) : (
            !versionLoading ? <Text className="agent-project-context-panel-version-empty" c="dimmed" size="sm">暂无版本内容</Text> : null
          )}
        </Stack>
      </Modal>

      <Modal
        className="agent-project-context-panel-verify-modal"
        opened={verifyModalOpen}
        onClose={() => setVerifyModalOpen(false)}
        title="规则自检（将被注入的有效上下文）"
        centered={false}
        size="xl"
        padding="md"
      >
        <Stack className="agent-project-context-panel-verify-stack" gap="sm">
          {verifyLoading ? <Loader className="agent-project-context-panel-verify-loader" size="sm" /> : null}
          {verifyData ? (
            <>
              <Group className="agent-project-context-panel-verify-meta" gap="xs" wrap="wrap">
                <Badge className="agent-project-context-panel-verify-total" variant="light" color="teal">
                  totalChars {verifyData.totalChars}/{verifyData.budgets.maxTotalChars}
                </Badge>
                <Badge className="agent-project-context-panel-verify-budget" variant="light" color="gray">
                  maxCharsPerFile {verifyData.budgets.maxCharsPerFile}
                </Badge>
                <Badge className="agent-project-context-panel-verify-files" variant="light" color="blue">
                  files {verifyData.files.length}
                </Badge>
              </Group>
              {verifyData.warnings.length ? (
                <Stack className="agent-project-context-panel-verify-warnings" gap={4}>
                  {verifyData.warnings.map((w) => (
                    <Text key={w} className="agent-project-context-panel-verify-warning" size="sm" c="yellow">
                      {w}
                    </Text>
                  ))}
                </Stack>
              ) : null}
              <ScrollArea className="agent-project-context-panel-verify-scroll" h={420} offsetScrollbars>
                <Stack className="agent-project-context-panel-verify-files-list" gap="xs">
                  {verifyData.files.map((f) => (
                    <Group key={`${f.layer}:${f.path}`} className="agent-project-context-panel-verify-file-row" gap="xs" wrap="wrap">
                      <Badge variant="outline">{f.layer}</Badge>
                      <Text size="sm">{f.path}</Text>
                      <Badge variant="light" color={f.truncated ? 'red' : 'teal'}>{f.charCount} chars{f.truncated ? ' (truncated)' : ''}</Badge>
                      <Text size="xs" c="dimmed">{f.updatedAt || ''}</Text>
                      <Text size="xs" c="dimmed">{f.updatedBy || ''}</Text>
                    </Group>
                  ))}
                </Stack>
              </ScrollArea>
            </>
          ) : (
            !verifyLoading ? <Text className="agent-project-context-panel-verify-empty" c="dimmed" size="sm">暂无自检数据</Text> : null
          )}
        </Stack>
      </Modal>

      <ScrollArea className="agent-project-context-panel-scroll" h={360} offsetScrollbars>
        <Stack className="agent-project-context-panel-content" gap="sm">
          {loading ? <Loader className="agent-project-context-panel-loader" size="sm" /> : null}
          {!loading && allFiles.length === 0 ? <Text className="agent-project-context-panel-empty" c="dimmed" size="sm">暂无上下文文件</Text> : null}
          {activeFile ? (
            <>
              <Textarea className="agent-project-context-panel-editor" value={draftContent} onChange={(event) => setDraftContent(event.currentTarget.value)} autosize minRows={14} maxRows={24} readOnly={!canEditActiveFile} />
              <Code className="agent-project-context-panel-code-preview" block style={{ whiteSpace: 'pre-wrap', lineHeight: 1.55, padding: 12 }}>{draftContent}</Code>
            </>
          ) : null}
        </Stack>
      </ScrollArea>
    </Stack>
  )
}

function ContextLayerHint(props: { activeFile: ProjectWorkspaceContextFileDto | null; canEditGlobal: boolean; canEditProject: boolean }): JSX.Element | null {
  const { activeFile, canEditGlobal, canEditProject } = props
  if (!activeFile) return null
  if (activeFile.layer === 'global') {
    return <Text className="agent-project-context-panel-layer-hint" size="sm" c="dimmed">当前查看的是平台全局规则：对所有项目生效。{canEditGlobal ? '你具备管理员权限，可编辑。' : '仅平台管理员可编辑。'}</Text>
  }
  return <Text className="agent-project-context-panel-layer-hint" size="sm" c="dimmed">当前查看的是项目专属上下文：只对当前项目生效。{canEditProject ? '你具备项目编辑权限，可保存修改。' : '仅项目 owner 或管理员可编辑。'}</Text>
}

function getFileNameFromPath(filePath: string): string {
  const parts = filePath.split('/')
  return parts[parts.length - 1] || ''
}

function isProjectEditableFileName(value: string): value is ProjectEditableFileName {
  return value === 'PROJECT.md' || value === 'RULES.md' || value === 'CHARACTERS.md' || value === 'STORY_STATE.md'
}
