import React from 'react'
import { Badge, Button, CopyButton, Group, Paper, Stack, Text, Tooltip, useMantineColorScheme } from '@mantine/core'
import { IconCheck, IconCopy } from '@tabler/icons-react'
import { VIDEO_REALISM_RULES, VIDEO_REALISM_PROMPT_SNIPPET } from '../../../creative/videoRealism'

export type VideoRealismTipsProps = {
  onInsertSnippet?: (snippet: string) => void
}

export function VideoRealismTips({ onInsertSnippet }: VideoRealismTipsProps) {
  const { colorScheme } = useMantineColorScheme()
  const isDark = colorScheme === 'dark'
  const handleInsert = React.useCallback(() => {
    if (!onInsertSnippet) return
    onInsertSnippet(VIDEO_REALISM_PROMPT_SNIPPET)
  }, [onInsertSnippet])

  return (
    <Paper
      shadow="sm"
      radius="md"
      withBorder
      p="sm"
      style={{
        background: isDark ? 'rgba(15, 23, 42, 0.35)' : 'rgba(241, 245, 249, 0.85)',
        borderColor: isDark ? 'rgba(59, 130, 246, 0.3)' : 'rgba(59, 130, 246, 0.4)',
      }}
    >
      <Group justify="space-between" mb="xs" align="center">
        <div>
          <Text fw={600} size="sm">
            AI 视频真实感九大法则
          </Text>
          <Text size="xs" c="dimmed">
            直接应用到 composeVideo / Storyboard 提示词中，维持统一的光影与镜头语言。
          </Text>
        </div>
        <Group gap={6}>
          <Button size="xs" variant="light" onClick={handleInsert}>
            注入模板
          </Button>
          <CopyButton value={VIDEO_REALISM_PROMPT_SNIPPET} timeout={1800}>
            {({ copied, copy }) => (
              <Tooltip label={copied ? '已复制' : '复制英文模板'} withArrow>
                <Button
                  size="xs"
                  variant="subtle"
                  leftSection={copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                  onClick={copy}
                >
                  {copied ? '已复制' : '复制'}
                </Button>
              </Tooltip>
            )}
          </CopyButton>
        </Group>
      </Group>
      <Stack gap={6}>
        {VIDEO_REALISM_RULES.map(rule => (
          <Group key={rule.id} align="flex-start" gap={8}>
            <Badge radius="sm" variant="light" color="blue" size="xs" style={{ flexShrink: 0 }}>
              {rule.title}
            </Badge>
            <Text size="xs" c="dimmed" style={{ lineHeight: 1.4 }}>
              {rule.summary}
            </Text>
          </Group>
        ))}
      </Stack>
    </Paper>
  )
}
