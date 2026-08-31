import React, { useEffect, useMemo, useState } from 'react'
import { NodeToolbar, Position } from '@xyflow/react'
import { Paper, Group, Text, Slider, Button, UnstyledButton, Box, SegmentedControl, ScrollArea, Select, ActionIcon, Tooltip } from '@mantine/core'
import { IconRefresh } from '@tabler/icons-react'
import { listStoryboardRecipes, type StoryboardRecipeDto } from '../../api/server'
import { findModelOptionByIdentifier, useModelOptionsState } from '../../config/useModelOptions'

const MIN_DURATION = 15
const MAX_DURATION = 60

const AGENT_VIDEO_MODEL_SELECTION = 'agent:auto'

// 视频比例：跟随配方(空) / 手动钉死。工具层据此对全片视频统一比例。
const ASPECT_OPTIONS = [
  { label: '跟随', value: '' },
  { label: '9:16', value: '9:16' },
  { label: '16:9', value: '16:9' },
  { label: '1:1', value: '1:1' },
] as const

export type StoryboardPickOptions = { durationSeconds: number; aspect?: string; videoModel?: string }

export function StoryboardRecipePicker(props: {
  groupId: string
  onPick: (recipeId: string, opts: StoryboardPickOptions) => void
  onClose: () => void
}) {
  const [recipes, setRecipes] = useState<StoryboardRecipeDto[] | null>(null)
  const [failedPreviews, setFailedPreviews] = useState<Set<string>>(new Set())
  const [durationSeconds, setDurationSeconds] = useState<number>(MIN_DURATION)
  const [videoModel, setVideoModel] = useState<string>(AGENT_VIDEO_MODEL_SELECTION)
  const [aspectChoice, setAspectChoice] = useState<string>('')
  const {
    options: videoModelOptions,
    loading: videoModelsLoading,
    error: videoModelsError,
    retry: retryVideoModels,
  } = useModelOptionsState('video')

  useEffect(() => {
    let alive = true
    listStoryboardRecipes()
      .then((r) => { if (alive) setRecipes(r) })
      .catch(() => { if (alive) setRecipes([]) })
    return () => { alive = false }
  }, [])

  const videoModelSelectData = useMemo(() => [
    { value: AGENT_VIDEO_MODEL_SELECTION, label: '由 Agent 按镜决策' },
    ...videoModelOptions.map((option) => {
      const minimumCredits = option.pricing?.cost ?? 0
      const priceLabel = minimumCredits > 0 ? ` · 起 ¥${(minimumCredits / 100).toFixed(2)}` : ''
      return { value: option.value, label: `${option.label}${priceLabel}` }
    }),
  ], [videoModelOptions])
  const selectedVideoModelValid = videoModel === AGENT_VIDEO_MODEL_SELECTION || Boolean(
    findModelOptionByIdentifier(videoModelOptions, videoModel),
  )
  const canPick = !videoModelsLoading && !videoModelsError && videoModelOptions.length > 0 && selectedVideoModelValid
  // 视频比例跟随配方默认（recipe.aspect）；工具层据此钉死全片视频比例一致。
  const pick = (recipeId: string) => {
    if (!canPick) return
    // 手动选了比例就用它，否则跟随配方默认。
    const aspect = aspectChoice || recipes?.find((r) => r.id === recipeId)?.aspect
    props.onPick(recipeId, {
      durationSeconds,
      ...(videoModel !== AGENT_VIDEO_MODEL_SELECTION ? { videoModel } : {}),
      ...(aspect ? { aspect } : {}),
    })
  }

  return (
    <NodeToolbar nodeId={props.groupId} position={Position.Top} align="center" isVisible>
      <Paper p="sm" radius="md" withBorder shadow="md" style={{ maxWidth: 'min(94vw, 1180px)' }}>
        {/* 顶部控件：智能创作（一键出片，含视频）/ 时长 / 估算 */}
        <Group justify="space-between" wrap="nowrap" gap="md" mb="sm">
          <Group gap="md" wrap="nowrap">
            <Button className="tc-storyboard-recipe-picker__auto" variant="light" size="xs" disabled={!canPick} onClick={() => pick('auto')}>
              智能创作
            </Button>
            <Group gap={8} wrap="nowrap">
              <Slider
                w={150}
                min={MIN_DURATION}
                max={MAX_DURATION}
                step={5}
                value={durationSeconds}
                onChange={setDurationSeconds}
                label={(v) => `${v}s`}
              />
              <Text size="sm" fw={600} w={34}>{durationSeconds}s</Text>
            </Group>
            <Group className="tc-storyboard-recipe-picker__model-control" gap={4} wrap="nowrap">
              <Select
                className="tc-storyboard-recipe-picker__model-select"
                size="xs"
                w={260}
                searchable
                allowDeselect={false}
                value={selectedVideoModelValid ? videoModel : null}
                onChange={(value) => value && setVideoModel(value)}
                data={videoModelSelectData}
                placeholder={videoModelsLoading ? '读取视频模型…' : '选择视频模型'}
                disabled={videoModelsLoading || Boolean(videoModelsError) || videoModelOptions.length === 0}
              />
              {videoModelsError ? (
                <Tooltip className="tc-storyboard-recipe-picker__model-retry-tip" label={videoModelsError.message} withArrow>
                  <ActionIcon
                    className="tc-storyboard-recipe-picker__model-retry"
                    aria-label="重新加载视频模型"
                    size="sm"
                    variant="subtle"
                    color="red"
                    onClick={retryVideoModels}
                  >
                    <IconRefresh className="tc-storyboard-recipe-picker__model-retry-icon" size={14} />
                  </ActionIcon>
                </Tooltip>
              ) : null}
            </Group>
            <Group gap={8} wrap="nowrap">
              <SegmentedControl
                size="xs"
                value={aspectChoice}
                onChange={setAspectChoice}
                data={ASPECT_OPTIONS.map((a) => ({ label: a.label, value: a.value }))}
              />
            </Group>
            <Text className="tc-storyboard-recipe-picker__billing-note" size="xs" c={videoModelsError ? 'red' : 'dimmed'}>
              {videoModelsError
                ? '视频模型目录加载失败'
                : videoModelsLoading
                  ? '正在读取实时模型与价格'
                  : videoModelOptions.length === 0
                    ? '没有已配置且可结算的视频模型'
                    : '生成计划确定每镜规格后，按模型价格表实时结算'}
            </Text>
          </Group>
          <Button variant="subtle" size="xs" color="gray" onClick={props.onClose}>×</Button>
        </Group>

        {/* 配方卡片：ScrollArea 替代原生 overflowX 滚动条——原生条只有几像素高，
            点击/拖拽热区太小；scrollbarSize=14 给出可舒适拖拽的轨道与滑块。 */}
        <ScrollArea
          type="auto"
          scrollbarSize={14}
          offsetScrollbars
          style={{ maxWidth: 'min(92vw, 1150px)' }}
        >
        <Group gap="sm" wrap="nowrap">
          {recipes === null && <Text size="sm" c="dimmed">加载配方…</Text>}
          {recipes !== null && recipes.length === 0 && <Text size="sm" c="dimmed">暂无可用配方</Text>}
          {recipes?.map((r) => (
            <UnstyledButton key={r.id} onClick={() => pick(r.id)} style={{ width: 132, flex: '0 0 auto' }}>
              {failedPreviews.has(r.id) ? (
                <Box
                  w={132}
                  h={132}
                  style={{
                    borderRadius: 10,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    textAlign: 'center',
                    padding: 8,
                    background: 'var(--mantine-color-default-hover)',
                    color: 'var(--mantine-color-dimmed)',
                    fontSize: 11,
                  }}
                >
                  {r.name}
                </Box>
              ) : (
                /* 配方预览是本地静态图（/storyboard-recipes/*.jpg），属 CLAUDE.md 允许原生 <img> 的
                   例外（静态本地资源、无需缓存管理）。直接用原生 <img loading="eager"> 立即加载，
                   绕开 ManagedImage 的可见性/lazy/解码队列延迟——实测那套机制会让面板右侧的预览图
                   要滚动到才发请求（前两张外全卡 skeleton）。 */
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  className="tc-recipe-card__img"
                  src={r.previewUrl}
                  alt={r.name}
                  loading="eager"
                  decoding="async"
                  draggable={false}
                  referrerPolicy="no-referrer"
                  style={{ width: 132, height: 132, objectFit: 'cover', borderRadius: 10, display: 'block' }}
                  onError={() =>
                    setFailedPreviews((prev) => {
                      if (prev.has(r.id)) return prev
                      const next = new Set(prev)
                      next.add(r.id)
                      return next
                    })
                  }
                />
              )}
              <Text size="xs" fw={600} mt={6}>{r.name}</Text>
              <Text size="xs" c="dimmed" lineClamp={3}>{r.description}</Text>
            </UnstyledButton>
          ))}
        </Group>
        </ScrollArea>
      </Paper>
    </NodeToolbar>
  )
}
