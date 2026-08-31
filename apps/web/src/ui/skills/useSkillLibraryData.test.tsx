import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({
  deleteUserContextAsset: vi.fn(),
  getSkillMarketplaceSellerDashboard: vi.fn(() => Promise.resolve({
    listedCount: 0,
    soldCount: 0,
    totalIncomeCredits: 0,
    recentSales: [],
  })),
  getSkillMarketplaceSellerListings: vi.fn(() => Promise.resolve([])),
  getSkillMarketplace: vi.fn(() => Promise.resolve({ items: [], creditBalance: 0 })),
  getSkillMarketplaceListingEligibility: vi.fn(() => Promise.resolve(true)),
  getUserContextAssetContent: vi.fn(),
  listUserContextAssetOnMarketplace: vi.fn(),
  listUserContextAssets: vi.fn(() => Promise.resolve([])),
  purchaseMarketplaceSkill: vi.fn(),
  unlistUserContextAssetFromMarketplace: vi.fn(),
  updateUserContextAsset: vi.fn(),
  uploadUserContextAsset: vi.fn(),
}))

vi.mock('../../api/server', () => apiMocks)
vi.mock('../../auth/store', () => ({
  useAuth: () => ({ token: 'auth-token' }),
}))

import { useSkillLibraryData } from './useSkillLibraryData'

describe('useSkillLibraryData', () => {
  it('shares an in-flight seller dashboard request across concurrent loads', async () => {
    const first = renderHook(() => useSkillLibraryData())
    const second = renderHook(() => useSkillLibraryData())

    await act(async () => {
      await Promise.all([
        first.result.current.load(),
        second.result.current.load(),
      ])
    })

    expect(apiMocks.getSkillMarketplaceSellerDashboard).toHaveBeenCalledTimes(1)
    expect(first.result.current.sellerDashboardError).toBe('')
    expect(second.result.current.sellerDashboardError).toBe('')
  })
})
