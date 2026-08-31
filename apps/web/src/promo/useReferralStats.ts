import React from 'react'
import { getReferralStats, type ReferralStatsDto } from '../api/server'
import { useAuth } from '../auth/store'

export function useReferralStats(): { data: ReferralStatsDto | null; loading: boolean } {
  const user = useAuth((s) => s.user)
  const [data, setData] = React.useState<ReferralStatsDto | null>(null)
  const [loading, setLoading] = React.useState(false)

  React.useEffect(() => {
    if (!user || user.guest) {
      setData(null)
      return
    }
    let cancelled = false
    setLoading(true)
    getReferralStats()
      .then((d) => {
        if (!cancelled) setData(d)
      })
      .catch((err) => {
        console.warn('[referral] stats load failed', err)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [user?.sub, user?.guest])

  return { data, loading }
}
