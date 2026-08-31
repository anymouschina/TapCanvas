import React from 'react'
import { ActionIcon, Button, Group, Text, Textarea, Tooltip } from '@mantine/core'
import { IconFileText, IconRefresh, IconX } from '@tabler/icons-react'
import type { ShotTableData } from '@tapcanvas/shot-table-protocol'
import { useModelOptionsState } from '../../../../config/useModelOptions'
import {
  readStoredChatModelValue,
  requireSelectedChatModelRequest,
} from '../../../../ui/chat/chatModelSelection'
import { extractTextFromFile, SUPPORTED_TEXT_ACCEPT } from '../../../../ui/chat/textFileImport'
import {
  generateShotTableWithStoryboardSkill,
  loadStoryboardExpertSkill,
  STORYBOARD_EXPERT_SKILL_KEY,
  type StoryboardExpertSkill,
} from './storyboardSkillGeneration'

export type ShotTableScriptPanelProps = {
  className: string
  nodeId: string
  table: ShotTableData
  readOnly: boolean
  replacementBlockedReason: string
  onClose: () => void
  onGenerated: (result: {
    table: ShotTableData
    rawText: string
    model: string
    skillKey: string
    skillName: string
  }) => void
}

const errorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message.trim() ? error.message.trim() : fallback

export function ShotTableScriptPanel({
  className,
  nodeId,
  table,
  readOnly,
  replacementBlockedReason,
  onClose,
  onGenerated,
}: ShotTableScriptPanelProps): JSX.Element {
  const chatModelState = useModelOptionsState('text', { enabled: !readOnly })
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const [skill, setSkill] = React.useState<StoryboardExpertSkill | null>(null)
  const [script, setScript] = React.useState('')
  const [loadingSkill, setLoadingSkill] = React.useState(false)
  const [generating, setGenerating] = React.useState(false)
  const [error, setError] = React.useState('')

  const loadSkill = React.useCallback(async (): Promise<void> => {
    setLoadingSkill(true)
    setError('')
    try {
      setSkill(await loadStoryboardExpertSkill())
    } catch (loadError: unknown) {
      setSkill(null)
      setError(errorMessage(loadError, '加载分镜 Skill 失败。'))
    } finally {
      setLoadingSkill(false)
    }
  }, [])

  React.useEffect(() => { void loadSkill() }, [loadSkill])

  const handleFile = React.useCallback(async (file: File | null): Promise<void> => {
    if (!file) return
    setError('')
    try {
      const text = await extractTextFromFile(file)
      if (!text.trim()) throw new Error(`文件“${file.name}”没有可用文本。`)
      setScript(text)
    } catch (fileError: unknown) {
      setError(errorMessage(fileError, '读取剧本文件失败。'))
    }
  }, [])

  const handleGenerate = React.useCallback(async (): Promise<void> => {
    if (replacementBlockedReason) {
      setError(replacementBlockedReason)
      return
    }
    const trimmedScript = script.trim()
    if (!trimmedScript) {
      setError('请粘贴剧本或导入文本文件。')
      return
    }
    if (!skill) {
      setError(`必需的官方 Skill 当前不可执行：${STORYBOARD_EXPERT_SKILL_KEY}。`)
      return
    }
    if (chatModelState.loading) {
      setError('小T 语言模型目录仍在加载，请等待加载完成后重试。')
      return
    }
    if (chatModelState.error) {
      setError(`小T 语言模型目录加载失败：${chatModelState.error.message}`)
      return
    }
    setGenerating(true)
    setError('')
    try {
      const languageModel = requireSelectedChatModelRequest(
        chatModelState.options,
        readStoredChatModelValue(),
      )
      const result = await generateShotTableWithStoryboardSkill({
        nodeId,
        columns: table.columns,
        source: { kind: 'script', text: trimmedScript },
        languageModel,
      })
      setSkill({ id: skill.id, key: result.skillKey, name: result.skillName })
      onGenerated(result)
    } catch (generationError: unknown) {
      setError(errorMessage(generationError, '剧本转分镜失败。'))
    } finally {
      setGenerating(false)
    }
  }, [chatModelState.error, chatModelState.loading, chatModelState.options, nodeId, onGenerated, replacementBlockedReason, script, skill, table.columns])

  return (
    <section className={`tc-shot-table-script nodrag nopan nowheel ${className}`} aria-label="剧本转分镜">
      <div className="tc-shot-table-script__header">
        <div className="tc-shot-table-script__title-group">
          <Text className="tc-shot-table-script__title" size="sm" fw={650}>剧本转分镜</Text>
          <Text className="tc-shot-table-script__subtitle" size="xs" c="dimmed">
            固定由分镜专家 Skill 负责创作、自检与当前表结构交付
          </Text>
        </div>
        <Tooltip className="tc-shot-table-script__tooltip" label="关闭">
          <ActionIcon className="tc-shot-table-script__icon-button" variant="subtle" size="sm" onClick={onClose} aria-label="关闭剧本转分镜">
            <IconX className="tc-shot-table-script__icon" size={15} />
          </ActionIcon>
        </Tooltip>
      </div>
      <Group className="tc-shot-table-script__skill-row" gap={6} wrap="nowrap">
        <Text className="tc-shot-table-script__skill-fixed" size="xs" c={skill ? 'dimmed' : 'red'}>
          {loadingSkill
            ? '正在验证官方分镜 Skill…'
            : skill
              ? `固定 Skill · ${skill.name}`
              : `不可执行 · ${STORYBOARD_EXPERT_SKILL_KEY}`}
        </Text>
        <Tooltip className="tc-shot-table-script__tooltip" label="刷新 Skill 状态">
          <ActionIcon
            className="tc-shot-table-script__icon-button"
            variant="subtle"
            size="sm"
            loading={loadingSkill}
            disabled={generating}
            onClick={() => { void loadSkill() }}
            aria-label="刷新分镜 Skill 状态"
          >
            <IconRefresh className="tc-shot-table-script__icon" size={15} />
          </ActionIcon>
        </Tooltip>
        <Tooltip className="tc-shot-table-script__tooltip" label="导入 txt、md 或 docx">
          <ActionIcon
            className="tc-shot-table-script__icon-button"
            variant="subtle"
            size="sm"
            disabled={readOnly || generating}
            onClick={() => fileInputRef.current?.click()}
            aria-label="导入剧本文件"
          >
            <IconFileText className="tc-shot-table-script__icon" size={15} />
          </ActionIcon>
        </Tooltip>
        <input
          className="tc-shot-table-script__file-input"
          ref={fileInputRef}
          type="file"
          accept={SUPPORTED_TEXT_ACCEPT}
          onChange={(event) => {
            void handleFile(event.currentTarget.files?.[0] ?? null)
            event.currentTarget.value = ''
          }}
        />
      </Group>
      <Textarea
        className="tc-shot-table-script__textarea nodrag nopan nowheel"
        autosize
        minRows={5}
        maxRows={12}
        value={script}
        readOnly={readOnly || generating}
        onChange={(event) => setScript(event.currentTarget.value)}
        placeholder="粘贴剧本，或导入 .txt / .md / .docx"
        aria-label="剧本原文"
      />
      {replacementBlockedReason ? (
        <Text className="tc-shot-table-script__error" size="xs" c="red">{replacementBlockedReason}</Text>
      ) : error ? <Text className="tc-shot-table-script__error" size="xs" c="red">{error}</Text> : null}
      <Button
        className="tc-shot-table-script__generate-button"
        size="compact-sm"
        variant="light"
        loading={generating}
        disabled={readOnly || Boolean(replacementBlockedReason) || loadingSkill || chatModelState.loading || !skill || !script.trim()}
        onClick={() => { void handleGenerate() }}
      >
        生成并保存上一版本
      </Button>
    </section>
  )
}
