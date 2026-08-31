import { describe, expect, it } from 'vitest'
import { createEmptyShotTable } from '@tapcanvas/shot-table-protocol'
import { buildShotTableWorkbook, parseShotTableWorkbook } from './shotTableWorkbook'
import { buildXlsxWorkbook } from './shotTableWorkbookCodec'

describe('shot table workbook', () => {
  it('round-trips columns, scopes, rows and shot grouping', () => {
    const table = createEmptyShotTable()
    const parsed = parseShotTableWorkbook(buildShotTableWorkbook(table))
    expect(parsed.warnings).toEqual([])
    expect(parsed.table.columns).toEqual(table.columns)
    expect(parsed.table.rows).toEqual(table.rows)
    expect(parsed.table.overview).toEqual(table.overview)
  })

  it('rejects a non-xlsx payload explicitly', () => {
    expect(() => parseShotTableWorkbook(new TextEncoder().encode('not xlsx')))
      .toThrow('Excel 文件无法解压或不是有效的 .xlsx。')
  })

  it('imports the Tanva three-sheet shape with explicit identity warnings', () => {
    const bytes = buildXlsxWorkbook([{
      name: '分镜表',
      rows: [['镜号', '时间段'], ['M001', '0.0s-1.0s'], ['M001', '1.0s-2.0s']],
      widths: [18, 18],
      filter: true,
    }, {
      name: '镜头总览',
      rows: [['字段', '值'], ['总镜数', '1']],
      widths: [20, 20],
      filter: false,
    }, {
      name: '列设置',
      rows: [['列名', '作用域', '序号'], ['镜号', '镜头列', '1'], ['时间段', '时序列', '2']],
      widths: [20, 20, 10],
      filter: false,
    }])
    const parsed = parseShotTableWorkbook(bytes)
    expect(parsed.warnings).toEqual([
      '文件未完整保存列标识，已按列顺序创建新的本地列标识。',
      '文件没有“行结构”工作表，已按“镜号”的精确值恢复镜头分组。',
    ])
    expect(new Set(parsed.table.rows.map((row) => row.shotId)).size).toBe(1)
  })
})
