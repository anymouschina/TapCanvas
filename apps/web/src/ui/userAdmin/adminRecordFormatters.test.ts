import { describe, expect, it } from 'vitest'
import { assertAdminRecordTimeRange, formatAdminRecordCurrency, localDateTimeToIso } from './adminRecordFormatters'

describe('admin record formatters', () => {
  it('converts local datetime input into an offset ISO timestamp', () => {
    const value = localDateTimeToIso('2026-07-23T16:30')
    expect(value).toMatch(/^2026-07-23T\d{2}:30:00\.000Z$/)
  })

  it('rejects invalid or reversed time ranges explicitly', () => {
    expect(() => localDateTimeToIso('invalid')).toThrow('时间条件格式不正确')
    expect(() => assertAdminRecordTimeRange('2026-07-24T00:00:00.000Z', '2026-07-23T00:00:00.000Z')).toThrow('开始时间不能晚于结束时间')
  })

  it('formats stored minor currency units without losing cents', () => {
    expect(formatAdminRecordCurrency(1299, 'CNY')).toContain('12.99')
  })
})
