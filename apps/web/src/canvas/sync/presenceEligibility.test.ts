import { describe, expect, it } from 'vitest'
import { resolveTeamPresenceId } from './presenceEligibility'

describe('resolveTeamPresenceId', () => {
  it.each([null, '', '   ', 'personal', 'personal_user-1'])(
    'rejects a personal workspace team id: %s',
    (teamId) => {
      expect(resolveTeamPresenceId(teamId)).toBeNull()
    },
  )

  it('returns a normalized real team id', () => {
    expect(resolveTeamPresenceId('team-1')).toBe('team-1')
    expect(resolveTeamPresenceId('  team-1  ')).toBe('team-1')
  })
})
