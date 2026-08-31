export type StatsSection =
  | 'overview'
  | 'users'
  | 'task-logs'

export function parseStatsSectionFromPathname(pathname: string): StatsSection {
  const path = pathname.trim()
  if (path === '/stats' || path === '/stats/' || !path) return 'overview'
  if (!path.startsWith('/stats/')) return 'overview'

  const first = path.slice('/stats/'.length).split('/').filter(Boolean)[0] ?? ''
  if (first === 'users') return 'users'
  if (first === 'task-logs') return 'task-logs'
  return 'overview'
}

export function getPathnameForStatsSection(section: StatsSection): string {
  return section === 'overview' ? '/stats' : `/stats/${section}`
}
