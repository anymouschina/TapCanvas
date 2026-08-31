import React from 'react'
import { createPortal } from 'react-dom'
import {
  ActionIcon,
  Box,
  Button,
  Group,
  Popover,
  Stack,
  Text,
  Textarea,
  Tooltip,
} from '@mantine/core'
import {
  IconCheck,
  IconChevronDown,
  IconFileText,
  IconUpload,
} from '@tabler/icons-react'
import {
  getActiveProjectLookBible,
  type ActiveProjectLookBibleSummary,
} from '../../api/server'
import { useUIStore } from '../uiStore'
import { toast } from '../toast'
import { useChatCommandStore } from '../chat/chatCommandStore'
import { buildProjectLookBibleChatCommand } from './projectLookBibleChatCommand'
import { useRFStore } from '../../canvas/store'
import { saveCurrentCanvasSnapshot } from '../../canvas/persistence/saveCurrentCanvasSnapshot'

const MAX_SOURCE_CHARACTERS = 120_000
const ACCEPTED_FILE_EXTENSIONS = ['.txt', '.md', '.markdown'] as const

function isAcceptedTextFile(file: File): boolean {
  const lowerName = file.name.toLowerCase()
  return ACCEPTED_FILE_EXTENSIONS.some((extension) => lowerName.endsWith(extension))
}

export type ProjectLookBibleChipProps = {
  projectId?: string
  portalTargetId?: string | null
  embedded?: boolean
  onApplied?: () => void
}

export function ProjectLookBibleChip({
  projectId: explicitProjectId,
  portalTargetId = 'tc-canvas-visibility-slot',
  embedded = false,
  onApplied,
}: ProjectLookBibleChipProps): JSX.Element | null {
  const currentProjectId = useUIStore((state) => String(state.currentProject?.id || '').trim())
  const projectId = String(explicitProjectId || currentProjectId).trim()
  const [opened, setOpened] = React.useState(false)
  const [portalTarget, setPortalTarget] = React.useState<HTMLElement | null>(null)
  const [sourceText, setSourceText] = React.useState('')
  const [fileName, setFileName] = React.useState<string | null>(null)
  const [active, setActive] = React.useState<ActiveProjectLookBibleSummary | null>(null)
  const [loadingActive, setLoadingActive] = React.useState(false)
  const [applying, setApplying] = React.useState(false)
  const [loadError, setLoadError] = React.useState('')
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const addNode = useRFStore((state) => state.addNode)

  const refreshActive = React.useCallback(async () => {
    if (!projectId) return
    setLoadingActive(true)
    setLoadError('')
    try {
      setActive(await getActiveProjectLookBible(projectId))
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      setLoadError(message)
    } finally {
      setLoadingActive(false)
    }
  }, [projectId])

  React.useEffect(() => {
    if (embedded || portalTargetId === null) {
      setPortalTarget(null)
      return
    }
    setPortalTarget(document.getElementById(portalTargetId))
  }, [embedded, portalTargetId])

  React.useEffect(() => {
    setActive(null)
    setLoadError('')
    if (projectId) void refreshActive()
  }, [projectId, refreshActive])

  React.useEffect(() => {
    if (opened && !embedded) void refreshActive()
  }, [embedded, opened, refreshActive])

  const handleFileChange = React.useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    if (!isAcceptedTextFile(file)) {
      toast('项目视觉圣经只接受 .txt、.md 或 .markdown 文本文件', 'error')
      return
    }
    try {
      const text = (await file.text()).trim()
      if (!text) throw new Error('文件内容为空')
      if (Array.from(text).length > MAX_SOURCE_CHARACTERS) {
        throw new Error(`影调文本超过 ${MAX_SOURCE_CHARACTERS.toLocaleString()} 字符上限`)
      }
      setSourceText(text)
      setFileName(file.name)
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : '影调文件读取失败', 'error')
    }
  }, [])

  const handleApply = React.useCallback(async () => {
    if (applying) return
    const normalizedText = sourceText.trim()
    if (!normalizedText) {
      toast('请先上传或粘贴项目视觉规则文本', 'error')
      return
    }
    if (Array.from(normalizedText).length > MAX_SOURCE_CHARACTERS) {
      toast(`影调文本超过 ${MAX_SOURCE_CHARACTERS.toLocaleString()} 字符上限`, 'error')
      return
    }
    const sourceNodeId = globalThis.crypto.randomUUID()
    const sourceLabel = fileName ? `项目视觉圣经｜${fileName}` : '项目视觉圣经｜粘贴文本'
    addNode('taskNode', sourceLabel, {
      nodeId: sourceNodeId,
      autoLabel: false,
      kind: 'text',
      productionLayer: 'anchors',
      semanticKind: 'projectLookBible',
      content: normalizedText,
      sourceKind: fileName ? 'uploaded_text_file' : 'pasted_text',
      sourceFileName: fileName,
      projectLookBibleStatus: 'pending_confirmation',
    })
    setApplying(true)
    try {
      if (!(await saveCurrentCanvasSnapshot())) {
        throw new Error('当前画布没有可用的持久化能力')
      }
      useChatCommandStore.getState().dispatchSend({
        text: buildProjectLookBibleChatCommand({
          fileName,
          sourceKind: fileName ? 'uploaded_text_file' : 'pasted_text',
          sourceNodeId,
          sourceText: normalizedText,
        }),
        displayText: fileName
          ? `应用项目视觉规范：${fileName}`
          : '应用刚刚粘贴的项目视觉规范',
        requiredSkills: ['tapcanvas-style-pack'],
        executionToolPolicy: {
          mode: 'restricted',
          allowedTools: [
            'tapcanvas_project_look_bible_get',
            'tapcanvas_project_look_bible_confirm',
          ],
        },
        attachCanvasContext: true,
        freshConversation: true,
      })
      setOpened(false)
      onApplied?.()
      toast('项目视觉规则已保存并交给小T解析；应用结果见右侧对话', 'info')
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      toast(`原文节点保存失败，未启动小T：${message}`, 'error')
    } finally {
      setApplying(false)
    }
  }, [addNode, applying, fileName, onApplied, sourceText])

  if (!projectId) return null

  const triggerLabel = active ? `项目视觉 V${active.revision}` : '项目视觉'
  const panel = (
        <Stack className="project-look-bible-panel" gap="sm" style={{ width: 520, maxWidth: '86vw' }}>
          <div className="project-look-bible-heading">
            <Text className="project-look-bible-title" size="sm" fw={650}>项目视觉圣经</Text>
            <Text className="project-look-bible-caption" size="xs" c="dimmed">
              上传或粘贴影调、色调、灯光、时代等规则；小T保留未覆盖维度并创建新版本。
            </Text>
          </div>

          {active ? (
            <Box className="project-look-bible-active" style={{ background: 'var(--tc-color-surface-inline)', padding: 12 }}>
              <Group className="project-look-bible-active-row" justify="space-between" align="flex-start" wrap="nowrap">
                <div className="project-look-bible-active-copy">
                  <Text className="project-look-bible-active-name" size="sm" fw={600}>{active.name}</Text>
                  <Text className="project-look-bible-active-summary" size="xs" c="dimmed" lineClamp={2}>{active.summary}</Text>
                </div>
                <Text className="project-look-bible-active-version" size="xs" c="dimmed">V{active.revision} · {active.sectionCount} 个维度</Text>
              </Group>
            </Box>
          ) : loadingActive ? (
            <Text className="project-look-bible-loading" size="xs" c="dimmed">读取当前项目视觉圣经…</Text>
          ) : (
            <Text className="project-look-bible-empty" size="xs" c="dimmed">当前项目尚未应用视觉圣经。</Text>
          )}

          <input
            ref={fileInputRef}
            className="project-look-bible-file-input"
            type="file"
            accept=".txt,.md,.markdown,text/plain,text/markdown"
            hidden
            onChange={handleFileChange}
          />
          <Group className="project-look-bible-source-actions" gap="xs">
            <Button
              className="project-look-bible-upload"
              size="compact-sm"
              variant="subtle"
              leftSection={<IconUpload className="project-look-bible-upload-icon" size={14} />}
              onClick={() => fileInputRef.current?.click()}
            >
              上传 .txt / .md
            </Button>
            {fileName ? <Text className="project-look-bible-file-name" size="xs" c="dimmed" lineClamp={1}>{fileName}</Text> : null}
          </Group>
          <Textarea
            className="project-look-bible-textarea"
            value={sourceText}
            onChange={(event) => {
              setSourceText(event.currentTarget.value)
              if (fileName) setFileName(null)
            }}
            placeholder="粘贴项目影调、色调、灯光、时代或其他视觉规则…"
            autosize
            minRows={7}
            maxRows={14}
          />
          <Group className="project-look-bible-footer" justify="space-between" align="center" wrap="nowrap">
            <Text className="project-look-bible-count" size="xs" c={Array.from(sourceText).length > MAX_SOURCE_CHARACTERS ? 'red' : 'dimmed'}>
              {Array.from(sourceText).length.toLocaleString()} / {MAX_SOURCE_CHARACTERS.toLocaleString()}
            </Text>
            <Button
              className="project-look-bible-apply"
              size="sm"
              disabled={applying || !sourceText.trim() || Array.from(sourceText).length > MAX_SOURCE_CHARACTERS}
              loading={applying}
              onClick={() => void handleApply()}
            >
              交给小T确定并应用
            </Button>
          </Group>
          {loadError ? <Text className="project-look-bible-error" size="xs" c="red">{loadError}</Text> : null}
        </Stack>
  )

  if (embedded) return panel

  const chip = (
    <Popover
      className="project-look-bible-popover"
      opened={opened}
      onChange={setOpened}
      position="bottom-end"
      shadow="md"
      radius="sm"
      withinPortal
      trapFocus={false}
    >
      <Popover.Target>
        {portalTargetId === null ? (
          <Tooltip className="project-look-bible-inline-tooltip" label={triggerLabel} withArrow>
            <ActionIcon
              className="project-look-bible-inline-trigger"
              variant="subtle"
              aria-label={triggerLabel}
              onClick={() => setOpened((current) => !current)}
            >
              <IconFileText className="project-look-bible-inline-icon" size={18} />
            </ActionIcon>
          </Tooltip>
        ) : (
          <Box
            className="project-look-bible-chip"
            onClick={() => setOpened((current) => !current)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 10px',
              borderRadius: 6,
              cursor: 'pointer',
              background: 'var(--tc-color-surface-raised, var(--mantine-color-body))',
              border: '1px solid var(--tc-color-border-subtle, var(--mantine-color-gray-3))',
              color: 'var(--tc-color-text-primary, inherit)',
            }}
          >
            {active ? (
              <IconCheck className="project-look-bible-chip-icon" size={14} />
            ) : (
              <IconFileText className="project-look-bible-chip-icon" size={14} />
            )}
            <Text className="project-look-bible-chip-label" size="xs" fw={500}>{triggerLabel}</Text>
            <IconChevronDown className="project-look-bible-chip-chevron" size={14} />
          </Box>
        )}
      </Popover.Target>
      <Popover.Dropdown className="project-look-bible-dropdown" p="md">
        {panel}
      </Popover.Dropdown>
    </Popover>
  )

  return portalTargetId === null ? chip : (portalTarget ? createPortal(chip, portalTarget) : null)
}
