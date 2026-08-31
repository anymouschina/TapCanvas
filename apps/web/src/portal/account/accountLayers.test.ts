import { describe, expect, it } from 'vitest'
import {
  ACCOUNT_MEMBERSHIP_Z_INDEX,
  ACCOUNT_PAYMENT_Z_INDEX,
  ACCOUNT_TEAM_CHECKOUT_Z_INDEX,
} from './accountLayers'

const SKILL_LIBRARY_DIALOG_Z_INDEX = 10_100

describe('account dialog layers', () => {
  it('keeps membership, checkout and payment dialogs in interaction order', () => {
    expect(ACCOUNT_MEMBERSHIP_Z_INDEX).toBeGreaterThan(SKILL_LIBRARY_DIALOG_Z_INDEX)
    expect(ACCOUNT_TEAM_CHECKOUT_Z_INDEX).toBeGreaterThan(ACCOUNT_MEMBERSHIP_Z_INDEX)
    expect(ACCOUNT_PAYMENT_Z_INDEX).toBeGreaterThan(ACCOUNT_TEAM_CHECKOUT_Z_INDEX)
  })
})
