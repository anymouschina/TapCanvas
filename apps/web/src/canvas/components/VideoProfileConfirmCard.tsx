import React, { useEffect, useMemo, useState } from 'react'
import { NodeToolbar, Position } from '@xyflow/react'
import { Paper, Group, Text, Button, Select, Loader, Badge, Stack } from '@mantine/core'
import {
  classifyVideoIntent,
  listVideoProfiles,
  type VideoProfileDto,
  type VideoIntentResult,
} from '../../api/server'
import { useRFStore } from '../store'

// 视频领域档案确认卡（设计 spec C3）。
// 复用 StoryboardRecipePicker 同款 NodeToolbar + Paper overlay 模式，挂在群组节点上方，
// 不新增全屏 Modal（遵守画布优先原则）。仅在 VIDEO_PROFILE_ROUTING=ON 时由 Canvas 渲染。
//
// 流程：挂载即对组内文本/图调 tapcanvas-intent-classifier 识别领域 → 展示识别结果（领域 +
// styleTone + aspect + 理由）→ 用户可用下拉切 5 档 → 确认后回调 onConfirm(profileId)，
// 由 Canvas 把 videoProfileId 确定性钉到组 data。

// 后端 profiles 接口（C4）若尚未就绪/失败时的兜底档位，与 spec 3.4 首发 4 档 + default 对齐。
// 这样确认卡在 C4 未部署时也能工作（degrade gracefully），并保证下拉始终有完整 5 档。
const FALLBACK_PROFILES: VideoProfileDto[] = [
  { id: 'product-commerce', name: '产品电商/带货', styleTone: 'clean-real', aspect: '9:16', durationDefault: 15 },
  { id: 'narrative-drama', name: '剧情叙事/小说改编', styleTone: 'cinematic', aspect: '16:9' },
  { id: 'comic-anime', name: '漫剧/动画短剧', styleTone: 'anime', aspect: '16:9' },
  { id: 'mv-stylized', name: 'MV/风格化短片', styleTone: 'cinematic', aspect: '16:9' },
  { id: 'fashion', name: '时尚/服装大片', styleTone: 'cinematic', aspect: '9:16', durationDefault: 20 },
  { id: 'ecommerce-tvc', name: '电商广告/TVC', styleTone: 'cinematic', aspect: '9:16', durationDefault: 20 },
  { id: 'short-video-creator', name: '短视频达人/无缝转场·变装爆款', styleTone: 'cinematic', aspect: '9:16', durationDefault: 15 },
  { id: 'default', name: '兜底（沿用现状）', styleTone: '' },
]

const STYLE_TONE_LABELS: Record<string, string> = {
  'clean-real': '干净写实 (clean-real)',
  cinematic: '电影感 (cinematic)',
  anime: '动漫/风格化 (anime)',
  '': '跟随现状（由 AI 自由判定）',
}

function styleToneLabel(tone?: string): string {
  return STYLE_TONE_LABELS[tone ?? ''] ?? (tone || '跟随现状')
}

function aspectLabel(aspect?: string): string {
  return aspect && aspect.trim() ? aspect : '跟随现状'
}

/** 从群组收集文本简报 + 图片 URL（供分类器；与 Canvas.generateGroupStoryboard 的收集口径一致）。 */
function collectGroupBrief(groupId: string): { briefText: string; imageUrls: string[] } {
  const children = useRFStore.getState().nodes.filter((n: any) =>
    n?.parentId === groupId || (n as any)?.parentNode === groupId || n?.data?.parentId === groupId,
  )
  const imageUrls = Array.from(new Set(
    children
      .map((n: any) => {
        const d = n?.data ?? {}
        const imgs = Array.isArray(d.images) ? d.images : []
        const url = d.imageUrl || d.url || (imgs[0] && (imgs[0].url || imgs[0])) || ''
        return typeof url === 'string' ? url : ''
      })
      .filter((u: string) => /^https?:\/\//.test(u)),
  )) as string[]
  const briefText = children
    .map((n: any) => {
      const d = n?.data ?? {}
      const isTextNode = String(d.kind || '') === 'text'
      return String((isTextNode ? d.prompt : '') || d.text || d.content || (isTextNode ? d.latestTextResult : '') || '').trim()
    })
    .filter(Boolean)
    .join('\n')
  return { briefText, imageUrls }
}

export function VideoProfileConfirmCard(props: {
  groupId: string
  projectId?: string
  onConfirm: (profileId: string) => void
  onClose: () => void
}) {
  const [profiles, setProfiles] = useState<VideoProfileDto[]>(FALLBACK_PROFILES)
  const [intent, setIntent] = useState<VideoIntentResult | null>(null)
  const [selectedId, setSelectedId] = useState<string>('default')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const { briefText, imageUrls } = collectGroupBrief(props.groupId)
    setLoading(true)
    Promise.allSettled([
      listVideoProfiles(),
      classifyVideoIntent({ briefText, imageUrls, groupId: props.groupId, projectId: props.projectId }),
    ]).then(([profRes, intentRes]) => {
      if (!alive) return
      if (profRes.status === 'fulfilled' && Array.isArray(profRes.value) && profRes.value.length > 0) {
        setProfiles(profRes.value)
      }
      if (intentRes.status === 'fulfilled' && intentRes.value?.profileId) {
        setIntent(intentRes.value)
        setSelectedId(intentRes.value.profileId)
      } else {
        // 分类失败 → 回退 default（与 spec：置信度低/边界回退 default 一致）。
        setSelectedId('default')
        if (intentRes.status === 'rejected') {
          setError('意图识别暂不可用，已回退兜底档，可手动选择领域')
        }
      }
      setLoading(false)
    })
    return () => { alive = false }
  }, [props.groupId, props.projectId])

  const selected = useMemo(
    () => profiles.find((p) => p.id === selectedId) ?? FALLBACK_PROFILES.find((p) => p.id === selectedId),
    [profiles, selectedId],
  )
  const isAutoPick = intent?.profileId === selectedId

  return (
    <NodeToolbar nodeId={props.groupId} position={Position.Top} align="center" isVisible>
      <Paper p="md" radius="md" withBorder shadow="md" style={{ width: 'min(92vw, 460px)' }}>
        <Group justify="space-between" wrap="nowrap" mb="xs">
          <Group gap={8} wrap="nowrap">
            <Text size="sm" fw={700}>识别视频领域</Text>
            {loading && <Loader size="xs" />}
            {!loading && isAutoPick && intent && (
              <Badge size="xs" variant="light" color="teal">
                AI 识别 · 置信度 {Math.round((intent.confidence ?? 0) * 100)}%
              </Badge>
            )}
            {!loading && !isAutoPick && (
              <Badge size="xs" variant="light" color="gray">手动选择</Badge>
            )}
          </Group>
          <Button variant="subtle" size="xs" color="gray" onClick={props.onClose}>×</Button>
        </Group>

        <Stack gap="xs">
          <Select
            size="xs"
            label="领域档案"
            value={selectedId}
            onChange={(v) => v && setSelectedId(v)}
            allowDeselect={false}
            comboboxProps={{ withinPortal: true }}
            data={profiles.map((p) => ({ value: p.id, label: p.name }))}
          />

          <Group gap="xs" wrap="wrap">
            <Badge size="sm" variant="outline">styleTone：{styleToneLabel(selected?.styleTone)}</Badge>
            <Badge size="sm" variant="outline">比例：{aspectLabel(selected?.aspect)}</Badge>
          </Group>

          {intent?.rationale && (
            <Text size="xs" c="dimmed" lineClamp={4}>
              识别理由：{intent.rationale}
            </Text>
          )}
          {error && <Text size="xs" c="orange">{error}</Text>}
          {selected?.id === 'default' && (
            <Text size="xs" c="dimmed">兜底档：不注入领域覆盖，沿用现状由 AI 自由判定。</Text>
          )}
        </Stack>

        <Group justify="flex-end" gap="xs" mt="md">
          <Button variant="default" size="xs" onClick={props.onClose}>取消</Button>
          <Button size="xs" disabled={loading} onClick={() => props.onConfirm(selectedId)}>
            确认并开始
          </Button>
        </Group>
      </Paper>
    </NodeToolbar>
  )
}
