import { useAuth } from './store'

const viteEnv = ((import.meta as any).env || {}) as Record<string, any>

export function isDevAllAdminEnabled(): boolean {
  const raw = viteEnv.VITE_DEV_ALL_ADMIN
  if (typeof raw === 'string' && raw.trim()) {
    const v = raw.trim().toLowerCase()
    return v === '1' || v === 'true' || v === 'yes' || v === 'on'
  }
  if (typeof raw === 'number') return raw === 1
  if (typeof raw === 'boolean') return raw
  return Boolean(viteEnv.DEV)
}

export function useIsAdmin(): boolean {
  const role = useAuth((s) => s.user?.role || null)
  return isDevAllAdminEnabled() || role === 'admin'
}

