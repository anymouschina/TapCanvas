import React from 'react'
import { Button, Group, Stack, Text, Textarea, TextInput } from '@mantine/core'

export type ManualChapterDraftInput = {
  title: string
  summary: string
}

type ManualChapterEditorProps = {
  mode: 'create' | 'edit'
  identity: string
  initialTitle?: string
  initialSummary?: string
  saving: boolean
  onCancel: () => void
  onSubmit: (input: ManualChapterDraftInput) => void
}

const MAX_CHAPTER_SOURCE_LENGTH = 5000

export function ManualChapterEditor({
  mode,
  identity,
  initialTitle = '',
  initialSummary = '',
  saving,
  onCancel,
  onSubmit,
}: ManualChapterEditorProps): JSX.Element {
  const [title, setTitle] = React.useState(initialTitle)
  const [summary, setSummary] = React.useState(initialSummary)

  React.useEffect(() => {
    setTitle(initialTitle)
    setSummary(initialSummary)
  }, [identity, initialSummary, initialTitle])

  const normalizedTitle = title.trim()
  const submitLabel = mode === 'create' ? '创建并进入' : '保存本章'

  return (
    <form
      className="manual-chapter-editor"
      onSubmit={(event) => {
        event.preventDefault()
        if (!normalizedTitle || saving) return
        onSubmit({ title: normalizedTitle, summary: summary.trim() })
      }}
    >
      <Stack className="manual-chapter-editor__content" gap={8}>
        <Group className="manual-chapter-editor__heading" justify="space-between" wrap="nowrap">
          <Text className="manual-chapter-editor__title" size="xs" fw={600}>
            {mode === 'create' ? '手动创建章节' : '编辑本章构思'}
          </Text>
          <Text className="manual-chapter-editor__counter" size="xs" c="dimmed">
            {summary.length}/{MAX_CHAPTER_SOURCE_LENGTH}
          </Text>
        </Group>
        <TextInput
          className="manual-chapter-editor__title-input"
          label="章节标题"
          placeholder="例如：第一次登录《方舟》"
          value={title}
          maxLength={200}
          disabled={saving}
          autoFocus
          onChange={(event) => setTitle(event.currentTarget.value)}
        />
        <Textarea
          className="manual-chapter-editor__source-input"
          label="本章构思或正文"
          description="可以先写一句剧情目标，之后再回来补全；本章画布会独立保存。"
          placeholder="例如：30 秒内交代蜂窝城、资源交易与主角首次进入方舟，并在结尾留下虚拟世界影响现实的证据。"
          value={summary}
          maxLength={MAX_CHAPTER_SOURCE_LENGTH}
          minRows={4}
          maxRows={10}
          autosize
          disabled={saving}
          onChange={(event) => setSummary(event.currentTarget.value)}
        />
        <Group className="manual-chapter-editor__actions" justify="flex-end" gap={6} wrap="nowrap">
          <Button
            className="manual-chapter-editor__cancel"
            size="compact-xs"
            variant="subtle"
            disabled={saving}
            onClick={onCancel}
          >
            取消
          </Button>
          <Button
            className="manual-chapter-editor__submit"
            size="compact-xs"
            type="submit"
            loading={saving}
            disabled={!normalizedTitle}
          >
            {submitLabel}
          </Button>
        </Group>
      </Stack>
    </form>
  )
}
