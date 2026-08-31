export function formatAdminRecordTime(value: string | null | undefined): string {
  if (!value) return '—'
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return value
  return new Intl.DateTimeFormat('zh-CN', {
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(timestamp))
}

export function formatAdminRecordCurrency(amountCents: number, currency: string): string {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amountCents / 100)
}

export function localDateTimeToIso(value: string): string | undefined {
  const normalized = value.trim()
  if (!normalized) return undefined
  const date = new Date(normalized)
  if (!Number.isFinite(date.getTime())) throw new Error('时间条件格式不正确')
  return date.toISOString()
}

export function assertAdminRecordTimeRange(from?: string, to?: string): void {
  if (from && to && from > to) throw new Error('开始时间不能晚于结束时间')
}
