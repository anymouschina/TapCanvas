import { describe, expect, it } from 'vitest'
import { presentCreditEntry } from './AccountCreditsView'

describe('account credit ledger presentation', () => {
  it('distinguishes a reservation from an actual deduction', () => {
    expect(presentCreditEntry({ type: 'reserve', amount: 2813, settlesReservation: false })).toEqual({
      label: '冻结积分',
      amountText: '冻结 2,813',
      tone: 'reserve',
      explanation: '预占额度，不是实际扣减',
    })
    expect(presentCreditEntry({ type: 'deduct', amount: 2813, settlesReservation: true })).toEqual({
      label: '扣减积分',
      amountText: '−2,813',
      tone: 'deduct',
      explanation: '由冻结额度结算，可用积分不会重复减少',
    })
  })

  it('labels a release as restored availability instead of another charge', () => {
    expect(presentCreditEntry({ type: 'release', amount: 2813, settlesReservation: true })).toMatchObject({
      label: '解冻积分',
      amountText: '解冻 2,813',
      tone: 'release',
    })
  })

  it('keeps a direct deduction distinct from reservation settlement', () => {
    expect(presentCreditEntry({ type: 'deduct', amount: 30, settlesReservation: false })).toMatchObject({
      label: '扣减积分',
      amountText: '−30',
      explanation: '直接扣减',
    })
  })
})
