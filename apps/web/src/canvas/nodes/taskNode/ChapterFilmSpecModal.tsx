import React, { useEffect, useState } from 'react'
import { Modal, Button, Group, Stack, SegmentedControl, Text, Textarea, NumberInput } from '@mantine/core'

// 「本章成片」只收集本章独有的交付范围。
// 视频模型、比例和分辨率统一继承 AI 对话的生成偏好；这里不得维护第二套规格选择。
// - 改编合同由用户显式选择：忠实原文，或保留主线锚点的创意扩写。
// - 生成调度：一键成片固定为 clip 独立并发，镜间连续性由结构化状态接力承担。
// - 备注：自定义要求，原样拼进派发指令交给小T

export type ChapterFilmSpec = {
  deliveryScope: 'full_chapter' | 'opening_duration'
  targetDurationSeconds?: number
  adaptationMode: 'faithful' | 'creative'
  notes: string
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
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (opened) {
      const last = readLastFilmSpec()
      setDeliveryScope(last?.deliveryScope ?? DEFAULT_CHAPTER_FILM_SPEC.deliveryScope)
      setAdaptationMode(last?.adaptationMode ?? DEFAULT_CHAPTER_FILM_SPEC.adaptationMode)
      setTargetDurationSeconds(last?.targetDurationSeconds ?? 60)
      setNotes('')
    }
  }, [opened])

  return (
    <Modal
      className="chapter-film-spec-modal"
      opened={opened}
      onClose={onCancel}
      title="本章成片"
      size="sm"
      centered
    >
      <Stack gap="sm">
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
              { value: 'opening_duration', label: '指定时长' },
            ]}
          />
          <Text size="xs" c={deliveryScope === 'opening_duration' ? 'blue.4' : 'dimmed'} mt={4}>
            {deliveryScope === 'opening_duration'
              ? '本次只生产并合成当前章节开头指定时长；不会读取或交付历史整章成片。'
              : '生产当前章节的完整沉浸式成片；整章没有 90 秒上限，实际时长由本章完整叙事与合法分段总时长决定。'}
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
              mt="xs"
            />
          ) : null}
        </div>
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
          视频模型、比例与分辨率继承 AI 对话里的“生成偏好”；时长与分段由完整原文、对白容量和模型合法窗口共同决定。
        </Text>
        <Text className="chapter-film-spec-faithful-source" size="xs" c="dimmed">
          {adaptationMode === 'creative'
            ? '创意模式仍会保留原文台词与主线锚点作为底稿；新增内容由小T在同一改编链内生成并记录，不会静默覆盖原文或既有资产。'
            : '忠实模式保留原文台词与主线锚点；动作、神态和画面描述只用于视觉生成，整章模式不得因片段数删除任何原文内容。'}
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
          本次只保存当前章节的交付范围；生成规格始终来自当前 AI 对话偏好和实时模型目录。
        </Text>
        <Group justify="flex-end" gap="xs" mt={4}>
          <Button variant="default" size="xs" onClick={onCancel}>
            取消
          </Button>
          <Button
            size="xs"
            onClick={() => {
              const duration = typeof targetDurationSeconds === 'number' ? targetDurationSeconds : Number(targetDurationSeconds)
              if (deliveryScope === 'opening_duration' && (!Number.isInteger(duration) || duration <= 0)) return
              const spec: ChapterFilmSpec = {
                deliveryScope,
                adaptationMode,
                ...(deliveryScope === 'opening_duration' ? { targetDurationSeconds: duration } : {}),
                notes: notes.trim(),
              }
              saveLastFilmSpec(spec)
              onConfirm(spec)
            }}
          >
            开始成片
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
