// @vitest-environment jsdom
import React from 'react'
import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TeamListItemDto, TeamSubscriptionPlanDto } from '../../../api/server'
import StatsTeamPlansManagement from './StatsTeamPlansManagement'

const apiMocks = vi.hoisted(() => ({
  activateTeamSubscription: vi.fn(),
  listAllTeamSubscriptionPlans: vi.fn(),
}))

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn().mockReturnValue(false),
  })),
})

vi.mock('../../../api/server', () => apiMocks)
vi.mock('../../toast', () => ({ toast: vi.fn() }))
vi.mock('./TeamPlanEditorModal', () => ({ default: () => null }))

const plan: TeamSubscriptionPlanDto = {
  id: 'team-plus',
  name: 'PLUS',
  tier: 'plus',
  minSeats: 5,
  maxSeats: 5,
  features: {
    concurrent_tasks_per_seat: 2,
    unlimited_concurrent_tasks: false,
    canvas_collab: true,
    shared_asset_library: true,
    seat_management: true,
    credit_quota_control: true,
    fast_invoice: true,
    creditGrants: {
      annual: { includedCreditsPerSeat: 12000 },
    },
    presentation: {
      badge: '',
      variantOrder: 1,
      accent: 'graphite',
      featured: false,
      campaignBenefits: [],
      capabilities: [],
    },
  },
  sortWeight: 1,
  enabled: true,
  createdAt: '2026-07-22T00:00:00.000Z',
  updatedAt: '2026-07-22T00:00:00.000Z',
}

const teams: TeamListItemDto[] = [
  {
    id: 'team-free',
    name: '免费团队',
    credits: 100,
    creditsFrozen: 0,
    creditsAvailable: 100,
    maxMembers: 2,
    memberCount: 2,
    personal: false,
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z',
  },
  {
    id: 'team-managed',
    name: '管理员套餐团队',
    credits: 1000,
    creditsFrozen: 0,
    creditsAvailable: 1000,
    maxMembers: 5,
    memberCount: 3,
    personal: false,
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z',
  },
]

function renderManagement({
  activationTeam = null,
  onActivationClose = vi.fn(),
  onTeamActivated = vi.fn().mockResolvedValue(undefined),
}: {
  activationTeam?: TeamListItemDto | null
  onActivationClose?: () => void
  onTeamActivated?: () => Promise<void>
} = {}) {
  return render(
    <MantineProvider defaultColorScheme="dark" forceColorScheme="dark">
      <StatsTeamPlansManagement
        activationTeam={activationTeam}
        onActivationClose={onActivationClose}
        onTeamActivated={onTeamActivated}
        teams={teams}
      />
    </MantineProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('StatsTeamPlansManagement', () => {
  it('uses parent team data for statistics without rendering a second team list', async () => {
    apiMocks.listAllTeamSubscriptionPlans.mockResolvedValue([plan])

    renderManagement()

    await waitFor(() => expect(apiMocks.listAllTeamSubscriptionPlans).toHaveBeenCalledTimes(1))
    expect(screen.getByText('协作团队总数').nextElementSibling?.textContent).toBe('2')
    expect(screen.getByText('免费版（2席）').nextElementSibling?.textContent).toBe('1')
    expect(screen.getByText('管理员套餐（>2席）').nextElementSibling?.textContent).toBe('1')
    expect(screen.queryByText('协作团队列表')).toBeNull()
    expect(screen.queryByText('免费团队')).toBeNull()
    expect(screen.queryByText('管理员套餐团队')).toBeNull()
  })

  it('keeps manual plan activation available for a team selected from the parent list', async () => {
    apiMocks.listAllTeamSubscriptionPlans.mockResolvedValue([plan])
    apiMocks.activateTeamSubscription.mockResolvedValue({})
    const onActivationClose = vi.fn()
    const onTeamActivated = vi.fn().mockResolvedValue(undefined)

    renderManagement({
      activationTeam: teams[1],
      onActivationClose,
      onTeamActivated,
    })

    await screen.findByText('管理员分配后，套餐与积分立即生效。')
    await screen.findByRole('button', { name: 'PLUS' })
    const confirmButton = screen.getByRole('button', { name: '确认激活' })
    await waitFor(() => expect(confirmButton.hasAttribute('disabled')).toBe(false))
    fireEvent.click(confirmButton)

    await waitFor(() => {
      expect(apiMocks.activateTeamSubscription).toHaveBeenCalledWith('team-managed', {
        planId: 'team-plus',
        billingCycle: 'annual',
        seatCount: 5,
        issueCreditsNow: true,
      })
    })
    expect(onActivationClose).toHaveBeenCalledTimes(1)
    expect(onTeamActivated).toHaveBeenCalledTimes(1)
  })
})
