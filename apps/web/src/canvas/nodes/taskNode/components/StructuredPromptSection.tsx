import React from 'react'
import { Button, Group, Stack, Text, Textarea } from '@mantine/core'
import {
  compileImagePromptSpecV2,
  parseImagePromptSpecV2,
  type ImagePromptSpecV2,
} from '@tapcanvas/image-prompt-spec'

type StructuredPromptSectionProps = {
  structuredValue: unknown
  loading?: boolean
  externalError?: string | null
  onCommit: (patch: { structuredPrompt: ImagePromptSpecV2; prompt: string }) => void
  onRefine?: () => void
}

function formatStructuredDraft(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return ''
  }
}

export function StructuredPromptSection({
  structuredValue,
  loading = false,
  externalError,
  onCommit,
  onRefine,
}: StructuredPromptSectionProps) {
  const [draft, setDraft] = React.useState<string>(() => formatStructuredDraft(structuredValue))
  const [localError, setLocalError] = React.useState<string>('')

  React.useEffect(() => {
    setDraft(formatStructuredDraft(structuredValue))
    setLocalError('')
  }, [structuredValue])

  const commitDraft = React.useCallback(() => {
    const trimmed = draft.trim()
    if (!trimmed) {
      setLocalError('structuredPrompt 不能为空。')
      return
    }

    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(trimmed) as unknown
    } catch (errorValue) {
      const message = errorValue instanceof Error ? errorValue.message : '未知 JSON 解析错误'
      setLocalError(`JSON 解析失败：${message}`)
      return
    }

    const parsedSpec = parseImagePromptSpecV2(parsedJson)
    if (!parsedSpec.ok || !parsedSpec.value) {
      const reason = parsedSpec.ok ? '缺少有效结构化内容' : parsedSpec.error
      setLocalError(reason)
      return
    }

    const normalizedSpec = parsedSpec.value
    const compiledPrompt = compileImagePromptSpecV2(normalizedSpec).trim()
    onCommit({
      structuredPrompt: normalizedSpec,
      prompt: compiledPrompt,
    })
    setDraft(JSON.stringify(normalizedSpec, null, 2))
    setLocalError('')
  }, [draft, onCommit])

  const errorMessage = localError || externalError || ''

  return (
    <Stack className="task-node-structured-prompt__root" gap={6}>
      {onRefine ? (
        <Group className="task-node-structured-prompt__header" justify="flex-end" gap={8}>
          <Button
            className="task-node-structured-prompt__refine-button"
            size="compact-xs"
            variant="light"
            loading={loading}
            onClick={onRefine}
          >
            AI 润色
          </Button>
        </Group>
      ) : null}
      <Textarea
        className="task-node-structured-prompt__textarea"
        aria-label="结构化提示词 JSON"
        autosize
        minRows={8}
        maxRows={14}
        value={draft}
        disabled={loading}
        onChange={(event) => {
          setDraft(event.currentTarget.value)
          if (localError) setLocalError('')
        }}
        onBlur={commitDraft}
        placeholder={`{\n  "version": "v2",\n  "shotIntent": "...",\n  "spatialLayout": ["..."],\n  "subjectRelations": [],\n  "environmentObjects": [],\n  "cameraPlan": ["..."],\n  "lightingPlan": ["..."],\n  "styleConstraints": [],\n  "continuityConstraints": [],\n  "negativeConstraints": []\n}`}
      />
      {errorMessage ? (
        <Text className="task-node-structured-prompt__error" size="xs" c="red">
          {errorMessage}
        </Text>
      ) : null}
    </Stack>
  )
}
