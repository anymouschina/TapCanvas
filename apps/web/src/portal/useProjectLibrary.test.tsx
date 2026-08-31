import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { listProjectsPaginated, listServerAssets, upsertProject } = vi.hoisted(() => ({
  listProjectsPaginated: vi.fn(),
  listServerAssets: vi.fn(),
  upsertProject: vi.fn(),
}))

vi.mock('../api/server', () => ({
  listProjectsPaginated,
  listServerAssets,
  upsertProject,
}))

import { setActiveTeamId } from '../ui/team/activeTeam'
import { useProjectLibrary } from './useProjectLibrary'

describe('useProjectLibrary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    listProjectsPaginated.mockResolvedValue({ items: [], nextCursor: null })
    listServerAssets.mockResolvedValue({ items: [], nextCursor: null })
  })

  it('reloads the ordered project page when the active team changes', async () => {
    localStorage.setItem('tapcanvas_active_team_id', 'personal_user-1')
    renderHook(() => useProjectLibrary('auth-token', 0))

    await waitFor(() => {
      expect(listProjectsPaginated).toHaveBeenCalledWith({
        limit: 30,
        teamId: 'personal_user-1',
      })
    })

    act(() => setActiveTeamId('team-2', '第二团队'))

    await waitFor(() => {
      expect(listProjectsPaginated).toHaveBeenLastCalledWith({
        limit: 30,
        teamId: 'team-2',
      })
    })
    expect(listProjectsPaginated).toHaveBeenCalledTimes(2)
  })
})
