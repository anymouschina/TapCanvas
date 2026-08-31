import React from 'react'
import { Button, Card, Group, Loader, Stack, Text } from '@mantine/core'
import { useIntentLifecycle } from '../canvas/intentLifecycle'

const INTENT_LABEL: Record<string, string> = {
  generate_shot_placeholders: '自动拆分设计板',
  generate_scene_references: '生成场景/人物参考图',
  generate_video_nodes: '生成视频节点',
}

const TOOL_LABEL: Record<string, string> = {
  add_node: '新增节点',
  connect_edge: '连接节点',
  link_existing_asset: '复用素材',
  finalize: '提交',
  tapcanvas_create_nodes: '创建画布节点',
  tapcanvas_update_nodes: '更新画布节点',
  tapcanvas_connect_nodes: '连接画布节点',
  tapcanvas_generate_assets: '生成资产',
}

export function IntentProgressToast() {
  const active = useIntentLifecycle((s) => s.activeIntent)
  const activeRunCount = useIntentLifecycle((s) => s.activeRunCount)
  const toolCount = useIntentLifecycle((s) => s.toolCallCount)
  const buffered = useIntentLifecycle((s) => s.bufferedToolCalls)
  const stage = useIntentLifecycle((s) => s.stage)
  const lastTool = useIntentLifecycle((s) => s.lastToolName)
  const upstreamErrors = useIntentLifecycle((s) => s.upstreamErrors)
  const cancel = useIntentLifecycle((s) => s.cancel)
  if (!active) return null

  const isMulti = activeRunCount > 1
  const displayCount = Math.max(toolCount, buffered)
  const intentLabel = INTENT_LABEL[active] ?? active

  let stageVerb = '思考中'
  if (toolCount > 0) stageVerb = '提交中'
  else if (stage === 'tool_completed' || buffered > 0) stageVerb = '规划中'
  else if (stage === 'waiting_upstream') stageVerb = '思考中'

  let detail: string
  if (isMulti) {
    detail = `${activeRunCount} 个节点并发派生中`
  } else if (toolCount > 0) {
    detail = `已完成 ${toolCount} 个执行动作`
  } else if (displayCount > 0) {
    detail = `已确认 ${displayCount} 个执行进度`
  } else {
    detail = '等待首个执行事实'
  }

  const subtle: string[] = []
  if (!isMulti && lastTool && stage === 'tool_completed') {
    subtle.push(`刚完成：${TOOL_LABEL[lastTool] ?? lastTool}`)
  }
  if (upstreamErrors > 0) {
    subtle.push(`上游错误 ${upstreamErrors}`)
  }

  return (
    <Card
      shadow="md"
      radius="md"
      p="sm"
      style={{
        position: 'fixed',
        right: 16,
        bottom: 84,
        zIndex: 9999,
        minWidth: 260,
        background: 'rgba(32, 32, 32, 0.96)',
      }}
    >
      <Group justify="space-between" align="flex-start" gap="sm" wrap="nowrap">
        <Group gap="xs" align="flex-start" wrap="nowrap">
          <Loader size="xs" mt={2} />
          <Stack gap={2}>
            <Text size="sm">
              {isMulti ? detail : `Agent ${stageVerb}（${intentLabel}）… ${detail}`}
            </Text>
            {subtle.length > 0 && (
              <Text size="xs" c="dimmed">
                {subtle.join(' · ')}
              </Text>
            )}
          </Stack>
        </Group>
        <Button size="xs" variant="light" color="gray" onClick={() => cancel()}>
          取消{isMulti ? '全部' : ''}
        </Button>
      </Group>
    </Card>
  )
}
