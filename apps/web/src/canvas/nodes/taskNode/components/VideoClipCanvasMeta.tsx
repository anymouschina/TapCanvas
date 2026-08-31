import React from 'react'
import { Badge, Button, Group, Stack, Text } from '@mantine/core'
import { IconArrowBackUp, IconRefresh, IconWand } from '@tabler/icons-react'
import { useVideoRunStore } from '../../../../runner/videoRunStore'
import { toast } from '../../../../ui/toast'
import { requestVideoClipAgentAction } from '../../../videoClipAgentAction'
import {
  formatVideoClipFact,
  readVideoClipRunId,
  resolveVideoClipCanvasFacts,
  type VideoClipCanvasFacts,
  type VideoClipContinuityMode,
} from '../../../videoClipCanvasFacts'

type VideoClipCanvasMetaProps = {
  nodeId: string
  data: unknown
  overview?: boolean
}

const CONTINUITY_LABELS: Record<VideoClipContinuityMode, string> = {
  editorial_cut: '剪辑承接',
  bridge_frames: '首尾帧承接',
  reference_video: '视频承接',
}

const STATUS_COLORS: Record<VideoClipCanvasFacts['statusTone'], string> = {
  neutral: 'rgba(120,126,138,0.86)',
  info: 'rgba(38,120,214,0.92)',
  warning: 'rgba(190,128,36,0.94)',
  success: 'rgba(30,142,86,0.92)',
  error: 'rgba(190,54,65,0.94)',
}

function useClipFacts(nodeId: string, data: unknown): VideoClipCanvasFacts {
  const runId = readVideoClipRunId(data)
  const selectRun = React.useCallback(
    (state: ReturnType<typeof useVideoRunStore.getState>) => {
      if (!runId) return null
      return state.runsById[runId] ?? null
    },
    [runId],
  )
  const run = useVideoRunStore(selectRun)
  return React.useMemo(
    () => resolveVideoClipCanvasFacts(nodeId, data, run),
    [data, nodeId, run],
  )
}

function readCompactContractValue(
  contract: Record<string, unknown> | null,
  key: string,
): string | null {
  if (!contract) return null
  return formatVideoClipFact(contract[key]) || null
}

function VideoClipStatusChip({ facts }: { facts: VideoClipCanvasFacts }): JSX.Element {
  return (
    <span
      className="tc-video-clip-status-chip"
      style={{ background: STATUS_COLORS[facts.statusTone] }}
      data-video-status={facts.status}
    >
      {facts.statusLabel}
    </span>
  )
}

export function VideoClipCanvasMeta({ nodeId, data, overview = false }: VideoClipCanvasMetaProps): JSX.Element | null {
  const facts = useClipFacts(nodeId, data)
  if (!facts.isOrchestrated || overview) return null

  const chips = [
    facts.clipIndex === null ? null : `镜 ${String(facts.clipIndex + 1).padStart(2, '0')}`,
    facts.durationSeconds === null ? null : `${facts.durationSeconds}s`,
    facts.sceneName,
    facts.characterRoleNames.length > 0 ? `角色 ${facts.characterRoleNames.length}` : null,
    facts.continuityMode ? CONTINUITY_LABELS[facts.continuityMode] : null,
  ].filter((value): value is string => Boolean(value)).slice(0, 4)

  return (
    <div className="tc-video-clip-canvas-meta" aria-label="视频镜头事实摘要">
      <VideoClipStatusChip facts={facts} />
      <div className="tc-video-clip-canvas-meta__chips">
        {chips.map((chip) => (
          <span className="tc-video-clip-fact-chip" key={chip} title={chip}>
            {chip}
          </span>
        ))}
      </div>
    </div>
  )
}

function renderFactValue(value: unknown, empty = '未记录'): string {
  return formatVideoClipFact(value) || empty
}

function FactRow({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="tc-video-continuity-inspector__fact-row">
      <Text className="tc-video-continuity-inspector__fact-label" size="xs" c="dimmed">
        {label}
      </Text>
      <Text className="tc-video-continuity-inspector__fact-value" size="xs">
        {value}
      </Text>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <details className="tc-video-continuity-inspector__section" open>
      <summary className="tc-video-continuity-inspector__section-summary">{title}</summary>
      <div className="tc-video-continuity-inspector__section-body">{children}</div>
    </details>
  )
}

function ActionBar({ facts }: { facts: VideoClipCanvasFacts }): JSX.Element {
  return (
    <Group className="tc-video-continuity-inspector__actions" gap={6} wrap="wrap">
      <Button
        className="tc-video-continuity-inspector__action"
        size="compact-xs"
        variant="light"
        leftSection={<IconWand size={13} />}
        onClick={() => requestVideoClipAgentAction({ ...facts, action: 'revise_clip' })}
      >
        修订本镜
      </Button>
      {(facts.status === 'error' || facts.status === 'canceled') && (
        <Button
          className="tc-video-continuity-inspector__action"
          size="compact-xs"
          variant="subtle"
          leftSection={<IconArrowBackUp size={13} />}
          onClick={() => requestVideoClipAgentAction({ ...facts, action: 'resume_clip' })}
        >
          请求恢复
        </Button>
      )}
      {facts.assetBindingDiagnostics.length > 0 && (
        <Button
          className="tc-video-continuity-inspector__action"
          size="compact-xs"
          variant="subtle"
          color="orange"
          leftSection={<IconRefresh size={13} />}
          onClick={() => requestVideoClipAgentAction({ ...facts, action: 'repair_clip' })}
        >
          修复引用
        </Button>
      )}
    </Group>
  )
}

function ContractFacts({ facts }: { facts: VideoClipCanvasFacts }): JSX.Element {
  const contract = facts.generationContract
  return (
    <Stack className="tc-video-continuity-inspector__fact-stack" gap={3}>
      <FactRow label="模型" value={facts.videoModel || '由本轮动态合同决定'} />
      <FactRow label="时长" value={facts.durationSeconds === null ? '未记录' : `${facts.durationSeconds}s`} />
      <FactRow label="画幅" value={readCompactContractValue(contract, 'aspect') || readCompactContractValue(contract, 'aspectRatio') || '未记录'} />
      <FactRow label="分辨率" value={readCompactContractValue(contract, 'resolution') || '未记录'} />
      <FactRow label="合同版本" value={readCompactContractValue(contract, 'contractVersion') || '动态合同'} />
      <FactRow label="Prompt revision" value={facts.promptRevision || '未记录'} />
    </Stack>
  )
}

function AssetRegistry({ facts }: { facts: VideoClipCanvasFacts }): JSX.Element {
  return (
    <Stack className="tc-video-continuity-inspector__asset-stack" gap={6}>
      {facts.assetObjectContracts.length === 0 ? (
        <Text className="tc-video-continuity-inspector__empty" size="xs" c="dimmed">暂无已写入的资产职责合同。</Text>
      ) : facts.assetObjectContracts.map((asset) => (
        <div className="tc-video-continuity-inspector__asset-row" key={`${asset.kind}:${asset.name}`}>
          <Group className="tc-video-continuity-inspector__asset-heading" gap={6} wrap="nowrap">
            <Text className="tc-video-continuity-inspector__asset-name" size="xs" fw={600} truncate>
              {asset.name}
            </Text>
            <Badge className="tc-video-continuity-inspector__asset-role" size="xs" variant="light">
              {asset.referenceRole || asset.kind}
            </Badge>
          </Group>
          <Text className="tc-video-continuity-inspector__asset-meta" size="xs" c="dimmed">
            {asset.referenceImageNodeIds.length > 0
              ? `引用 ${asset.referenceImageNodeIds.length} 个真实节点`
              : '尚无真实引用节点'}
          </Text>
          {asset.forbiddenTransfer ? (
            <Text className="tc-video-continuity-inspector__asset-lock" size="xs">
              禁止迁移：{asset.forbiddenTransfer}
            </Text>
          ) : null}
        </div>
      ))}
      {facts.videoReferenceNodeIds.length > 0 ? (
        <Text className="tc-video-continuity-inspector__reference-count" size="xs" c="dimmed">
          本次视频实际引用节点：{facts.videoReferenceNodeIds.length} 个
        </Text>
      ) : null}
    </Stack>
  )
}

function ContinuityFacts({ facts }: { facts: VideoClipCanvasFacts }): JSX.Element {
  return (
    <Stack className="tc-video-continuity-inspector__fact-stack" gap={3}>
      <FactRow label="场景" value={facts.sceneName || '未记录'} />
      <FactRow label="角色" value={facts.characterRoleNames.join('、') || '未记录'} />
      <FactRow label="道具" value={facts.propNames.join('、') || '未记录'} />
      <FactRow label="VFX" value={facts.vfxNames.join('、') || '未记录'} />
      <FactRow label="连续性" value={facts.continuityMode ? CONTINUITY_LABELS[facts.continuityMode] : '未裁决'} />
      <FactRow label="上一镜" value={facts.expectedPrevClipIndex === null ? '无结构化上一镜依赖' : `镜 ${facts.expectedPrevClipIndex + 1}`} />
      <FactRow label="首帧" value={facts.firstFrameUrl || facts.storyboardImageNodeId ? '已绑定真实首帧' : '未绑定真实首帧'} />
      <FactRow label="尾帧" value={facts.lastFrameUrl || facts.lastFrameImageNodeId ? '已绑定真实尾帧' : '未绑定真实尾帧'} />
      <FactRow label="退出态" value={facts.exitState || '未记录'} />
      {facts.timeJumpNote ? <FactRow label="时间跳跃" value={facts.timeJumpNote} /> : null}
      {facts.characterStates ? <FactRow label="角色状态" value={renderFactValue(facts.characterStates)} /> : null}
    </Stack>
  )
}

function DeliveryFacts({ facts }: { facts: VideoClipCanvasFacts }): JSX.Element {
  return (
    <Stack className="tc-video-continuity-inspector__fact-stack" gap={3}>
      <FactRow label="状态" value={facts.statusLabel} />
      <FactRow label="Run" value={facts.runId || '未绑定'} />
      <FactRow label="Task" value={facts.videoTaskId || facts.taskId || '未受理'} />
      <FactRow label="视频资产" value={facts.videoUrl ? '真实 videoUrl 已写回' : '尚无真实 videoUrl'} />
      <FactRow label="更新时间" value={facts.updatedAt || '未记录'} />
      {facts.lastError ? <FactRow label="失败证据" value={facts.lastError} /> : null}
      {facts.assetBindingDiagnostics.map((diagnostic) => (
        <Text className="tc-video-continuity-inspector__diagnostic" size="xs" c="orange" key={diagnostic}>
          {diagnostic}
        </Text>
      ))}
    </Stack>
  )
}

export function VideoContinuityInspector({ nodeId, data }: VideoClipCanvasMetaProps): JSX.Element | null {
  const facts = useClipFacts(nodeId, data)
  if (!facts.isOrchestrated) return null

  return (
    <div className="tc-video-continuity-inspector" aria-label="视频镜头连续性与交付事实">
      <div className="tc-video-continuity-inspector__header">
        <div className="tc-video-continuity-inspector__title-block">
          <Text className="tc-video-continuity-inspector__title" size="sm" fw={600}>
            镜头生产包
          </Text>
          <Text className="tc-video-continuity-inspector__subtitle" size="xs" c="dimmed">
            {facts.clipIndex === null ? facts.nodeId : `镜 ${facts.clipIndex + 1} · ${facts.nodeId}`}
          </Text>
        </div>
        <VideoClipStatusChip facts={facts} />
      </div>
      <ActionBar facts={facts} />
      <Section title="Project Lock">
        <ContractFacts facts={facts} />
      </Section>
      <Section title="Asset Registry">
        <AssetRegistry facts={facts} />
      </Section>
      <Section title="Scene / Continuity">
        <ContinuityFacts facts={facts} />
      </Section>
      <Section title="Delivery Evidence">
        <DeliveryFacts facts={facts} />
      </Section>
      {facts.prompt ? (
        <details className="tc-video-continuity-inspector__prompt-section">
          <summary className="tc-video-continuity-inspector__section-summary">执行 prompt（只读）</summary>
          <div className="tc-video-continuity-inspector__prompt-body">
            <pre className="tc-video-continuity-inspector__prompt-text">{facts.prompt}</pre>
            <Button
              className="tc-video-continuity-inspector__copy-prompt"
              size="compact-xs"
              variant="subtle"
              onClick={() => {
                const clipboard = navigator.clipboard
                if (!clipboard) {
                  toast('当前浏览器不支持复制 prompt，请手动选择文本', 'error')
                  return
                }
                void clipboard.writeText(facts.prompt || '').then(
                  () => toast('已复制当前镜头 prompt', 'success'),
                  () => toast('复制 prompt 失败，请手动选择文本', 'error'),
                )
              }}
            >
              复制 prompt
            </Button>
          </div>
        </details>
      ) : null}
    </div>
  )
}
