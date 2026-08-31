import { describe, expect, it } from 'vitest'
import { parseAccountCreditsPage } from './accountApi'

const validCreditsPage = {
  creditsTotal: 100,
  creditsFrozen: 30,
  creditsAvailable: 70,
  nextCursor: null,
  items: [{
    id: 'ledger-1',
    type: 'reserve',
    amount: 30,
    taskId: 'task-1',
    taskKind: 'video',
    note: null,
    createdAt: '2026-08-14T15:00:00.000Z',
    creditsTotalAfter: 100,
    creditsFrozenAfter: 30,
    creditsAvailableAfter: 70,
    settlesReservation: false,
  }],
}

describe('account credits response contract', () => {
  it('accepts the current credits contract', () => {
    expect(parseAccountCreditsPage(validCreditsPage)).toEqual(validCreditsPage)
  })

  it('rejects the legacy balance contract instead of rendering NaN', () => {
    expect(() => parseAccountCreditsPage({
      balance: 100,
      creditsFrozen: 30,
      nextCursor: null,
      items: [{ id: 'ledger-1', type: 'reserve', amount: 30, note: null, createdAt: '2026-08-14T15:00:00.000Z' }],
    })).toThrow('creditsTotal 必须是有限数值')
  })

  it('rejects non-finite ledger balances', () => {
    expect(() => parseAccountCreditsPage({
      ...validCreditsPage,
      items: [{ ...validCreditsPage.items[0], creditsAvailableAfter: Number.NaN }],
    })).toThrow('creditsAvailableAfter 必须是有限数值')
  })
})
