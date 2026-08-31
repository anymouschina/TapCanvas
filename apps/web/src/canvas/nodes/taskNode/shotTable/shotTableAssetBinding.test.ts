import { describe, expect, it } from 'vitest'
import { createEmptyShotTable } from '@tapcanvas/shot-table-protocol'
import { insertShotTableAssetReference, readShotTableAssetBindings } from './shotTableAssetBinding'

const reference = {
  id: 'asset-1',
  username: 'hero',
  displayName: '主角',
  source: 'project' as const,
  nodeId: null,
  assetUrl: 'https://example.com/hero.png',
  assetId: 'asset-1',
  assetRefId: 'hero',
  assetName: '主角',
}

describe('shot table asset binding', () => {
  it('replaces an active @ query and appends a traceable binding', () => {
    const table = createEmptyShotTable()
    table.rows[0]!.values['画面内容'] = '看向 @he'
    const result = insertShotTableAssetReference({
      table,
      activeCell: { rowId: table.rows[0]!.id, columnKey: '画面内容', selectionStart: 6, selectionEnd: 6 },
      reference,
      existingBindings: [],
      bindingId: 'binding-1',
      createdAt: '2026-08-01T00:00:00.000Z',
    })
    expect(result.table.rows[0]?.values['画面内容']).toBe('看向 @hero')
    expect(result.bindings).toHaveLength(1)
  })

  it('refuses to overwrite malformed binding history', () => {
    const table = createEmptyShotTable()
    expect(() => insertShotTableAssetReference({
      table,
      activeCell: { rowId: table.rows[0]!.id, columnKey: '画面内容', selectionStart: 0, selectionEnd: 0 },
      reference,
      existingBindings: { invalid: true },
      bindingId: 'binding-1',
      createdAt: '2026-08-01T00:00:00.000Z',
    })).toThrow('shotTableAssetBindings 必须是数组')

    expect(readShotTableAssetBindings([{
      id: 'binding-1',
      createdAt: 'invalid',
    }]).error).toContain('缺少可追溯身份或时间')
  })
})
