import React, { useEffect, useState } from 'react'
import { Modal, Button, Group, Stack, SegmentedControl, Text, Textarea, NumberInput, Switch } from '@mantine/core'

// 「本章成片」只收集本章独有的交付范围。
// 媒体规格由服务端按本轮显式输入、账号偏好和已装配工作流冻结。
// - 改编合同由用户显式选择：忠实原文，或保留主线锚点的创意扩写。
// - 生成调度与依赖属于已装配的工作流。
// - 备注：自定义要求，原样拼进派发指令交给小T

export type ChapterFilmSpec = {
  deliveryScope: 'full_chapter' | 'opening_duration'
  targetDurationSeconds?: number
  adaptationMode: 'faithful' | 'creative'
  notes: string
  onlyVideoNodes?: boolean
}

export const DEFAULT_CHAPTER_FILM_SPEC: ChapterFilmSpec = {
  deliveryScope: 'full_chapter',
  adaptationMode: 'faithful',
  notes: '',
}

// 弹窗每次打开沿用用户上次确认的规格档位（备注除外——那是章级一次性要求）。
// chapters.film_spec 是服务端权威（estimate/commit_beats 合并用），这里只管 UI 预填。
const LAST_SPEC_STORAGE_KEY = 'tc_chapter_film_spec_last'

function readLastFilmSpec(): Partial<ChapterFilmSpec> | null {
  try {
    const raw = localStorage.getItem(LAST_SPEC_STORAGE_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as Record<string, unknown>
    const out: Partial<ChapterFilmSpec> = {}
    if (p.adaptationMode === 'faithful' || p.adaptationMode === 'creative') out.adaptationMode = p.adaptationMode
    if (p.deliveryScope === 'full_chapter' || p.deliveryScope === 'opening_duration') {
      out.deliveryScope = p.deliveryScope
      if (p.deliveryScope === 'opening_duration' && typeof p.targetDurationSeconds === 'number' && Number.isInteger(p.targetDurationSeconds) && p.targetDurationSeconds > 0) {
        out.targetDurationSeconds = p.targetDurationSeconds
      }
    }
    return out
  } catch {
    return null
  }
}

function saveLastFilmSpec(spec: ChapterFilmSpec): void {
  try {
    const { notes: _notes, ...rest } = spec
    localStorage.setItem(LAST_SPEC_STORAGE_KEY, JSON.stringify(rest))
  } catch {
    /* 隐私模式等存不进就算了 */
  }
}

type Props = {
  opened: boolean
  onConfirm: (spec: ChapterFilmSpec) => void
  onCancel: () => void
}

export function ChapterFilmSpecModal({ opened, onConfirm, onCancel }: Props) {
  const [deliveryScope, setDeliveryScope] = useState<ChapterFilmSpec['deliveryScope']>(
    DEFAULT_CHAPTER_FILM_SPEC.deliveryScope,
  )
  const [adaptationMode, setAdaptationMode] = useState<ChapterFilmSpec['adaptationMode']>(
    DEFAULT_CHAPTER_FILM_SPEC.adaptationMode,
  )
  const [targetDurationSeconds, setTargetDurationSeconds] = useState<number | string>(60)
  const [onlyVideoNodes, setOnlyVideoNodes] = useState(false)
  const [notes, setNotes] = useState('')
  const duration = typeof targetDurationSeconds === 'number' ? targetDurationSeconds : Number(targetDurationSeconds)
  const durationValid = Number.isInteger(duration) && duration >= 1 && duration <= 86400

  useEffect(() => {
    if (opened) {
      const last = readLastFilmSpec()
      setDeliveryScope(last?.deliveryScope ?? DEFAULT_CHAPTER_FILM_SPEC.deliveryScope)
      setAdaptationMode(last?.adaptationMode ?? DEFAULT_CHAPTER_FILM_SPEC.adaptationMode)
      setTargetDurationSeconds(last?.targetDurationSeconds ?? 60)
      setNotes('')
      setOnlyVideoNodes(false)
    }
  }, [opened])

  return (
    <Modal
      className="chapter-film-spec-modal"
      opened={opened}
      onClose={onCancel}
      title="本章成片"
      size="md"
      centered
    >
      <Stack gap="sm">
        <div className="chapter-film-spec-modal__div" style={{ padding: '12px 14px', borderRadius: 10, background: 'var(--mantine-color-dark-6)' }}>
          <Text className="chapter-film-spec-modal__text" size="sm" fw={600}>{onlyVideoNodes ? '从当前章节到视频节点' : '从当前章节到最终视频'}</Text>
          <Text className="chapter-film-spec-modal__text" size="xs" c="dimmed" mt={4}>
            选择本次范围与改编方式。启动后可在画布查看实际执行步骤、生成结果与异常原因。
          </Text>
        </div>
        <div className="chapter-film-spec-scope">
          <Text size="sm" fw={500} mb={4}>
            交付范围
          </Text>
          <SegmentedControl
            className="chapter-film-spec-scope-control"
            fullWidth
            size="xs"
            value={deliveryScope}
            onChange={(value) => setDeliveryScope(value as ChapterFilmSpec['deliveryScope'])}
            data={[
              { value: 'full_chapter', label: '整章成片' },
              { value: 'opening_duration', label: '开头片段' },
            ]}
          />
          <Text size="xs" c={deliveryScope === 'opening_duration' ? 'blue.4' : 'dimmed'} mt={4}>
            {deliveryScope === 'opening_duration'
              ? (onlyVideoNodes ? '从本章开头开始，为指定时长准备视频节点与完整提示词。' : '从本章开头开始，生成指定时长的片段并合成为一条视频。')
              : '以本章完整原文为来源，具体分段与本次生产上限由已装配工作流冻结。'}
          </Text>
          {deliveryScope === 'opening_duration' ? (
            <NumberInput
              className="chapter-film-spec-duration-input"
              label="目标时长（秒）"
              description="必须是正整数；例如 60 = 1 分钟，90 = 1 分 30 秒。"
              min={1}
              max={86400}
              allowDecimal={false}
              allowNegative={false}
              value={targetDurationSeconds}
              onChange={setTargetDurationSeconds}
              error={durationValid ? undefined : '请输入 1–86400 之间的整数秒数'}
              mt="xs"
            />
          ) : null}
        </div>
        <Switch className="chapter-film-spec-modal__switch" label="只生成视频节点" checked={onlyVideoNodes}
          onChange={(event) => setOnlyVideoNodes(event.currentTarget.checked)}
          description="准备参考资产并填充视频提示词后完成；视频由你在节点上手动生成。" />
        <div className="chapter-film-spec-adaptation">
          <Text size="sm" fw={500} mb={4}>
            改编方式
          </Text>
          <SegmentedControl
            className="chapter-film-spec-adaptation-control"
            fullWidth
            size="xs"
            value={adaptationMode}
            onChange={(value) => setAdaptationMode(value as ChapterFilmSpec['adaptationMode'])}
            data={[
              { value: 'faithful', label: '忠实原文' },
              { value: 'creative', label: '创意改编' },
            ]}
          />
          <Text size="xs" c={adaptationMode === 'creative' ? 'blue.4' : 'dimmed'} mt={4}>
            {adaptationMode === 'creative'
              ? '保留核心人物、关系、世界规则与主线结果；允许新增桥段、对白、冲突、反转、视觉包装与商业化表达，让平板原文变成更有戏的成片。'
              : '完整保留原文事实、因果与逐字台词，只把内容镜头化并补足可拍的动作承接。'}
          </Text>
        </div>
        <Text className="chapter-film-spec-generation-preferences" size="xs" c="dimmed">
          模型、比例与分辨率由服务端结合本次明确要求、账号生成偏好和工作流配置冻结；不支持的规格会显示具体原因。
        </Text>
        <Text className="chapter-film-spec-faithful-source" size="xs" c="dimmed">
          {adaptationMode === 'creative'
            ? '创意模式仍会保留原文台词与主线锚点作为底稿；新增内容由小T在同一改编链内生成并记录，不会静默覆盖原文或既有资产。'
            : '忠实模式保留来源事实、台词与主线锚点；动作、神态和画面描述用于视觉生成。'}
        </Text>
        <div>
          <Text size="sm" fw={500} mb={4}>
            备注（可选）
          </Text>
          <Textarea
            size="xs"
            autosize
            minRows={2}
            maxRows={4}
            maxLength={500}
            placeholder="自定义要求，如「打斗戏加量」「风格往水墨武侠靠」「结尾留悬念」……随派发指令原样交给小T"
            value={notes}
            onChange={(e) => setNotes(e.currentTarget.value)}
          />
        </div>
        <Text size="xs" c="dimmed">
          交付目标：{deliveryScope === 'opening_duration' && durationValid ? `${duration} 秒开头片段` : '当前章节成片'} · {onlyVideoNodes ? '视频节点与完整提示词，不自动生成视频。' : '最终合成视频。'}已生成素材会保留在项目中。
        </Text>
        <Group justify="flex-end" gap="xs" mt={4}>
          <Button variant="default" size="xs" onClick={onCancel}>
            取消
          </Button>
          <Button
            size="xs"
            disabled={deliveryScope === 'opening_duration' && !durationValid}
            onClick={() => {
              if (deliveryScope === 'opening_duration' && !durationValid) return
              const spec: ChapterFilmSpec = {
                deliveryScope,
                adaptationMode,
                ...(deliveryScope === 'opening_duration' ? { targetDurationSeconds: duration } : {}),
                notes: notes.trim(),
                onlyVideoNodes,
              }
              saveLastFilmSpec(spec)
              onConfirm(spec)
            }}
          >
            {onlyVideoNodes ? '生成视频节点' : '开始成片'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
