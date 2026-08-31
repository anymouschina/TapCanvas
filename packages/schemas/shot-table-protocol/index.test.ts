import { describe, expect, it } from 'vitest'
import {
  buildShotTableAnalysisJsonSchema,
  buildShotTableTextReviewContract,
  createEmptyShotTable,
  inspectShotTableAnalysisJson,
  normalizeShotTable,
  normalizeShotTableAnalysis,
  normalizeShotTableTextReviewContract,
  parseShotTableAnalysisJson,
  parseShotTableText,
  serializeShotTable,
  VIDEO_EVIDENCE_SHOT_TABLE_COLUMNS,
} from './index'

describe('shot table protocol', () => {
  it('round-trips the canonical empty table', () => {
    const initial = createEmptyShotTable()
    const parsed = parseShotTableText(serializeShotTable(initial), { expectedColumns: initial.columns })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.table.rows).toHaveLength(1)
    expect(parsed.table.rows[0]?.values['镜号']).toBe('M001')
    expect(parsed.table.columns.find((column) => column.label === '目标人物')?.scope).toBe('timeline')
  })

  it('round-trips the fixed text-storyboard review contract without weakening source locks', () => {
    const columns = createEmptyShotTable().columns
    const contract = buildShotTableTextReviewContract('video_evidence', columns)
    const normalized = normalizeShotTableTextReviewContract(contract)

    expect(normalized).toEqual({ ok: true, contract })
    expect(contract.sourceLocks.observedVideoCutsAndTiming).toBe('locked')
    expect(contract.pacingLimits).toMatchObject({
      targetBeatSeconds: 15,
      maximumTimelineSegmentSeconds: 3,
      maximumChineseDialogueCharactersPerSegment: 8,
      maximumEnglishWordsPerSecond: 3,
    })
  })

  it('discovers dynamic fields by structural section instead of label heuristics', () => {
    const parsed = parseShotTableText(`【镜头总览】\n总镜数：1\n\n=========单镜头开始=========\n镜号：M001\n自定义镜头字段：固定值\n\n---镜头内时序细分\n时间段：0.0s-0.5s\n自定义时序字段：变化值\n=========单镜头结束=========`)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.table.columns.find((column) => column.label === '自定义镜头字段')?.scope).toBe('shot')
    expect(parsed.table.columns.find((column) => column.label === '自定义时序字段')?.scope).toBe('timeline')
  })

  it('fails explicitly when model output is not a shot table', () => {
    const parsed = parseShotTableText('这是分析摘要，但不是分镜表。')
    expect(parsed).toEqual({
      ok: false,
      issues: ['分镜原文必须从“【镜头总览】”开始，前面不能包含解释或其他内容。'],
    })
  })

  it('rejects missing timeline blocks and unexpected fields in expected-column mode', () => {
    const initial = createEmptyShotTable()
    const withoutTimeline = parseShotTableText(`【镜头总览】\n总镜数：1\n\n=========单镜头开始=========\n镜号：M001\n=========单镜头结束=========`, {
      expectedColumns: initial.columns,
    })
    expect(withoutTimeline.ok).toBe(false)

    const extraField = parseShotTableText(`${serializeShotTable(initial).replace('镜号：M001', '镜号：M001\n额外字段：不允许')}`, {
      expectedColumns: initial.columns,
    })
    expect(extraField).toEqual({
      ok: false,
      issues: ['第 1 个镜头包含当前表不存在的字段：额外字段。'],
    })
  })

  it('rejects invalid scope instead of silently coercing it', () => {
    const invalid = createEmptyShotTable() as unknown as Record<string, unknown>
    const columns = (invalid.columns as Array<Record<string, unknown>>)
    columns[0] = { ...columns[0], scope: 'unknown' }
    const normalized = normalizeShotTable(invalid)
    expect(normalized.ok).toBe(false)
  })

  it('builds a strict JSON Schema from the canonical shot-table columns', () => {
    const schema = buildShotTableAnalysisJsonSchema()
    expect(schema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['version', 'overview', 'shots'],
      properties: {
        shots: {
          type: 'array',
          minItems: 1,
          items: {
            additionalProperties: false,
            required: ['shot', 'timeline'],
          },
        },
      },
    })
    const shots = (schema.properties as Record<string, Record<string, unknown>>).shots
    const overview = (schema.properties as Record<string, Record<string, unknown>>).overview
    const overviewProperties = overview.properties as Record<string, Record<string, unknown>>
    const shotItem = shots.items as Record<string, unknown>
    const itemProperties = shotItem.properties as Record<string, Record<string, unknown>>
    const shotProperties = itemProperties.shot.properties as Record<string, unknown>
    const timelineItem = itemProperties.timeline.items as Record<string, unknown>
    const timelineProperties = timelineItem.properties as Record<string, unknown>
    expect(shotProperties).toHaveProperty('镜号')
    expect(shotProperties).not.toHaveProperty('节拍单元')
    expect(shotProperties).not.toHaveProperty('剧本特征')
    expect(shotProperties).not.toHaveProperty('时间段')
    expect(timelineProperties).toHaveProperty('时间段')
    expect(timelineProperties).toHaveProperty('细微肢体与应激动作')
    expect(overviewProperties['节拍数']?.enum).toEqual([''])
  })

  it('compiles structured video analysis into canonical rows and deterministic ids', () => {
    const parsed = normalizeShotTableAnalysis({
      version: 1,
      overview: {
        '集数/标题': '雪夜决战',
        总镜数: '1',
        素材总时长: '2s',
        节拍数: '',
        全程说明: '冷调雪夜。',
      },
      shots: [{
        shot: {
          镜号: '1',
          '时间区间（镜头完整区间）': '00:00-00:02',
          时长: '2s',
          场景与光影: '月夜雪地',
          '人物站位（本节拍起始）': '人物下半身位于画面中央',
          景别: '特写',
          运镜: '固定低机位',
          构图: '鞋跟居中',
          画面内容: '鞋跟压入积雪',
          台词: '',
          音效: '积雪碎裂声',
          备注: '',
          字数与语速: '',
        },
        timeline: [{
          时间段: '00:00-00:01',
          目标人物: '红衣女武侠',
          表情与呼吸: '',
          细微肢体与应激动作: '鞋跟缓慢下压',
        }, {
          时间段: '00:01-00:02',
          目标人物: '红衣女武侠',
          表情与呼吸: '',
          细微肢体与应激动作: '碎雪向外飞溅',
        }],
      }],
    }, VIDEO_EVIDENCE_SHOT_TABLE_COLUMNS)

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.table.rows).toHaveLength(2)
    expect(parsed.table.rows[0]).toMatchObject({
      id: 'shot-1-segment-1',
      shotId: 'shot-1',
      values: {
        镜号: '1',
        时间段: '00:00-00:01',
        细微肢体与应激动作: '鞋跟缓慢下压',
      },
    })
    expect(parsed.table.rows[1]?.values['镜号']).toBe('1')
    expect(parsed.table.columns.some((column) => column.key === '节拍单元')).toBe(false)
  })

  it('rejects incomplete or contradictory video timelines instead of accepting plausible prose', () => {
    const parsed = normalizeShotTableAnalysis({
      version: 1,
      overview: {
        '集数/标题': '',
        总镜数: '2',
        素材总时长: '5.000s',
        节拍数: '2',
        全程说明: '仅包含可见事实。',
      },
      shots: [{
        shot: Object.fromEntries(VIDEO_EVIDENCE_SHOT_TABLE_COLUMNS
          .filter((column) => column.scope === 'shot')
          .map((column) => [column.key, ({
            镜号: '1',
            '时间区间（镜头完整区间）': '0.000s-2.000s',
            时长: '2.000s',
          } as Record<string, string>)[column.key] ?? ''])),
        timeline: [{
          时间段: '0.000s-2.000s',
          目标人物: '',
          表情与呼吸: '',
          细微肢体与应激动作: '',
        }],
      }, {
        shot: Object.fromEntries(VIDEO_EVIDENCE_SHOT_TABLE_COLUMNS
          .filter((column) => column.scope === 'shot')
          .map((column) => [column.key, ({
            镜号: '2',
            '时间区间（镜头完整区间）': '3.000s-4.000s',
            时长: '1.000s',
          } as Record<string, string>)[column.key] ?? ''])),
        timeline: [{
          时间段: '3.000s-4.000s',
          目标人物: '',
          表情与呼吸: '',
          细微肢体与应激动作: '',
        }],
      }],
    }, VIDEO_EVIDENCE_SHOT_TABLE_COLUMNS, { expectedDurationSeconds: 5 })

    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.issues.some((entry) => entry.includes('节拍数'))).toBe(true)
    expect(parsed.issues.some((entry) => entry.includes('无缝开始'))).toBe(true)
    expect(parsed.issues.some((entry) => entry.includes('媒体探针时长'))).toBe(true)
  })

  it('rejects malformed or incomplete structured output without text fallback', () => {
    expect(parseShotTableAnalysisJson('```json\n{}\n```').ok).toBe(false)
    const parsed = normalizeShotTableAnalysis({
      version: 1,
      overview: {},
      shots: [{ shot: {}, timeline: [] }],
    })
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.issues).toContain('第 1 个镜头的 timeline 至少需要一个时序段。')
    expect(parsed.issues.some((issue) => issue.includes('镜头总览缺少字段'))).toBe(true)
  })

  it('reports an exact repair path once when a required string field is absent', () => {
    const inspection = inspectShotTableAnalysisJson(JSON.stringify({
      version: 1,
      overview: {
        '集数/标题': '',
        总镜数: '1',
        素材总时长: '',
        节拍数: '',
        全程说明: '',
      },
      shots: [{
        shot: Object.fromEntries(
          createEmptyShotTable().columns
            .filter((column) => column.scope === 'shot' && column.key !== '构图')
            .map((column) => [column.key, '']),
        ),
        timeline: [Object.fromEntries(
          createEmptyShotTable().columns
            .filter((column) => column.scope === 'timeline')
            .map((column) => [column.key, '']),
        )],
      }],
    }))

    expect(inspection.ok).toBe(false)
    if (inspection.ok) return
    const compositionViolations = inspection.violations.filter((entry) =>
      entry.path.at(-1) === '构图')
    expect(compositionViolations).toEqual([expect.objectContaining({
      code: 'missing_field',
      expected: 'string',
      actual: 'missing',
      path: ['shots', 0, 'shot', '构图'],
    })])
  })
})
