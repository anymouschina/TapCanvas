import React from 'react'
import { getReferralCampaign, type ReferralCampaignDto } from '../api/server'

export function useReferralCampaign(): { data: ReferralCampaignDto | null; loading: boolean } {
  const [data, setData] = React.useState<ReferralCampaignDto | null>(null)
  const [loading, setLoading] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    getReferralCampaign()
      .then((d) => {
        if (!cancelled) setData(d)
      })
      .catch((err) => {
        console.warn('[referral] campaign load failed', err)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { data, loading }
}
