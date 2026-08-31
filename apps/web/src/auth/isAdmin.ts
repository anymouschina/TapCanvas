import { useAuth } from './store'

const viteEnv: Readonly<{ VITE_DEV_ALL_ADMIN?: string; DEV?: boolean }> = import.meta.env

export function isDevAllAdminEnabled(): boolean {
  const raw = viteEnv.VITE_DEV_ALL_ADMIN
  if (typeof raw === 'string' && raw.trim()) {
    const v = raw.trim().toLowerCase()
    return v === '1' || v === 'true' || v === 'yes' || v === 'on'
  }
  return Boolean(viteEnv.DEV)
}

export function useIsAdmin(): boolean {
  const role = useAuth((s) => s.user?.role || null)
  return isDevAllAdminEnabled() || role === 'admin'
}

export function isCurrentUserAdmin(): boolean {
  return isDevAllAdminEnabled() || useAuth.getState().user?.role === 'admin'
}
