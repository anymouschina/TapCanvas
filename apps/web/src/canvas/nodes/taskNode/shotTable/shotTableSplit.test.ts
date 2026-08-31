import { describe, expect, it } from 'vitest'
import { createEmptyShotTable, type ShotTableData, type ShotTableRow } from '@tapcanvas/shot-table-protocol'
import {
  createEvenShotTableSplitPlan,
  SHOT_TABLE_CLIP_DURATION_LIMIT_SECONDS,
} from './shotTableSplit'

const createRow = (
  table: ShotTableData,
  input: {
    id: string
    shotId: string
    shotNo: string
    timeline: string
    shotRange: string
    duration: string
  },
): ShotTableRow => ({
  id: input.id,
  shotId: input.shotId,
  values: Object.fromEntries(table.columns.map((column) => {
    if (column.label === '镜号') return [column.key, input.shotNo]
    if (column.label === '时间段') return [column.key, input.timeline]
    if (column.label === '时间区间（镜头完整区间）') return [column.key, input.shotRange]
    if (column.label === '时长') return [column.key, input.duration]
    return [column.key, '']
  })),
})

const createTable = (rows: Array<Parameters<typeof createRow>[1]>): ShotTableData => {
  const table = createEmptyShotTable()
  return {
    ...table,
    overview: {
      ...table.overview,
      '集数/标题': '测试长片',
      总镜数: String(new Set(rows.map((row) => row.shotId)).size),
      素材总时长: '31s',
      节拍数: String(rows.length),
    },
    rows: rows.map((row) => createRow(table, row)),
  }
}

describe('createEvenShotTableSplitPlan', () => {
  it('均匀拆分 31 秒时间轴，并保证每段不超过 15 秒', () => {
    const source = createTable([
      {
        id: 'row-1',
        shotId: 'shot-1',
        shotNo: 'M001',
        timeline: '0.0s-12s',
        shotRange: '0s-12s',
        duration: '12s',
      },
      {
        id: 'row-2',
        shotId: 'shot-2',
        shotNo: 'M002',
        timeline: '12s-31s',
        shotRange: '12s-31s',
        duration: '19s',
      },
    ])

    const plan = createEvenShotTableSplitPlan(source)

    expect(plan.requiresSplit).toBe(true)
    expect(plan.segments).toHaveLength(3)
    expect(plan.segments.every((segment) =>
      segment.durationSeconds <= SHOT_TABLE_CLIP_DURATION_LIMIT_SECONDS)).toBe(true)
    const durations = plan.segments.map((segment) => segment.durationSeconds)
    expect(Math.round((Math.max(...durations) - Math.min(...durations)) * 1_000_000)).toBeLessThanOrEqual(1)
    expect(plan.segments.map((segment) => segment.sourceRangeLabel)).toEqual([
      '00:00:00–00:00:10.333333',
      '00:00:10.333333–00:00:20.666667',
      '00:00:20.666667–00:00:31',
    ])
  })

  it('裁切跨边界镜头并把每个派生节点的时间轴重置为 0', () => {
    const source = createTable([
      {
        id: 'row-1',
        shotId: 'shot-1',
        shotNo: 'M001',
        timeline: '00:00-00:12',
        shotRange: '00:00-00:12',
        duration: '12s',
      },
      {
        id: 'row-2',
        shotId: 'shot-2',
        shotNo: 'M002',
        timeline: '00:12-00:31',
        shotRange: '00:12-00:31',
        duration: '19s',
      },
    ])

    const plan = createEvenShotTableSplitPlan(source)
    const middle = plan.segments[1]?.table
    expect(middle?.rows).toHaveLength(2)
    expect(middle?.rows.map((row) => row.values['时间段'])).toEqual([
      '00:00:00–00:00:01.666667',
      '00:00:01.666667–00:00:10.333334',
    ])
    expect(middle?.rows.map((row) => row.values['时间区间（镜头完整区间）'])).toEqual([
      '00:00:00–00:00:01.666667',
      '00:00:01.666667–00:00:10.333334',
    ])
    expect(middle?.overview).toMatchObject({
      '集数/标题': '测试长片 · 片段 2/3',
      总镜数: '2',
      素材总时长: '10.333334s',
      节拍数: '2',
      来源时间区间: '00:00:10.333333–00:00:20.666667',
    })
    expect(source.rows[0]?.values['时间段']).toBe('00:00-00:12')
  })

  it('对 15 秒内的分镜表明确判定为无需拆分', () => {
    const source = createTable([{
      id: 'row-1',
      shotId: 'shot-1',
      shotNo: 'M001',
      timeline: '00:00:00-00:00:15',
      shotRange: '00:00:00-00:00:15',
      duration: '15s',
    }])

    const plan = createEvenShotTableSplitPlan(source)

    expect(plan.requiresSplit).toBe(false)
    expect(plan.segments).toHaveLength(1)
    expect(plan.totalDurationSeconds).toBe(15)
  })

  it('时间格式无法解析时显式失败，不按行数或总览字段兜底', () => {
    const source = createTable([{
      id: 'row-1',
      shotId: 'shot-1',
      shotNo: 'M001',
      timeline: '约三十秒',
      shotRange: '0s-31s',
      duration: '31s',
    }])

    expect(() => createEvenShotTableSplitPlan(source)).toThrow(
      '第 1 行“时间段”不是可拆分的时间区间：约三十秒',
    )
  })

  it('均分区间落在时间轴空档时显式失败', () => {
    const source = createTable([
      {
        id: 'row-1',
        shotId: 'shot-1',
        shotNo: 'M001',
        timeline: '0s-1s',
        shotRange: '0s-1s',
        duration: '1s',
      },
      {
        id: 'row-2',
        shotId: 'shot-2',
        shotNo: 'M002',
        timeline: '31s-32s',
        shotRange: '31s-32s',
        duration: '1s',
      },
    ])

    expect(() => createEvenShotTableSplitPlan(source)).toThrow(
      '均匀拆分后的第 2 段',
    )
  })
})
