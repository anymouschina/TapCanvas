import React from 'react'
import { getMyReferral, type MyReferralDto } from '../api/server'
import { useAuth } from '../auth/store'

// Backend builds inviteUrl from its own origin (or SITE_ORIGIN), which is the
// API host — not where the user actually browses. Rewrite it to the current
// frontend origin so shared links land on the same site visitors are using.
function rewriteInviteUrlToCurrentOrigin(dto: MyReferralDto): MyReferralDto {
  if (typeof window === 'undefined') return dto
  const code = (dto.inviteCode || '').trim()
  if (!code) return dto
  const origin = window.location.origin
  if (!origin) return dto
  return { ...dto, inviteUrl: `${origin}/?ref=${code}` }
}

export function useMyInviteCode(): { data: MyReferralDto | null; loading: boolean } {
  const user = useAuth((s) => s.user)
  const [data, setData] = React.useState<MyReferralDto | null>(null)
  const [loading, setLoading] = React.useState(false)

  React.useEffect(() => {
    if (!user || user.guest) {
      setData(null)
      return
    }
    let cancelled = false
    setLoading(true)
    getMyReferral()
      .then((d) => {
        if (!cancelled) setData(rewriteInviteUrlToCurrentOrigin(d))
      })
      .catch((err) => {
        console.warn('[referral] me load failed', err)
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
