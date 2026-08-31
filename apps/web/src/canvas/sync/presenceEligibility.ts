export function resolveTeamPresenceId(activeTeamId: string | null): string | null {
  const teamId = activeTeamId?.trim() ?? ''
  if (!teamId || teamId === 'personal' || teamId.startsWith('personal_')) return null
  return teamId
}
