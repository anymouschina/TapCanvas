import { SHOT_TABLE_OVERVIEW_ORDER, VIDEO_EVIDENCE_SHOT_TABLE_COLUMNS } from './defaults'
import { resolveShotTableColumnContract } from './column-contract'
import type { ShotTableColumn } from './types'

export const SHOT_TABLE_ANALYSIS_SCHEMA_NAME = 'tapcanvas_shot_table_analysis_v1' as const

const buildVideoEvidenceStringProperty = (key: string, label: string): Record<string, unknown> => {
  if (key === '节拍数') {
    return {
      type: 'string',
      enum: [''],
      description: '事实提取阶段不推断创作节拍；必须返回空字符串。',
    }
  }
  const descriptions: Record<string, string> = {
    '集数/标题': '仅填写画面或已验证元数据中明示的集数/标题；不得自拟标题。',
    '总镜数': '十进制正整数字符串，必须与 shots 数组长度一致。',
    '素材总时长': '整段媒体的精确时长，使用秒形式，例如 25.000s。',
    '全程说明': '只概括整段视频可见、可听内容；不推断受众、平台、转化目标或创作意图。',
    '镜号': '连续镜头的唯一十进制序号，从 1 开始。',
    '时间区间（镜头完整区间）': '连续镜头的完整区间，使用 start-end 秒形式，例如 0.000s-1.250s。',
    '时长': '镜头区间的精确长度，使用秒形式，例如 1.250s。',
    '时间段': '镜头内时序段的完整区间，使用 start-end 秒形式；同镜所有时序段必须无缝覆盖整镜。',
    '运镜': '仅描述连续帧中可见的相机位移、旋转或变焦；无法确认时留空。',
    '台词': '仅记录可听清或画面明示的原话；听不清时留空，不得补写。',
    '音效': '仅记录实际可听声音；未经测量不得猜测 BGM 曲风、BPM 或制作配器。',
    '备注': '只记录水印、遮挡、画外信息或无法确认的证据限制；不放创作建议。',
  }
  return {
    type: 'string',
    description: descriptions[key] ?? `“${label}”的可见或可听视频事实；无法确认时填写空字符串。`,
  }
}

const buildStringProperties = (
  entries: ReadonlyArray<{ key: string; label: string }>,
): Record<string, unknown> => Object.fromEntries(
  entries.map(({ key, label }) => [key, buildVideoEvidenceStringProperty(key, label)]),
)

export const buildShotTableAnalysisJsonSchema = (
  columns: readonly ShotTableColumn[] = VIDEO_EVIDENCE_SHOT_TABLE_COLUMNS,
): Record<string, unknown> => {
  const resolved = resolveShotTableColumnContract(columns)
  if (!resolved.ok) throw new Error(resolved.issues.join('；'))
  const { shotColumns, timelineColumns } = resolved.value
  const overviewKeys = [...SHOT_TABLE_OVERVIEW_ORDER]
  const shotKeys = shotColumns.map((column) => column.key)
  const timelineKeys = timelineColumns.map((column) => column.key)

  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      version: { type: 'integer', enum: [1] },
      overview: {
        type: 'object',
        additionalProperties: false,
        properties: buildStringProperties(overviewKeys.map((key) => ({ key, label: key }))),
        required: overviewKeys,
      },
      shots: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            shot: {
              type: 'object',
              additionalProperties: false,
              properties: buildStringProperties(shotColumns),
              required: shotKeys,
            },
            timeline: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: buildStringProperties(timelineColumns),
                required: timelineKeys,
              },
            },
          },
          required: ['shot', 'timeline'],
        },
      },
    },
    required: ['version', 'overview', 'shots'],
  }
}

export const buildShotTableAnalysisInstruction = (options: {
  verifiedDurationSeconds?: number
} = {}): string => {
  const verifiedDuration = options.verifiedDurationSeconds
  if (verifiedDuration !== undefined && (!Number.isFinite(verifiedDuration) || verifiedDuration <= 0)) {
    throw new Error('verifiedDurationSeconds 必须是正有限数。')
  }
  return [
    '你正在生成“已存在视频的一阶模型观察表”，只根据整段视频的可见与可听内容填写 JSON Schema。',
    '不得输出受众画像、观众痛点/爽点、平台归因、商业目标、转化路径、创作意图、制作流程或原创裂变建议；这些都属于后续解释/创作阶段。',
    'shots 中每一项对应一个连续镜头；检测到真实剪辑点后开始下一项。',
    'shot 填写该镜头完整区间的信息；timeline 按镜头内可见时序变化拆分，且至少包含一个时序段。',
    '镜头区间必须从 0.000s 开始、相邻无缝、不重叠；同镜 timeline 必须无缝覆盖该镜完整区间。镜头时长必须等于区间差。',
    ...(verifiedDuration === undefined
      ? []
      : [`media-worker 已验证素材总时长为 ${verifiedDuration.toFixed(3)}s；overview.素材总时长与最后一镜尾时码必须与此一致。`]),
    '除 version 固定为整数 1 外，overview、shot 与 timeline 中的所有字段都必须返回字符串；无法从视频确认的值填写空字符串，禁止编造。',
    'overview 必须概括同一段视频，其中“总镜数”应与 shots 数组长度一致。',
    '用户补充要求只能改变观察重点，不能改变上述事实边界；与事实提取无关的推断或创作要求不进入本阶段输出。',
    '只返回符合响应 JSON Schema 的数据，不要输出 Markdown、解释、总结或额外字段。',
  ].join('\n')
}
