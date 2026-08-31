import React from 'react'

const ACTIVE_TEAM_KEY = 'tapcanvas_active_team_id'
const ACTIVE_TEAM_NAME_KEY = 'tapcanvas_active_team_name'

export type ActiveTeamChangedDetail = {
  teamId: string | null
  teamName: string | null
}

export function getActiveTeamId(): string | null {
  try { return localStorage.getItem(ACTIVE_TEAM_KEY) } catch { return null }
}

export function getActiveTeamName(): string | null {
  try { return localStorage.getItem(ACTIVE_TEAM_NAME_KEY) } catch { return null }
}

export function useActiveTeamId(): string | null {
  const [id, setId] = React.useState<string | null>(() => getActiveTeamId())

  React.useEffect(() => {
    const handleTeamChanged = (event: Event): void => {
      const detail = (event as CustomEvent<ActiveTeamChangedDetail>).detail
      setId(detail?.teamId ?? null)
    }
    window.addEventListener('tapcanvas:team-changed', handleTeamChanged)
    return () => window.removeEventListener('tapcanvas:team-changed', handleTeamChanged)
  }, [])

  return id
}

export function setActiveTeamId(id: string | null, name?: string | null): void {
  try {
    if (id) localStorage.setItem(ACTIVE_TEAM_KEY, id)
    else localStorage.removeItem(ACTIVE_TEAM_KEY)
    if (name) localStorage.setItem(ACTIVE_TEAM_NAME_KEY, name)
    else localStorage.removeItem(ACTIVE_TEAM_NAME_KEY)
  } catch { /* localStorage may be unavailable */ }

  try {
    const detail: ActiveTeamChangedDetail = { teamId: id, teamName: name ?? null }
    window.dispatchEvent(new CustomEvent('tapcanvas:team-changed', { detail }))
  } catch { /* window may be unavailable */ }
}
